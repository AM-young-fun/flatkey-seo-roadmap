const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
let state, queue = Promise.resolve();
const write = () => state.dataWrites++;
const membership = (keywordId, overrides = {}) => ({ siteDomain: "flatkey.ai", keywordId, active: true, pool: "RESEARCH", reviewStatus: "UNREVIEWED", curationId: null,
  curatedAt: null, targetUrls: [], candidateUrls: [], mappingStatus: "UNMAPPED", topicId: "existing-topic", protected: false, origin: "PLANNED", sourceUrl: null, ...overrides });
const db = {
  $transaction: async callback => {
    const previous = queue;
    let release;
    queue = new Promise(resolve => { release = resolve; });
    await previous;
    const before = structuredClone(state);
    try { return await callback(db); } catch (error) { state = before; throw error; } finally { release(); }
  },
  $executeRaw: async () => 0,
  seoSite: { findUnique: async () => ({ active: true }) },
  keywordSourceRow: {
    findMany: async ({ where }) => state.sourceRows.filter(row => row.siteDomain === where.siteDomain && row.sourceId === where.sourceId && where.rowKey.in.includes(row.rowKey)),
    upsert: async ({ where, create, update }) => {
      if (state.failSourceWrite) throw new Error("simulated source-row failure");
      const key = where.siteDomain_sourceId_rowKey;
      const existing = state.sourceRows.find(row => row.siteDomain === key.siteDomain && row.sourceId === key.sourceId && row.rowKey === key.rowKey);
      write();
      if (existing) Object.assign(existing, structuredClone(update));
      else state.sourceRows.push(structuredClone(create));
    },
  },
  keyword: {
    findMany: async () => state.keywords.map(({ id, text, active }) => ({ id, text, active })),
    createMany: async ({ data }) => { write(); state.keywords.push(...structuredClone(data)); },
  },
  siteKeyword: {
    findMany: async ({ where }) => state.links.filter(row => row.siteDomain === where.siteDomain && where.keywordId.in.includes(row.keywordId)).map(row => structuredClone(row)),
    createMany: async ({ data }) => { write(); state.links.push(...data.map(row => membership(row.keywordId, row))); },
    updateMany: async ({ where, data }) => {
      const row = state.links.find(row => row.siteDomain === where.siteDomain && row.keywordId === where.keywordId && row.active === where.active && row.pool === where.pool
        && row.reviewStatus === where.reviewStatus && row.curationId === where.curationId && row.mappingStatus === where.mappingStatus
        && (!Object.hasOwn(where, "curatedAt") || new Date(row.curatedAt).getTime() === new Date(where.curatedAt).getTime())
        && (!Object.hasOwn(where, "topicId") || row.topicId === where.topicId) && (!Object.hasOwn(where, "protected") || row.protected === where.protected)
        && JSON.stringify(row.targetUrls) === JSON.stringify(where.targetUrls.equals) && JSON.stringify(row.candidateUrls) === JSON.stringify(where.candidateUrls.equals)
        && state.keywords.find(keyword => keyword.id === row.keywordId).active);
      if (!row) return { count: 0 };
      write(); Object.assign(row, structuredClone(data)); return { count: 1 };
    },
  },
  topic: { upsert: async ({ where, create }) => { let row = state.topics.find(row => row.text === where.text); if (!row) { write(); row = { id: `topic-${state.topics.length}`, ...create }; state.topics.push(row); } return row; } },
  siteTopic: { createMany: async ({ data }) => { for (const row of data) if (!state.siteTopics.some(old => old.siteDomain === row.siteDomain && old.topicId === row.topicId)) { write(); state.siteTopics.push(row); } } },
  siteKeywordTopic: { createMany: async ({ data }) => { for (const row of data) if (!state.keywordTopics.some(old => old.siteDomain === row.siteDomain && old.keywordId === row.keywordId && old.topicId === row.topicId)) { write(); state.keywordTopics.push(row); } } },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const { sourceSyncSchema } = require("../src/lib/source-sync.ts");
const { syncKeywordSources } = require("../src/lib/services/source-sync.ts");
const { normalizeSourceRows, sourceSyncHash } = require("../src/lib/source-sync-plan.ts");
const { POST } = require("../src/app/api/keywords/source-sync/route.ts");
const word = (keyword, overrides = {}) => ({ keyword, role: "PRIMARY", relevance: "RELEVANT", reason: "明确的模型API业务接入需求，与发布页正文及示例相符", pageIntentMatched: true, newModel: false, ...overrides });
const row = (rowKey, words = [word("new model api")], overrides = {}) => ({ rowKey, slug: rowKey.split(":").at(-1), language: "en", title: "API integration", topic: "API routing",
  completion: "COMPLETED", rawStatus: "已生成", pageUrl: "https://flatkey.ai/blog/verified-api", publication: { pageVerified: true, verificationReason: "已核对公开页面可访问且正文完整回答该关键词主意图" }, keywords: words, ...overrides });
const payload = (rows, overrides = {}) => sourceSyncSchema.parse({ kind: "source-sync", requestId: "source-run-1", targetDomain: "flatkey.ai", action: "apply", sourceId: "api_main", rows, ...overrides });
const addTracked = (id, text, overrides = {}) => { state.keywords.push({ id, text, active: true }); state.links.push(membership(id, overrides)); };
const findWord = text => state.links.find(link => state.keywords.find(keyword => keyword.id === link.keywordId)?.text === text && link.siteDomain === "flatkey.ai");

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test.invalid/source-sync";
  process.env.RANKING_IMPORT_SECRET = "fictional-source-sync-token";
  queue = Promise.resolve();
  state = { keywords: [], links: [], sourceRows: [], topics: [], siteTopics: [], keywordTopics: [], dataWrites: 0 };
});

test("preview writes nothing; identical apply including new collection time and request ID performs zero further data writes", async () => {
  const original = structuredClone(state);
  const incoming = payload([row("en:api-route")]);
  const preview = await syncKeywordSources({ ...incoming, action: "preview" });
  assert.equal(preview.imported, 1);
  assert.equal(preview.sourceSummary.promotedFormal, 1);
  assert.deepEqual(state, original);
  const applied = await syncKeywordSources({ ...incoming, expectedStateHash: preview.stateHash });
  assert.equal(applied.sourceSummary.newKeywords, 1);
  assert.equal(findWord("new model api").pool, "FORMAL");
  assert.equal(findWord("new model api").mappingStatus, "READY");
  const beforeReplay = structuredClone(state);
  const lostResponseReplay = await syncKeywordSources({ ...incoming, expectedStateHash: preview.stateHash });
  assert.equal(lostResponseReplay.duplicate, true);
  assert.deepEqual(state, beforeReplay);
  const replay = await syncKeywordSources({ ...incoming, requestId: "new-daily-check", collectedAt: "2026-10-15T10:00:00Z" });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.imported, 0);
  assert.equal(replay.sourceSummary.unchangedRows, 1);
  assert.deepEqual(state, beforeReplay);
});

test("publication verification and each keyword's intent are required; unknown relevance never inherits default policy approval", async () => {
  const incoming = payload([
    row("en:pending", [word("unfinished model api")], { completion: "PENDING" }),
    row("en:unverified", [word("unverified model api")], { publication: { pageVerified: false } }),
    row("en:wrong-intent", [word("different intent api", { pageIntentMatched: false })]),
    row("en:unknown-business", [word("unknown business phrase", { relevance: "REVIEW" })]),
    row("en:missing-proof", [word("missing proof api")], { publication: { pageVerified: true } }),
    row("en:new-model", [word("nova-x9 api", { relevance: "REVIEW", newModel: true })]),
  ]);
  const result = await syncKeywordSources(incoming);
  assert.equal(result.sourceSummary.promotedFormal, 1);
  assert.equal(result.sourceSummary.heldResearch, 5);
  for (const text of ["unfinished model api", "unverified model api", "different intent api", "unknown business phrase", "missing proof api"]) {
    assert.equal(findWord(text).pool, "RESEARCH");
    assert.equal(findWord(text).mappingStatus, "UNMAPPED");
    assert.deepEqual(findWord(text).targetUrls, []);
  }
  assert.equal(findWord("nova-x9 api").pool, "FORMAL");
  assert.equal(findWord("nova-x9 api").protected, true);
});

test("noise is source-only; archived, merged, held, global-inactive and member-inactive records never revive", async () => {
  for (const [id, options] of [
    ["archived", { pool: "ARCHIVED", active: false }], ["merged", { pool: "MERGED", active: false }],
    ["held", { reviewStatus: "HELD_FOR_RESEARCH", curationId: "manual-review" }], ["inactive", { active: false }], ["global-inactive", {}],
  ]) addTracked(id, `${id} api`, options);
  state.keywords.find(keyword => keyword.id === "global-inactive").active = false;
  const before = structuredClone(state.links);
  const result = await syncKeywordSources(payload([row("en:noise", [word("yes")]), ...before.map(link => row(`en:${link.keywordId}`, [word(`${link.keywordId} api`)]))]));
  assert.equal(result.sourceSummary.newKeywords, 0);
  assert.equal(result.sourceSummary.promotedFormal, 0);
  assert.deepEqual(state.links, before);
  assert.ok(!state.keywords.some(keyword => keyword.text === "yes"));
  assert.equal(state.sourceRows.length, 6);
});

test("a normal audited candidate can gain its first verified page, while existing formal and reviewed page mappings never change", async () => {
  addTracked("candidate", "ordinary candidate api", { curationId: "old-audit", reviewStatus: "OUTSIDE_FORMAL_POOL" });
  addTracked("formal", "existing formal api", { pool: "FORMAL", curationId: "old-audit", reviewStatus: "CONFIRMED", targetUrls: ["https://flatkey.ai/correct-manual-page"], mappingStatus: "READY" });
  addTracked("mismatch", "mismatched candidate api", { targetUrls: ["https://flatkey.ai/old-page"] });
  addTracked("reviewed", "reviewed candidate api", { curationId: "old-audit", reviewStatus: "OUTSIDE_FORMAL_POOL", mappingStatus: "NEEDS_REMAP", candidateUrls: ["https://flatkey.ai/manual-proposal"] });
  const before = structuredClone(state.links);
  const result = await syncKeywordSources(payload(before.map(link => row(`en:${link.keywordId}`, [word(state.keywords.find(keyword => keyword.id === link.keywordId).text)]))));
  assert.equal(result.sourceSummary.promotedFormal, 1);
  const candidate = findWord("ordinary candidate api");
  assert.equal(candidate.pool, "FORMAL");
  assert.deepEqual(candidate.targetUrls, ["https://flatkey.ai/blog/verified-api"]);
  assert.equal(candidate.topicId, "existing-topic");
  for (const id of ["formal", "mismatch", "reviewed"]) assert.deepEqual(state.links.find(link => link.keywordId === id), before.find(link => link.keywordId === id));
});

test("same words across stable rows and sources share one membership, and row order does not affect results", async () => {
  const pending = row("en:a-pending", [word("Ｆｒｅｓｈ   API")], { completion: "PENDING" });
  const completed = row("en:z-completed", [word("fresh api")]);
  const a = await syncKeywordSources(payload([pending, completed], { action: "preview" }));
  const b = await syncKeywordSources(payload([completed, pending], { action: "preview" }));
  assert.deepEqual(a.sourceSummary, b.sourceSummary);
  assert.equal(a.stateHash, b.stateHash);
  await syncKeywordSources(payload([pending, completed]));
  assert.equal(state.keywords.length, 1);
  assert.equal(state.links.length, 1);
  assert.equal(findWord("fresh api").pool, "FORMAL");
  await syncKeywordSources(payload([row("en:cloud-source", [word("Fresh API")])], { sourceId: "cloud_main", requestId: "cloud-run" }));
  assert.equal(state.keywords.length, 1);
  assert.equal(state.links.length, 1);
  assert.equal(state.sourceRows.length, 3);
});

test("source changes touch only source state; missing rows, removed keywords and completion regression never delete or downgrade inventory", async () => {
  const incoming = payload([row("en:stable", [word("retained primary api"), word("retained auxiliary api", { role: "SECONDARY" })]), row("en:other", [word("retained other api")])]);
  await syncKeywordSources(incoming);
  const links = structuredClone(state.links), words = structuredClone(state.keywords);
  const titleOnly = await syncKeywordSources(payload([row("en:stable", incoming.rows[0].keywords, { title: "Changed source title only" })]));
  assert.equal(titleOnly.sourceSummary.changedRows, 1);
  assert.equal(titleOnly.sourceSummary.updatedMemberships, 0);
  assert.deepEqual(titleOnly.changes.find(change => change.keyword === null).fields, ["title"]);
  await syncKeywordSources(payload([row("en:stable", [word("retained primary api")], { completion: "PENDING", title: "Changed source title only" })]));
  assert.deepEqual(state.links, links);
  assert.deepEqual(state.keywords, words);
  const beforeEmpty = structuredClone(state);
  const empty = await syncKeywordSources(payload([]));
  assert.equal(empty.imported, 0);
  assert.deepEqual(state, beforeEmpty);
  assert.equal(state.sourceRows.length, 2);
});

test("preview detects later source and manual review changes before any apply mutation", async () => {
  addTracked("candidate", "protected preview api");
  const incoming = payload([row("en:stable", [word("protected preview api")])]);
  const preview = await syncKeywordSources({ ...incoming, action: "preview" });
  const candidate = state.links[0];
  candidate.pool = "ARCHIVED"; candidate.active = false;
  const before = structuredClone(state);
  await assert.rejects(syncKeywordSources({ ...incoming, expectedStateHash: preview.stateHash }), /重新预览/);
  assert.deepEqual(state, before);
});

test("ambiguous existing normalized IDs are reported rather than chosen or duplicated", async () => {
  addTracked("a", "Alias API"); addTracked("b", "Ａｌｉａｓ api");
  const before = structuredClone(state.links);
  const result = await syncKeywordSources(payload([row("en:alias", [word("alias api")])]));
  assert.equal(result.sourceSummary.conflicts, 1);
  assert.equal(result.sourceSummary.newKeywords, 0);
  assert.deepEqual(state.links, before);
  assert.equal(state.keywords.length, 2);
});

test("a source write failure rolls back additions and promotions, and concurrent identical requests cannot duplicate words", async () => {
  const incoming = payload([row("en:atomic")]);
  state.failSourceWrite = true;
  const before = structuredClone(state);
  await assert.rejects(syncKeywordSources(incoming), /simulated source-row failure/);
  assert.deepEqual(state, before);
  state.failSourceWrite = false;
  const results = await Promise.all([syncKeywordSources(incoming), syncKeywordSources(incoming)]);
  assert.equal(results.filter(result => result.duplicate).length, 1);
  assert.equal(state.keywords.length, 1);
  assert.equal(state.links.length, 1);
  assert.equal(state.sourceRows.length, 1);
});

test("source schemas reject metric/ranking fields and unsafe source identity; same content ignores array order", async () => {
  const incoming = payload([row("en:stable", [word("second api"), word("first api")])]);
  for (const patch of [{ observations: [] }, { metrics: [] }, { capture: {} }, { targetDomain: "rackrate.org" }, { sourceId: "unknown-table" }]) assert.equal(sourceSyncSchema.safeParse({ ...incoming, ...patch }).success, false);
  assert.equal(sourceSyncSchema.safeParse({ ...incoming, rows: [incoming.rows[0], incoming.rows[0]] }).success, false);
  await assert.rejects(syncKeywordSources(payload([row("en:unsafe", [word("safe word api")], { pageUrl: "https://flatkey.ai.attacker.example/page" })])), /本站/);
  await assert.rejects(syncKeywordSources(payload([row("en:alias", [word("DUP API"), word("dup api")])])), /规范化重复词/);
  assert.equal(state.dataWrites, 0);
  const reversed = { ...incoming, rows: [{ ...incoming.rows[0], keywords: [...incoming.rows[0].keywords].reverse() }] };
  assert.equal(sourceSyncHash(normalizeSourceRows(incoming)), sourceSyncHash(normalizeSourceRows(reversed)));
});

test("the source-sync API accepts the narrow collector credential, rejects unsafe fields, and never needs a ranking provider", async () => {
  const incoming = payload([row("en:route")], { action: "preview" });
  const request = body => new Request("http://localhost/api/keywords/source-sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer fictional-source-sync-token" }, body: JSON.stringify(body) });
  const response = await POST(request(incoming));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.kind, "source-sync");
  assert.equal(result.sourceSummary.newKeywords, 1);
  assert.equal(state.dataWrites, 0);
  const invalid = await POST(request({ ...incoming, metrics: [{ volume: 0 }] }));
  assert.equal(invalid.status, 400);
  assert.equal(state.dataWrites, 0);
});

test("matching an existing unreviewed page can verify its status without changing the association", async () => {
  addTracked("candidate", "already linked candidate api", { targetUrls: ["https://flatkey.ai/blog/verified-api"] });
  const urls = structuredClone(state.links[0].targetUrls);
  await syncKeywordSources(payload([row("en:stable", [word("already linked candidate api")])]));
  assert.equal(state.links[0].pool, "FORMAL");
  assert.equal(state.links[0].mappingStatus, "READY");
  assert.deepEqual(state.links[0].targetUrls, urls);
});

test("a formal recorded target gains only its first same-page verification and is not counted as a formal promotion", async () => {
  addTracked("formal", "recorded formal api", { pool: "FORMAL", reviewStatus: "CONFIRMED", curationId: "manual-audit",
    curatedAt: new Date("2026-10-15T10:00:00Z"), protected: true, mappingStatus: "RECORDED", targetUrls: ["https://flatkey.ai/blog/verified-api"] });
  const original = structuredClone(state), before = structuredClone(state.links[0]);
  const incoming = payload([row("en:recorded", [word("recorded formal api")])]);
  const preview = await syncKeywordSources({ ...incoming, action: "preview" });
  assert.deepEqual(state, original);
  assert.equal(preview.sourceSummary.updatedMemberships, 1);
  assert.equal(preview.sourceSummary.promotedFormal, 0);
  assert.deepEqual(preview.changes.find(change => change.verifyExisting), {
    rowKey: "en:recorded", keyword: "recorded formal api", action: "verified_existing_page", fields: ["mappingStatus"],
    reason: "已有正式目标的同一页面首次完成公开可用性与该关键词主意图核验，仅更新核验状态", verifyExisting: true,
  });
  const result = await syncKeywordSources({ ...incoming, expectedStateHash: preview.stateHash });
  assert.equal(result.sourceSummary.updatedMemberships, 1);
  assert.equal(result.sourceSummary.promotedFormal, 0);
  assert.deepEqual(state.links[0], { ...before, mappingStatus: "READY" });
  const after = structuredClone(state);
  const replay = await syncKeywordSources(incoming);
  assert.equal(replay.duplicate, true);
  assert.deepEqual(state, after);
});

test("formal page verification cannot replace a URL, resolve candidates or override another mapping decision or missing proof", async () => {
  const cases = [
    { id: "different", options: { targetUrls: ["https://flatkey.ai/other-page"] } },
    { id: "multiple", options: { targetUrls: ["https://flatkey.ai/blog/verified-api", "https://flatkey.ai/other-page"] } },
    { id: "candidate", options: { candidateUrls: ["https://flatkey.ai/manual-candidate"] } },
    ...["READY", "MODEL_PROTECTED", "NEEDS_REMAP", "NEEDS_NEW_PAGE", "UNMAPPED"].map(mappingStatus => ({ id: mappingStatus.toLowerCase().replaceAll("_", "-"), options: { mappingStatus } })),
    ...["HELD_FOR_RESEARCH", "EXCLUDED", "MERGED", "AUDIT_RESTORED"].map(reviewStatus => ({ id: reviewStatus.toLowerCase().replaceAll("_", "-"), options: { reviewStatus } })),
    { id: "unmatched", words: { pageIntentMatched: false } },
    { id: "unverified", source: { publication: { pageVerified: false } } },
    { id: "pending", source: { completion: "PENDING" } },
    { id: "uncertain", words: { relevance: "REVIEW" } },
    { id: "proof-missing", source: { publication: { pageVerified: true } } },
    { id: "two-pages" },
  ];
  for (const item of cases) addTracked(item.id, `${item.id} formal api`, { pool: "FORMAL", reviewStatus: "CONFIRMED", curationId: "manual-audit",
    mappingStatus: "RECORDED", targetUrls: ["https://flatkey.ai/blog/verified-api"], ...item.options });
  const before = structuredClone(state.links);
  const rows = cases.map(item => row(`en:${item.id}`, [word(`${item.id} formal api`, item.words)], item.source));
  rows.push(row("en:second-page", [word("two-pages formal api")], { pageUrl: "https://flatkey.ai/other-page" }));
  const result = await syncKeywordSources(payload(rows));
  assert.equal(result.sourceSummary.updatedMemberships, 0);
  assert.equal(result.sourceSummary.promotedFormal, 0);
  assert.deepEqual(state.links, before);
});

test("older changed snapshots and undated edits cannot bypass known source chronology", async () => {
  const incoming = payload([row("en:stable")], { collectedAt: "2026-10-15T11:00:00Z" });
  await syncKeywordSources(incoming);
  const before = structuredClone(state);
  await assert.rejects(syncKeywordSources(payload([row("en:stable", incoming.rows[0].keywords, { title: "Older changed title" })], { collectedAt: "2026-10-14T11:00:00Z" })), /早于已保存/);
  assert.deepEqual(state, before);
  await assert.rejects(syncKeywordSources(payload([row("en:stable", incoming.rows[0].keywords, { title: "Undated title update" })])), /必须提供collectedAt/);
  assert.deepEqual(state, before);
  await syncKeywordSources(payload([row("en:stable", incoming.rows[0].keywords, { title: "Newer title update" })], { collectedAt: "2026-10-15T12:00:00Z" }));
  assert.equal(state.sourceRows[0].observedAt.toISOString(), "2026-10-15T12:00:00.000Z");
});

test("the fixed curation decisions prevent missing old aliases or exclusions from re-entering the word inventory", async () => {
  const result = await syncKeywordSources(payload([
    row("en:merged", [word("deepseek v4 pro vs flash implementation guide")]),
    row("en:normalized", [word("gemini api 价格(159 展示 / 均位 7.7)")]),
    row("en:held", [word("gpt agent")]),
  ]));
  assert.equal(result.sourceSummary.newKeywords, 1);
  assert.equal(result.sourceSummary.promotedFormal, 0);
  assert.equal(result.sourceSummary.blocked, 2);
  assert.equal(findWord("gpt agent").pool, "RESEARCH");
  assert.equal(findWord("gpt agent").reviewStatus, "HELD_FOR_RESEARCH");
  assert.equal(state.sourceRows.length, 3);
});

test("a preview token also binds the proposed content, not just the current database baseline", async () => {
  const incoming = payload([row("en:stable")]);
  const preview = await syncKeywordSources({ ...incoming, action: "preview" });
  const altered = payload([row("en:stable", incoming.rows[0].keywords, { pageUrl: "https://flatkey.ai/different-page" })], { expectedStateHash: preview.stateHash });
  await assert.rejects(syncKeywordSources(altered), /重新预览/);
  assert.equal(state.dataWrites, 0);
});
