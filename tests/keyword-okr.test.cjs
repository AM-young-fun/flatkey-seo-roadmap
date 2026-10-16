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
  $queryRaw: async query => {
    if (query.sql.includes("audit-summaries")) {
      state.auditReadCount = (state.auditReadCount ?? 0) + 1;
      state.auditReadSql = query.sql;
      if (state.auditTransientFailures > 0) { state.auditTransientFailures--; throw Object.assign(new Error("private database connection details"), { code: "P1001" }); }
      return state.audits.map(row => ({ id: row.id, status: row.status, appliedAt: row.appliedAt, restoredAt: row.restoredAt, changed: row.after.length }));
    }
    return query.sql.includes("observed-pages") ? state.pages : state.keywords;
  },
  seoSite: { findUnique: async ({ where }) => where.domain === "flatkey.ai" ? { active: true } : null },
  keywordSourceRow: { findMany: async ({ where }) => { state.pageAuditReadCount = (state.pageAuditReadCount ?? 0) + 1; return (state.pageAudits ?? []).filter(row => where.rowKey.in.includes(row.rowKey)); } },
  keywordCurationAudit: {
    findUnique: async ({ where }) => state.audits.find(row => row.id === where.id) ?? null,
    findMany: async () => { throw new Error("must not fetch full audit snapshots on a read"); },
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

test("task intent review keeps formal words while removing cross-topic assignments and misleading titles", () => {
  const formal = new Map(okrAudit.keywords.map(row => [row.text, row]));
  const tasks = new Map(okrAudit.tasks.map(row => [row.number, row]));
  const mismatches = [
    [1, "ai agent开发"], [3, "apify for web scraping"], [3, "best scraping api"], [7, "deepseek v2 pricing"],
    [11, "chat gpt vs grok vs gemini"], [11, "grok vs gemini vs chatgpt"], [12, "ai reliability engineering"],
    [14, "kimi context window"], [15, "aws budget alerts"], [15, "azure budget alerts"], [15, "litellm examples"],
    [16, "llama 4 vs gpt 4"], [17, "multi modal testing"], [28, "coreweave kubernetes gpu cluster"],
    [36, "labarna ai sovereign ai infrastructure company"], [39, "context deadline exceeded meaning"],
    [39, "what does context deadline exceeded mean"], [40, "openai compatible endpoint"],
    [41, "how to get openai api key"], [43, "context window optimization"], [44, "qdrant free tier"],
  ];
  assert.equal(mismatches.length, 21);
  for (const [number, word] of mismatches) {
    assert.ok(formal.has(word), `business word remains formal: ${word}`);
    assert.ok(!tasks.get(number).keywords.includes(word), `different intent cannot inherit task ${number}: ${word}`);
  }
  assert.equal(okrAudit.tasks.reduce((sum, row) => sum + row.keywords.length, 0), 167);
  assert.match(tasks.get(12).title, /Kie\.ai/);
  assert.match(tasks.get(15).title, /LiteLLM/);
  assert.match(tasks.get(16).title, /Qwen/);
  assert.match(tasks.get(14).title, /GPT-5系列/);
  assert.ok(tasks.get(7).keywords.includes("deepseek v4 pro pricing first look"));
  for (const row of okrAudit.tasks) {
    if (row.type === "NEW") assert.deepEqual(row.targetUrls, [], "adjacent incomplete content is not an available target");
    for (const word of row.keywords) {
      if (formal.get(word).actions.includes("retain_remap")) assert.equal(word, "deepseek v4 pro pricing first look");
    }
  }
  assert.deepEqual(tasks.get(14).targetUrls, [], "single-model specifications cannot stand in for a comparison");
});

test("OKR reads summarize multiple large audits in PostgreSQL and retry a transient connection failure", async () => {
  await mutateKeywordOkr(input("apply"));
  state.audits.push({ id: "older-restored-audit", status: "RESTORED", appliedAt: new Date("2026-10-14T00:00:00Z"), restoredAt: new Date(), after: new Array(5321).fill({}) });
  state.auditTransientFailures = 1;
  state.pageAudits = [{ rowKey: "keyword:kept", snapshot: { keywordId: "kept", verdict: "REVIEW", reason: "本轮正文未能明确回答这个关键词，需要人工核对", checkedAt: "2026-10-16T06:00:00Z" } }];
  const response = await loadKeywordOkr("flatkey.ai");
  assert.equal(state.auditReadCount, 2);
  assert.equal(response.initialized, true);
  assert.equal(response.summary.formal, 1512);
  assert.equal(response.audits.length, 2);
  assert.equal(response.audits.find(row => row.id === "older-restored-audit").changed, 5321);
  assert.match(state.auditReadSql, /jsonb_array_length\("after"\)/);
  assert.ok(!response.audits.some(row => "after" in row || "before" in row));
  const current = response.keywords.find(row => row.id === "kept");
  assert.equal(current.mappingStatus, "READY");
  assert.equal(current.latestPageAuditVerdict, "REVIEW");
  assert.equal(current.latestPageAuditReason, state.pageAudits[0].snapshot.reason);
  assert.equal(current.latestPageAuditCheckedAt, "2026-10-16T06:00:00.000Z");
  assert.equal(state.pageAuditReadCount, 1);
});
