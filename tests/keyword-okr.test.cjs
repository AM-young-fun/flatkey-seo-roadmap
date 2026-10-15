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
let state;
const defaults = (siteDomain, keywordId, extras = {}) => ({ siteDomain, keywordId, active: true, topicId: "original-topic", origin: "PLANNED", targetUrls: [], pool: "RESEARCH", reviewStatus: "UNREVIEWED", mappingStatus: "UNMAPPED", candidateUrls: [], auditReason: null, protected: false, curatedAt: null, curationId: null, exclusionReason: null, excludedAt: null, restoredAt: null, ...extras });
const db = {
  $transaction: async callback => { const before = structuredClone(state); try { return await callback(db); } catch (error) { state = before; throw error; } },
  $executeRaw: async query => {
    const sql = Array.isArray(query) ? query.join("") : query.sql;
    if (!sql.includes("keyword-okr:write-memberships")) return 0;
    const rows = JSON.parse(query.values.find(value => typeof value === "string" && value.startsWith("[{")));
    for (const row of rows) {
      let prior = state.links.find(link => link.siteDomain === "flatkey.ai" && link.keywordId === row.keywordId);
      if (!prior) { prior = defaults("flatkey.ai", row.keywordId); state.links.push(prior); }
      const fields = { ...row };
      delete fields.text;
      Object.assign(prior, fields);
    }
    return rows.length;
  },
  $queryRaw: async query => query.sql.includes("observed-pages") ? state.pages : state.keywords,
  seoSite: { findUnique: async ({ where }) => where.domain === "flatkey.ai" ? { active: true } : null },
  keywordCurationAudit: {
    findUnique: async ({ where }) => state.audits.find(row => row.id === where.id) ?? null,
    findMany: async () => state.audits,
    create: async ({ data }) => { state.audits.push({ status: "APPLIED", appliedAt: new Date(), restoredAt: null, ...structuredClone(data) }); },
    update: async ({ where, data }) => Object.assign(state.audits.find(row => row.id === where.id), data),
  },
  topic: { upsert: async ({ where, create }) => { let topic = state.topics.find(row => row.text === where.text); if (!topic) { topic = { id: `topic-${state.topics.length}`, ...create }; state.topics.push(topic); } return topic; } },
  siteTopic: {
    findMany: async () => state.siteTopics.map(({ topicId }) => ({ topicId })),
    createMany: async ({ data }) => { for (const row of data) if (!state.siteTopics.some(old => old.topicId === row.topicId)) state.siteTopics.push(row); },
    deleteMany: async ({ where }) => { state.siteTopics = state.siteTopics.filter(row => !where.topicId.in.includes(row.topicId)); },
  },
  siteKeywordTopic: {
    findMany: async () => state.keywordTopics.map(({ keywordId, topicId }) => ({ keywordId, topicId })),
    createMany: async ({ data }) => { for (const row of data) if (!state.keywordTopics.some(old => old.keywordId === row.keywordId && old.topicId === row.topicId)) state.keywordTopics.push(row); },
    deleteMany: async ({ where }) => { state.keywordTopics = state.keywordTopics.filter(row => !where.OR.some(old => old.keywordId === row.keywordId && old.topicId === row.topicId)); },
  },
  keyword: { createMany: async ({ data }) => { state.keywords.push(...data); return { count: data.length }; } },
  siteKeyword: { findMany: async ({ where }) => state.links.filter(row => row.siteDomain === where.siteDomain).map(row => ({ ...row, keyword: state.keywords.find(word => word.id === row.keywordId) })) },
  keywordContentTask: {
    createMany: async ({ data }) => { if (state.failTasks) throw new Error("simulated task failure"); state.tasks.push(...data); },
    findMany: async () => state.tasks.filter(row => row.status !== "RESTORED"),
    count: async () => state.tasks.filter(row => row.status !== "TODO" || row.owner || row.dueAt).length,
    updateMany: async ({ data }) => { state.tasks.forEach(row => Object.assign(row, data)); },
  },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const { KEYWORD_OKR_AUDIT_ID } = require("../src/lib/keyword-okr.ts");
const { okrAudit, auditedMapping, buildCurationPlan, summarizeCuration, restoredCuration } = require("../src/lib/keyword-okr-curation.ts");
const { mutateKeywordOkr, loadKeywordOkr } = require("../src/lib/services/keyword-okr.ts");
const { POST } = require("../src/app/api/keywords/okr/route.ts");
const input = action => ({ siteDomain: "flatkey.ai", auditId: KEYWORD_OKR_AUDIT_ID, action });
beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test.invalid/okr";
  state = {
    keywords: [{ id: "noise", text: "yes" }, { id: "kept", text: "agent tools no subscriptions" }, { id: "research", text: "possible future connector api" }],
    links: [defaults("flatkey.ai", "noise"), defaults("rackrate.org", "noise"), defaults("flatkey.ai", "kept", { targetUrls: ["https://flatkey.ai/blog/agent-tools-no-subscriptions"] }), defaults("flatkey.ai", "research")],
    siteTopics: [{ topicId: "original-topic" }], keywordTopics: [], topics: [], audits: [], tasks: [], observations: [{ siteDomain: "flatkey.ai", keywordId: "noise", rank: 14 }], pages: [],
  };
});

test("the approved target plan retains 1,512 goals, protects 95 models, and only marks the 42 verified links READY", () => {
  const plan = buildCurationPlan([], [], { formal: "formal", model: "model" }, "2026-10-15T00:00:00.000Z");
  const counts = summarizeCuration(plan);
  assert.equal(counts.formal, 1512);
  assert.equal(counts.protectedModels, 95);
  assert.equal(counts.mapping.READY, 42);
  assert.deepEqual(counts.tasks, { REUSE: 17, NEW: 22, EXPAND: 7 });
  assert.ok(plan.every(row => row.topicId));
  for (const row of okrAudit.keywords.filter(row => row.actions.includes("retain_remap") && row.mapping !== "已有匹配正文，待关联")) {
    const mapping = auditedMapping(row);
    assert.notEqual(mapping.mappingStatus, "READY");
    assert.deepEqual(mapping.targetUrls, []);
  }
  const historical = plan.find(row => row.text === "/v1 404 fix");
  assert.equal(historical.mappingStatus, "RECORDED");
});

test("preview is read only and pristine GET does not substitute bundled audit targets for stored data", async () => {
  const original = structuredClone(state);
  const result = await mutateKeywordOkr(input("preview"));
  assert.equal(result.status, "PREVIEW");
  assert.equal(result.summary.formal, 1512);
  assert.deepEqual(state, original);
  const response = await loadKeywordOkr("flatkey.ai");
  assert.equal(response.initialized, false);
  assert.equal(response.summary.formal, 0);
  assert.deepEqual(response.summary.tasks, {});
  assert.deepEqual(response.keywords, []);
});

test("application is atomic and idempotent, fixes verified links, and preserves other sites and source history", async () => {
  const otherSite = structuredClone(state.links.find(row => row.siteDomain === "rackrate.org"));
  const observations = structuredClone(state.observations);
  const result = await mutateKeywordOkr(input("apply"));
  assert.equal(result.summary.formal, 1512);
  assert.equal(state.audits.length, 1);
  assert.equal(state.tasks.length, 46);
  assert.deepEqual(state.links.find(row => row.siteDomain === "rackrate.org"), otherSite);
  assert.deepEqual(state.observations, observations);
  assert.equal(state.links.find(row => row.siteDomain === "flatkey.ai" && row.keywordId === "noise").pool, "ARCHIVED");
  const corrected = state.links.find(row => row.siteDomain === "flatkey.ai" && row.keywordId === "kept");
  assert.deepEqual(corrected.targetUrls, ["https://flatkey.ai/tools"]);
  assert.equal(corrected.mappingStatus, "READY");
  assert.equal(state.links.find(row => row.keywordId === "research").pool, "RESEARCH");
  const again = await mutateKeywordOkr(input("apply"));
  assert.equal(again.unchanged, true);
  assert.equal(again.changed, 0);
  assert.equal(state.tasks.length, 46);
});

test("failed content task creation rolls back all new keywords, memberships and the audit", async () => {
  state.failTasks = true;
  const original = structuredClone(state);
  await assert.rejects(mutateKeywordOkr(input("apply")), /simulated task failure/);
  assert.deepEqual(state, original);
});

test("restoration restores original mappings without deleting new history, is repeatable, and refuses later edits", async () => {
  const oldSiteTopics = structuredClone(state.siteTopics);
  const oldKeywordTopics = structuredClone(state.keywordTopics);
  const originals = structuredClone(state.links.filter(row => row.siteDomain === "flatkey.ai"));
  await mutateKeywordOkr(input("apply"));
  const count = state.keywords.length;
  // PostgreSQL JSONB may reorder object keys when loading audit snapshots.
  state.audits[0].summary.relationSnapshots.after.keywordTopics = state.audits[0].summary.relationSnapshots.after.keywordTopics.map(row => ({ topicId: row.topicId, keywordId: row.keywordId }));
  const result = await mutateKeywordOkr(input("restore"));
  assert.equal(result.status, "RESTORED");
  assert.equal(state.audits[0].status, "RESTORED");
  for (const original of originals) assert.deepEqual(state.links.find(row => row.siteDomain === "flatkey.ai" && row.keywordId === original.keywordId), original);
  assert.equal(state.keywords.length, count);
  assert.deepEqual(state.siteTopics, oldSiteTopics);
  assert.deepEqual(state.keywordTopics, oldKeywordTopics);
  assert.ok(state.links.filter(row => !originals.some(original => original.keywordId === row.keywordId) && row.siteDomain === "flatkey.ai").every(row => !row.active && row.pool === "RESEARCH"));
  assert.equal((await mutateKeywordOkr(input("restore"))).unchanged, true);
  await assert.rejects(mutateKeywordOkr(input("apply")), /新的审计版本/);
  const before = state.audits[0].before, after = state.audits[0].after;
  assert.throws(() => restoredCuration(before, after, after.map((row, index) => index ? row : { ...row, targetUrls: ["https://flatkey.ai/later-change"] }), new Date().toISOString()), /后续修改/);
});

test("the mutation API rejects arbitrary lists, other sites and unapproved audit IDs", async () => {
  for (const body of [{ ...input("apply"), keywords: ["yes"] }, { ...input("apply"), siteDomain: "rackrate.org" }, { ...input("apply"), auditId: "unapproved" }]) {
    const response = await POST(new Request("http://localhost/api/keywords/okr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal(response.status, 400);
  }
  assert.equal(state.audits.length, 0);
});

test("preview and application reject globally inactive formal words without changing another site", async () => {
  state.keywords.find(row => row.id === "kept").active = false;
  const original = structuredClone(state);
  for (const action of ["preview", "apply"]) await assert.rejects(mutateKeywordOkr(input(action)), /1 个全局停用词/);
  assert.deepEqual(state, original);
});

test("content tasks expose only formal keywords and topic edge edits block an audit rollback", async () => {
  await mutateKeywordOkr(input("apply"));
  const formal = new Set(okrAudit.keywords.map(row => row.text));
  assert.ok(state.tasks.every(task => task.keywords.every(word => formal.has(word))));
  state.keywordTopics.push({ keywordId: "kept", topicId: "later-added-topic" });
  await assert.rejects(mutateKeywordOkr(input("restore")), /话题关联已变化/);
  assert.equal(state.audits[0].status, "APPLIED");
});
