const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, "..");
if (!/^postgres(?:ql)?:\/\/[^@]+@(?:localhost|127\.0\.0\.1):\d+\/seo_source_sync_test(?:\?|$)/.test(process.env.SEO_TEST_DATABASE_URL ?? "")) throw Error("Requires isolated local seo_source_sync_test");
process.env.DATABASE_URL = process.env.SEO_TEST_DATABASE_URL;
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { prisma } = require("../src/lib/prisma.ts");
const { syncKeywordSources } = require("../src/lib/services/source-sync.ts");
const { readSourceSyncPreview } = require("../src/lib/services/source-sync-preview.ts");
const { sourceSyncSchema } = require("../src/lib/source-sync.ts");
const { normalizeSourceRows, sourceSyncHash } = require("../src/lib/source-sync-plan.ts");
const row = { rowKey: "en:fixture", slug: "fixture", language: "en", title: "Cloud GPU fixture", topic: "GPU", completion: "PENDING", rawStatus: "research",
  pageUrl: "https://flatkey.ai/compute", publication: { pageVerified: false, verificationReason: "Isolated fixture only; no production claims" },
  keywords: [{ keyword: "gpu rental", role: "PRIMARY", relevance: "RELEVANT", reason: "GPU rental research fixture with a real planner", pageIntentMatched: false, newModel: false }] };
const incoming = () => sourceSyncSchema.parse({ kind: "source-sync", requestId: "local-fixture", targetDomain: "flatkey.ai", action: "apply", sourceId: "cloud_main", collectedAt: "2026-11-12T01:00:00Z", rows: [row] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
before(() => prisma.$connect());
after(() => prisma.$disconnect());
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "KeywordSourceRow", "Keyword", "SeoSite", "Topic" CASCADE');
  await prisma.seoSite.create({ data: { domain: "flatkey.ai", name: "fixture" } });
  await prisma.topic.create({ data: { id: "topic", text: "GPU fixture", type: "MAIN" } });
  await prisma.keyword.create({ data: { id: "keyword", text: "ＧＰＵ rental", type: "MAIN", active: true } });
  await prisma.siteKeyword.create({ data: { siteDomain: "flatkey.ai", keywordId: "keyword", topicId: "topic", curationId: "fixture-review", curatedAt: new Date("2026-11-01T03:04:05.678Z"), reviewStatus: "UNREVIEWED" } });
  const old = normalizeSourceRows({ ...incoming(), rows: [{ ...row, rawStatus: "old" }] })[0];
  await prisma.keywordSourceRow.create({ data: { siteDomain: "flatkey.ai", sourceId: "cloud_main", rowKey: row.rowKey, snapshot: old, snapshotHash: sourceSyncHash(old), observedAt: new Date("2026-11-01T03:04:05.678Z") } });
});

test("PostgreSQL preview snapshot matches locked apply including NFKC aliases and UTC millisecond dates", async () => {
  const snapshot = await readSourceSyncPreview(incoming());
  assert.equal(snapshot.keywords[0].id, "keyword");
  assert.equal(snapshot.links[0].curatedAt.toISOString(), "2026-11-01T03:04:05.678Z");
  assert.equal(snapshot.priorRows[0].observedAt.toISOString(), "2026-11-01T03:04:05.678Z");
  const preview = await syncKeywordSources({ ...incoming(), action: "preview" });
  const applied = await syncKeywordSources({ ...incoming(), expectedStateHash: preview.stateHash });
  assert.equal(applied.imported, 1); assert.equal(applied.stateHash, preview.stateHash);
  assert.equal(await prisma.keyword.count(), 1);
  const storedBefore = await prisma.keywordSourceRow.findFirst();
  const replay = await syncKeywordSources({ ...incoming(), action: "preview" });
  assert.equal(replay.duplicate, true); assert.equal(replay.imported, 0);
  assert.deepEqual(await prisma.keywordSourceRow.findFirst(), storedBefore);
});

test("preview sees one committed snapshot while a writer holds the global lock; apply still waits for it", async () => {
  const acquired = deferred(), release = deferred();
  const original = await readSourceSyncPreview(incoming());
  const writer = prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"seo-import:flatkey.ai"}))`;
    await tx.keyword.update({ where: { id: "keyword" }, data: { active: false } });
    await tx.keywordSourceRow.update({ where: { siteDomain_sourceId_rowKey: { siteDomain: "flatkey.ai", sourceId: "cloud_main", rowKey: row.rowKey } }, data: { snapshotHash: "writer-snapshot" } });
    acquired.resolve(); await release.promise;
  }, { timeout: 10000 });
  let applied;
  try {
    await acquired.promise;
    const during = await Promise.race([readSourceSyncPreview(incoming()), delay(1500).then(() => { throw Error("preview blocked on write lock"); })]);
    assert.equal(during.keywords[0].active, true);
    assert.equal(during.priorRows[0].snapshotHash, original.priorRows[0].snapshotHash);
    let settled = false;
    applied = syncKeywordSources(incoming()).finally(() => { settled = true; });
    await delay(100); assert.equal(settled, false);
  } finally { release.resolve(); await writer; }
  await applied;
  assert.equal((await prisma.keyword.findUnique({ where: { id: "keyword" } })).active, false);
});

test("a manual protected mapping committed after preview makes apply reject the stale token", async () => {
  const preview = await syncKeywordSources({ ...incoming(), action: "preview" });
  const original = await prisma.keywordSourceRow.findFirst();
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"seo-import:flatkey.ai"}))`;
    await tx.siteKeyword.update({ where: { siteDomain_keywordId: { siteDomain: "flatkey.ai", keywordId: "keyword" } }, data: { pool: "FORMAL", reviewStatus: "CONFIRMED", protected: true, targetUrls: ["https://flatkey.ai/human-choice"] } });
  });
  await assert.rejects(syncKeywordSources({ ...incoming(), expectedStateHash: preview.stateHash }), error => error.status === 409);
  assert.deepEqual(await prisma.keywordSourceRow.findFirst(), original);
  const saved = await prisma.siteKeyword.findFirst();
  assert.equal(saved.protected, true); assert.deepEqual(saved.targetUrls, ["https://flatkey.ai/human-choice"]);
});

test("concurrent applies serialize: one changes the source and the replay writes nothing", async () => {
  const preview = await syncKeywordSources({ ...incoming(), action: "preview" });
  const results = await Promise.all([1, 2].map(() => syncKeywordSources({ ...incoming(), expectedStateHash: preview.stateHash })));
  assert.deepEqual(results.map(row => row.imported).sort(), [0, 1]);
  assert.equal(results.filter(row => row.duplicate).length, 1);
  assert.equal(await prisma.keywordSourceRow.count(), 1); assert.equal(await prisma.keyword.count(), 1);
});

test("preview binds hostile row keys and fails closed for an inactive site", async () => {
  const snapshot = await readSourceSyncPreview({ ...incoming(), rows: [{ ...row, rowKey: "x'); DROP TABLE Keyword;--" }] });
  assert.equal(snapshot.priorRows.length, 0); assert.equal(await prisma.keyword.count(), 1);
  await prisma.seoSite.update({ where: { domain: "flatkey.ai" }, data: { active: false } });
  await assert.rejects(syncKeywordSources({ ...incoming(), action: "preview" }), error => error.status === 400);
});
