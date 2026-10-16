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

let state, sessionToken, queue;
const clone = value => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const countWrite = () => state.dataWrites++;

function matches(value, where) {
  if (where == null) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (key === "AND") return (Array.isArray(expected) ? expected : [expected]).every(condition => matches(value, condition));
    if (key === "OR") return expected.some(condition => matches(value, condition));
    const actual = value?.[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date) && !Array.isArray(expected)) {
      if (Object.hasOwn(expected, "in")) return expected.in.includes(actual);
      if (Object.hasOwn(expected, "equals")) return same(actual, expected.equals);
      if (Object.hasOwn(expected, "not")) return !same(actual, expected.not);
      return matches(actual, expected);
    }
    return same(actual, expected);
  });
}

function selectFields(value, select) {
  if (!select) return clone(value);
  return Object.fromEntries(Object.entries(select).map(([key, selection]) => [key,
    selection === true ? clone(value[key]) : selectFields(value[key], selection.select),
  ]));
}

const db = {
  $transaction: async callback => {
    const previous = queue;
    let release;
    queue = new Promise(resolve => { release = resolve; });
    await previous;
    const before = clone(state);
    try { return await callback(db); }
    catch (error) { state = before; throw error; }
    finally { release(); }
  },
  $executeRaw: async () => 0,
  $queryRaw: async query => {
    assert.match(query.text, /page-audit:update-memberships/);
    const [json, siteDomain] = query.values;
    const updates = JSON.parse(json);
    state.membershipQueries.push(clone({ text: query.text, values: query.values }));
    const changed = [];
    for (const update of updates) {
      const where = { siteDomain, keywordId: update.keywordId, active: update.beforeActive, pool: update.beforePool,
        reviewStatus: update.beforeReviewStatus, curationId: update.beforeCurationId,
        curatedAt: update.beforeCuratedAt === null ? null : new Date(update.beforeCuratedAt), mappingStatus: update.beforeMappingStatus,
        targetUrls: { equals: update.beforeTargetUrls }, candidateUrls: { equals: update.beforeCandidateUrls }, topicId: update.beforeTopicId,
        protected: update.beforeProtected, auditReason: update.beforeAuditReason, keyword: { active: true, text: update.keywordText } };
      const data = { mappingStatus: update.mappingStatus, targetUrls: update.targetUrls, candidateUrls: update.candidateUrls, auditReason: update.auditReason };
      for (const row of state.memberships.filter(row => matches(row, where))) {
        state.membershipWrites.push(clone({ where, data }));
        Object.assign(row, clone(data));
        changed.push({ keywordId: row.keywordId });
      }
    }
    if (changed.length) countWrite();
    return changed;
  },
  seoSite: { findUnique: async () => ({ domain: "flatkey.ai", active: state.siteActive }) },
  siteKeyword: {
    findMany: async ({ where, select }) => state.memberships.filter(row => matches(row, where)).map(row => selectFields(row, select)),
  },
  keywordSourceRow: {
    findMany: async ({ where }) => state.sourceRows.filter(row => matches(row, where)).map(clone),
    createMany: async ({ data, skipDuplicates }) => {
      if (state.failEvidenceWrite) throw new Error("simulated page evidence write failure");
      assert.notEqual(skipDuplicates, true, "a new-snapshot conflict must cancel the entire audit transaction");
      if (data.some(row => state.sourceRows.some(existing => matches(existing, { siteDomain: row.siteDomain, sourceId: row.sourceId, rowKey: row.rowKey })))) {
        throw new Error("simulated snapshot uniqueness conflict");
      }
      countWrite();
      state.sourceRows.push(...clone(data));
      return { count: data.length };
    },
    upsert: async ({ where, create, update }) => {
      if (state.failEvidenceWrite) throw new Error("simulated page evidence write failure");
      const identity = where.siteDomain_sourceId_rowKey;
      const existing = state.sourceRows.find(row => matches(row, identity));
      countWrite();
      if (existing) Object.assign(existing, clone(update));
      else state.sourceRows.push(clone(create));
      return existing ?? create;
    },
  },
};

const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: {
  cookies: async () => ({ get: name => name === "seo_rank_auth" && sessionToken ? { value: sessionToken } : undefined }),
} };

const { pageAuditSchema } = require("../src/lib/page-audit.ts");
const { planKeywordPageAudit } = require("../src/lib/page-audit-plan.ts");
const { auditKeywordPages } = require("../src/lib/services/page-audit.ts");
const { POST } = require("../src/app/api/keywords/page-audit/route.ts");
const { getAuthToken } = require("../src/lib/auth.ts");

const auditRow = (keyword = "keyword-1 api", overrides = {}) => ({
  keyword, verdict: "VERIFIED", pageUrl: "https://flatkey.ai/blog/verified-api", canonicalUrl: "https://flatkey.ai/blog/verified-api", httpStatus: 200,
  checkedAt: "2026-10-15T10:00:00Z", reason: "The page directly explains this model API, authentication, request parameters and working integration examples.",
  evidence: { title: "Verified model API guide", h1: "Model API integration", excerpt: "The article includes matching model API authentication and request examples." }, ...overrides,
});
const payload = (rows = [auditRow()], overrides = {}) => pageAuditSchema.parse({ kind: "page-audit", requestId: "page-audit-run-1", targetDomain: "flatkey.ai", action: "apply", rows, ...overrides });
const request = (body, authorization) => new Request("https://flatkey.test/api/keywords/page-audit", {
  method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body),
});

function addMember(keywordId = "keyword-1", overrides = {}) {
  const row = { siteDomain: "flatkey.ai", keywordId, keyword: { text: `${keywordId} api`, active: true }, active: true,
    pool: "FORMAL", reviewStatus: "CONFIRMED", curationId: "manual-audit", curatedAt: new Date("2026-10-14T00:00:00Z"),
    targetUrls: ["https://flatkey.ai/old-page"], candidateUrls: [], mappingStatus: "RECORDED", topicId: "manual-topic", protected: false,
    auditReason: "Existing manual business decision", ...overrides };
  state.memberships.push(row);
  return row;
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://unused.invalid/page-audit";
  process.env.LOGIN_PWD = "page-audit-test-password";
  process.env.RANKING_IMPORT_SECRET = "fictional-page-audit-import-token";
  sessionToken = null;
  queue = Promise.resolve();
  state = { siteActive: true, memberships: [], sourceRows: [], membershipWrites: [], membershipQueries: [], dataWrites: 0, failEvidenceWrite: false };
});

test("VERIFIED requires HTTP 200, same-page canonical and detailed keyword intent evidence", () => {
  const valid = payload();
  assert.equal(pageAuditSchema.safeParse(valid).success, true);
  for (const patch of [
    { httpStatus: 404 }, { canonicalUrl: undefined }, { canonicalUrl: "https://flatkey.ai/different-page" },
    { canonicalUrl: "https://flatkey.ai/blog/verified-api?other=page" }, { pageUrl: undefined },
    { reason: "Short reason only" }, { evidence: {} }, { evidence: { title: "Tiny" } },
  ]) assert.equal(pageAuditSchema.safeParse({ ...valid, rows: [auditRow(undefined, patch)] }).success, false, JSON.stringify(patch));
  assert.equal(pageAuditSchema.safeParse({ ...valid, rows: [auditRow(undefined, { pageUrl: "https://flatkey.ai/blog/verified-api/#section" })] }).success, true);
});

test("content action plans persist with audited page associations and reject invented targets", async () => {
  const member = addMember("keyword-1", { protected: true });
  const workPlan = { originalVerdict: "MISMATCH", action: "LINK", pageUrls: ["https://flatkey.ai/blog/verified-api"], previousPageUrl: "https://flatkey.ai/old-page",
    proposedTitle: "Verified model API integration", requirements: ["The correct model identity is explicitly documented.", "Authentication and request parameters match the query.", "The existing page directly answers the business search intent."],
    acceptance: ["Every associated URL has independently checked content.", "Model-protection and keyword membership remain preserved."] };
  const input = payload([auditRow(undefined, { workPlan })]);
  const preview = await auditKeywordPages({ ...input, action: "preview" });
  const result = await auditKeywordPages({ ...input, expectedStateHash: preview.stateHash });
  assert.equal(result.pageSummary.verified, 1);
  assert.deepEqual(state.sourceRows[0].snapshot.workPlan, workPlan);
  assert.deepEqual(member.targetUrls, workPlan.pageUrls);
  assert.equal(member.protected, true);
  const writes = state.dataWrites;
  assert.equal((await auditKeywordPages({ ...input, expectedStateHash: preview.stateHash })).duplicate, true);
  assert.equal(state.dataWrites, writes);
  for (const patch of [
    { action: "EXPAND" }, { pageUrls: ["https://flatkey.ai/not-checked"] }, { pageUrls: [] },
    { pageUrls: [...workPlan.pageUrls, ...workPlan.pageUrls] }, { requirements: ["Missing details"] },
  ]) assert.equal(pageAuditSchema.safeParse({ ...input, rows: [auditRow(undefined, { workPlan: { ...workPlan, ...patch } })] }).success, false);
});

test("schema strictly separates missing, mismatch and inconclusive HTTP evidence", () => {
  for (const status of [404, 410]) assert.equal(pageAuditSchema.safeParse({ ...payload(), rows: [auditRow(undefined, { verdict: "MISSING", httpStatus: status, canonicalUrl: undefined })] }).success, true);
  for (const status of [200, 403, 429, 500, 503]) assert.equal(pageAuditSchema.safeParse({ ...payload(), rows: [auditRow(undefined, { verdict: "MISSING", httpStatus: status })] }).success, false);
  for (const status of [403, 404, 429, 500]) assert.equal(pageAuditSchema.safeParse({ ...payload(), rows: [auditRow(undefined, { verdict: "MISMATCH", httpStatus: status })] }).success, false);
  assert.equal(pageAuditSchema.safeParse({ ...payload(), rows: [auditRow(undefined, { verdict: "MISMATCH", httpStatus: 200 })] }).success, true);
  assert.equal(pageAuditSchema.safeParse({ ...payload(), rows: [auditRow(undefined, { verdict: "REVIEW", httpStatus: 503, pageUrl: undefined, canonicalUrl: undefined, evidence: {} })] }).success, true);
});

test("schema rejects foreign or unsafe URLs, duplicate normalized words, ranking fields and future evidence", () => {
  const valid = payload();
  for (const url of ["http://flatkey.ai/page", "https://flatkey.ai.attacker.example/page", "https://user:password@flatkey.ai/page", "https://flatkey.ai:444/page", "https://other.example/page"]) {
    assert.equal(pageAuditSchema.safeParse({ ...valid, rows: [auditRow(undefined, { pageUrl: url, canonicalUrl: url })] }).success, false, url);
  }
  for (const patch of [{ rank: 1 }, { volume: 0 }, { cleanup: true }, { sourceId: "api_main" }, { targetDomain: "rackrate.org" }]) assert.equal(pageAuditSchema.safeParse({ ...valid, ...patch }).success, false);
  assert.equal(pageAuditSchema.safeParse({ ...valid, rows: [auditRow(), auditRow("ＫＥＹＷＯＲＤ-1   API")] }).success, false);
  assert.equal(pageAuditSchema.safeParse({ ...valid, rows: [] }).success, false);
  assert.equal(pageAuditSchema.safeParse({ ...valid, rows: [auditRow(undefined, { checkedAt: new Date(Date.now() + 600_000).toISOString() })] }).success, false);
});

test("a searched inventory can conclude no matching page without inventing a missing HTTP response", () => {
  const row = auditRow(undefined, { verdict: "NO_MATCH", pageUrl: undefined, canonicalUrl: undefined, httpStatus: undefined,
    reason: "Checked the full public sitemap and existing model and article inventory; no page addresses this keyword's requested integration.",
    evidence: { excerpt: "The model catalog and published integration articles contain no matching integration for this keyword." },
    inventory: { sourceUrl: "https://flatkey.ai/sitemap.xml", pageCount: 2997, checkedAt: "2026-10-15T10:00:00Z" } });
  assert.equal(pageAuditSchema.safeParse({ ...payload(), rows: [row] }).success, true);
  for (const patch of [{ inventory: undefined }, { evidence: {} }, { reason: "Not found" }, { inventory: { ...row.inventory, pageCount: 0 } }]) {
    assert.equal(pageAuditSchema.safeParse({ ...payload(), rows: [{ ...row, ...patch }] }).success, false);
  }
  const member = addMember("keyword-1", { protected: true });
  const plan = planKeywordPageAudit(payload([row]), [], [member]);
  assert.equal(plan.result.pageSummary.noMatch, 1);
  assert.equal(plan.memberships[0].after.mappingStatus, "NEEDS_BUILD");
  assert.deepEqual(plan.memberships[0].after.targetUrls, []);
  assert.deepEqual(plan.memberships[0].after.candidateUrls, member.targetUrls);
  assert.equal(member.protected, true);
  assert.equal(member.pool, "FORMAL");
});

test("content gaps require a checked canonical page and remain candidates for expansion", () => {
  const row = auditRow(undefined, { verdict: "CONTENT_GAP",
    reason: "This article explains the API but contains no request limits or rate-limit policy required by this keyword.",
    evidence: { excerpt: "The full article covers authentication and a basic request; the required rate-limit details are absent." } });
  for (const patch of [{ httpStatus: 404 }, { canonicalUrl: undefined }, { canonicalUrl: "https://flatkey.ai/other" }, { evidence: {} }]) {
    assert.equal(pageAuditSchema.safeParse({ ...payload(), rows: [{ ...row, ...patch }] }).success, false);
  }
  const member = addMember();
  const plan = planKeywordPageAudit(payload([row]), [], [member]);
  assert.equal(plan.result.pageSummary.contentGap, 1);
  assert.equal(plan.memberships[0].after.mappingStatus, "NEEDS_EXPANSION");
  assert.deepEqual(plan.memberships[0].after.targetUrls, []);
  assert.deepEqual(new Set(plan.memberships[0].after.candidateUrls), new Set([...member.targetUrls, row.pageUrl]));
});

test("one keyword retains multiple independently verified pages without duplicate URLs", async () => {
  const extra = { pageUrl: "https://flatkey.ai/models/verified-api", canonicalUrl: "https://flatkey.ai/models/verified-api",
    httpStatus: 200, checkedAt: "2026-10-15T10:00:00Z", reason: "The model detail page independently documents the matching API model, request input and service availability.",
    evidence: { title: "Verified model API", excerpt: "Model-specific API inputs and supported request format are documented on this model detail page." } };
  const row = auditRow(undefined, { additionalPages: [extra] });
  const valid = payload([row]);
  for (const patch of [{ canonicalUrl: "https://flatkey.ai/other" }, { evidence: {} }, { checkedAt: new Date(Date.now() + 600000).toISOString() },
    { pageUrl: row.pageUrl + "/#copy", canonicalUrl: row.pageUrl }]) {
    assert.equal(pageAuditSchema.safeParse({ ...valid, rows: [{ ...row, additionalPages: [{ ...extra, ...patch }] }] }).success, false);
  }
  const member = addMember("keyword-1", { candidateUrls: [extra.pageUrl] });
  const preview = await auditKeywordPages({ ...valid, action: "preview" });
  assert.deepEqual(member.targetUrls, ["https://flatkey.ai/old-page"]);
  await auditKeywordPages({ ...valid, expectedStateHash: preview.stateHash });
  assert.deepEqual(member.targetUrls, [row.pageUrl, extra.pageUrl]);
  assert.deepEqual(member.candidateUrls, ["https://flatkey.ai/old-page"]);
  assert.equal(state.sourceRows[0].snapshot.additionalPages[0].evidence.excerpt, extra.evidence.excerpt);
  assert.equal(state.membershipWrites.length, 1);
});

test("plan preview changes mappings only in its result and preserves old targets as candidates", () => {
  const member = addMember("keyword-1", { protected: true, candidateUrls: ["https://flatkey.ai/earlier-proposal"] });
  const original = clone(member);
  const plan = planKeywordPageAudit(payload(undefined, { action: "preview" }), [], [member]);
  assert.deepEqual(member, original);
  assert.equal(plan.result.pageSummary.verified, 1);
  assert.equal(plan.result.imported, 1);
  assert.equal(plan.memberships.length, 1);
  assert.equal(plan.memberships[0].after.mappingStatus, "READY");
  assert.deepEqual(plan.memberships[0].after.targetUrls, ["https://flatkey.ai/blog/verified-api"]);
  assert.deepEqual(new Set(plan.memberships[0].after.candidateUrls), new Set(["https://flatkey.ai/old-page", "https://flatkey.ai/earlier-proposal"]));
  assert.equal(plan.snapshots[0].rowKey, "keyword:keyword-1");
});

test("service preview is read-only, and verified remapping preserves protected and all unrelated manual fields", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("page audit must not crawl or call a ranking provider"); });
  const member = addMember("keyword-1", { protected: true, candidateUrls: ["https://flatkey.ai/blog/verified-api", "https://flatkey.ai/earlier-proposal"] });
  const original = clone(member), before = clone(state);
  const incoming = payload();
  const preview = await auditKeywordPages({ ...incoming, action: "preview" });
  assert.deepEqual(state, before);
  const result = await auditKeywordPages({ ...incoming, expectedStateHash: preview.stateHash });
  assert.equal(result.pageSummary.verified, 1);
  assert.equal(state.sourceRows.length, 1);
  assert.equal(state.sourceRows[0].sourceId, "page_audit");
  assert.equal(state.sourceRows[0].snapshot.checkedAt, "2026-10-15T10:00:00.000Z");
  const current = state.memberships[0];
  assert.equal(current.mappingStatus, "READY");
  assert.deepEqual(current.targetUrls, ["https://flatkey.ai/blog/verified-api"]);
  assert.deepEqual(new Set(current.candidateUrls), new Set(["https://flatkey.ai/old-page", "https://flatkey.ai/earlier-proposal"]));
  for (const key of Object.keys(original).filter(key => !["mappingStatus", "targetUrls", "candidateUrls", "auditReason"].includes(key))) assert.deepEqual(current[key], original[key], key);
  assert.match(current.auditReason, /VERIFIED/);
});

test("service bulk-loads only identities for the full pool and limits complete evidence reads to this batch", async (t) => {
  const first = addMember("keyword-1", { keyword: { text: "ＫＥＹＷＯＲＤ-1 API", active: true } });
  const second = addMember("keyword-2");
  for (let index = 0; index < 100; index++) addMember(`unrelated-${index}`, {
    auditReason: "Large prior page audit evidence ".repeat(100),
    targetUrls: [`https://flatkey.ai/unrelated-page-${index}`],
  });
  addMember("research-alias", { pool: "RESEARCH", keyword: { text: "keyword-1 api", active: true } });
  addMember("inactive-alias", { keyword: { text: "keyword-2 api", active: false } });
  const reads = [], originalFindMany = db.siteKeyword.findMany;
  t.mock.method(db.siteKeyword, "findMany", async args => {
    reads.push(clone(args));
    return originalFindMany(args);
  });
  const incoming = payload([auditRow(), auditRow("keyword-2 api")], { action: "preview" });
  const before = clone(state);
  const result = await auditKeywordPages(incoming);
  assert.deepEqual(state, before);
  assert.equal(reads.length, 2, "batch membership reads must not grow with the keyword count");
  assert.deepEqual(reads[0], {
    where: { siteDomain: "flatkey.ai", active: true, pool: "FORMAL", keyword: { active: true } },
    select: { keywordId: true, keyword: { select: { text: true, active: true } } },
  });
  assert.deepEqual(reads[1].where, {
    siteDomain: "flatkey.ai", active: true, pool: "FORMAL", keyword: { active: true }, keywordId: { in: ["keyword-1", "keyword-2"] },
  });
  assert.equal(reads[1].select.auditReason, true);
  assert.equal(reads[1].select.targetUrls, true);
  assert.equal(reads[1].select.candidateUrls, true);
  const previousFullProjection = { keywordId: true, keyword: { select: { text: true, active: true } }, active: true, pool: true, reviewStatus: true,
    curationId: true, curatedAt: true, targetUrls: true, candidateUrls: true, mappingStatus: true, topicId: true, protected: true, auditReason: true };
  const expected = planKeywordPageAudit(incoming, [], [first, second].map(row => selectFields(row, previousFullProjection)));
  assert.equal(result.stateHash, expected.result.stateHash, "batch-scoped reads preserve the existing preview hash");
});

test("unknown normalized identities skip complete membership and prior evidence reads", async (t) => {
  addMember("unrelated");
  const memberships = t.mock.method(db.siteKeyword, "findMany");
  const evidence = t.mock.method(db.keywordSourceRow, "findMany");
  await assert.rejects(auditKeywordPages(payload()), error => error.status === 400);
  assert.equal(memberships.mock.calls.length, 1);
  assert.equal(memberships.mock.calls[0].arguments[0].select.auditReason, undefined);
  assert.equal(evidence.mock.calls.length, 0);
  assert.equal(state.dataWrites, 0);
});

test("thirty members and first-time snapshots use one guarded SQL update and one evidence insert", async (t) => {
  const rows = Array.from({ length: 30 }, (_, index) => {
    const keywordId = `new-${index}`;
    addMember(keywordId);
    return auditRow(`${keywordId} api`);
  });
  const createMany = t.mock.method(db.keywordSourceRow, "createMany"), upsert = t.mock.method(db.keywordSourceRow, "upsert");
  const incoming = payload(rows), preview = await auditKeywordPages({ ...incoming, action: "preview" });
  assert.equal(createMany.mock.calls.length, 0);
  assert.equal(upsert.mock.calls.length, 0);
  const result = await auditKeywordPages({ ...incoming, expectedStateHash: preview.stateHash });
  assert.equal(result.imported, 30);
  assert.equal(state.membershipWrites.length, 30, "each membership still has its independent optimistic guard");
  assert.equal(state.membershipQueries.length, 1, "all thirty membership updates must share one database round trip");
  assert.equal(JSON.parse(state.membershipQueries[0].values[0]).length, 30);
  assert.equal(createMany.mock.calls.length, 1);
  assert.equal(createMany.mock.calls[0].arguments[0].data.length, 30);
  assert.equal(createMany.mock.calls[0].arguments[0].skipDuplicates, undefined);
  assert.equal(upsert.mock.calls.length, 0);
  assert.equal(state.sourceRows.length, 30);
  assert.equal(state.dataWrites, 2, "one membership UPDATE plus one initial-evidence SQL write");
  assert.ok(state.sourceRows.every(row => row.siteDomain === "flatkey.ai" && row.sourceId === "page_audit" && row.observedAt.toISOString() === "2026-10-15T10:00:00.000Z"));
  const afterFirst = clone(state);
  assert.equal((await auditKeywordPages({ ...incoming, expectedStateHash: preview.stateHash })).duplicate, true);
  assert.deepEqual(state, afterFirst);
  assert.equal(createMany.mock.calls.length, 1);
});

test("bulk SQL binds quoted JSON and retains every original optimistic predicate", async () => {
  const keywordId = "quoted-'id\"-\\-'; DROP TABLE never_execute; --";
  const member = addMember(keywordId, { curationId: null, curatedAt: null, topicId: null,
    auditReason: "Manual's \"quoted\" decision\nwith a backslash \\ and '; SELECT never_execute; --",
    targetUrls: ["https://flatkey.ai/quote?name=O'Reilly", "https://flatkey.ai/second"], candidateUrls: [] });
  const before = clone(member);
  await auditKeywordPages(payload([auditRow(member.keyword.text)]));
  const query = state.membershipQueries[0];
  assert.equal(query.values.length, 2, "only the JSON batch and fixed site are SQL bind values");
  assert.equal(query.values[1], "flatkey.ai");
  assert.ok(!query.text.includes("never_execute"), "quoted source values must never enter the SQL text");
  const [update] = JSON.parse(query.values[0]);
  assert.equal(update.keywordId, keywordId);
  assert.equal(update.keywordText, before.keyword.text);
  assert.equal(update.beforeAuditReason, before.auditReason);
  assert.deepEqual(update.beforeTargetUrls, before.targetUrls);
  for (const field of ["beforeCurationId", "beforeCuratedAt", "beforeTopicId"]) assert.equal(update[field], null, field);
  assert.deepEqual(member.targetUrls, ["https://flatkey.ai/blog/verified-api"]);
  for (const predicate of [
    'm."siteDomain" = $2', 'm."keywordId" = d."keywordId"', 'm.active = d."beforeActive"', 'm.pool = d."beforePool"',
    'm."reviewStatus" = d."beforeReviewStatus"', 'm."curationId" IS NOT DISTINCT FROM d."beforeCurationId"',
    'm."curatedAt" IS NOT DISTINCT FROM d."beforeCuratedAt"', 'm."mappingStatus" = d."beforeMappingStatus"',
    'm."targetUrls" = d."beforeTargetUrls"', 'm."candidateUrls" = d."beforeCandidateUrls"',
    'm."topicId" IS NOT DISTINCT FROM d."beforeTopicId"', 'm.protected = d."beforeProtected"',
    'm."auditReason" IS NOT DISTINCT FROM d."beforeAuditReason"', 'k.id = m."keywordId"', 'k.active = true', 'k.text = d."keywordText"',
  ]) assert.ok(query.text.includes(predicate), `missing SQL predicate: ${predicate}`);
  assert.match(query.text, /jsonb_to_recordset\(\$1::jsonb\)/);
  assert.match(query.text, /RETURNING m\."keywordId"/);
});

for (const [field, mutate] of Object.entries({
  siteDomain: row => { row.siteDomain = "other.example"; },
  active: row => { row.active = false; },
  pool: row => { row.pool = "RESEARCH"; },
  reviewStatus: row => { row.reviewStatus = "MANUAL_REVIEW"; },
  curationId: row => { row.curationId = null; },
  curatedAt: row => { row.curatedAt = null; },
  mappingStatus: row => { row.mappingStatus = "READY"; },
  targetUrls: row => { row.targetUrls = ["https://flatkey.ai/new-manual-target"]; },
  candidateUrls: row => { row.candidateUrls = ["https://flatkey.ai/new-manual-candidate"]; },
  topicId: row => { row.topicId = null; },
  protected: row => { row.protected = true; },
  auditReason: row => { row.auditReason = null; },
  keywordActive: row => { row.keyword.active = false; },
  keywordText: row => { row.keyword.text = "renamed keyword api"; },
})) test(`bulk guard rejects concurrent ${field} changes and rolls back the entire batch`, async (t) => {
  addMember(); addMember("keyword-2");
  const before = clone(state), original = db.$queryRaw;
  t.mock.method(db, "$queryRaw", async query => {
    mutate(state.memberships[1]);
    return original(query);
  });
  await assert.rejects(auditKeywordPages(payload([auditRow(), auditRow("keyword-2 api")])), error => error.status === 409);
  assert.deepEqual(state, before, "the other matched member and all new evidence must roll back too");
});

test("a single changed member cancels all thirty bulk updates before evidence insertion", async (t) => {
  const rows = Array.from({ length: 30 }, (_, index) => {
    addMember(`concurrent-${index}`);
    return auditRow(`concurrent-${index} api`);
  });
  const before = clone(state), original = db.$queryRaw;
  let matched;
  t.mock.method(db, "$queryRaw", async query => {
    state.memberships[29].protected = true;
    const result = await original(query);
    matched = result.length;
    return result;
  });
  await assert.rejects(auditKeywordPages(payload(rows)), error => error.status === 409);
  assert.equal(matched, 29, "the result count must expose the one conflicting member");
  assert.deepEqual(state, before);
});

test("mixed first and later evidence bulk-inserts only missing snapshot identities and preserves existing updates", async (t) => {
  addMember();
  await auditKeywordPages(payload());
  addMember("keyword-2");
  const createMany = t.mock.method(db.keywordSourceRow, "createMany"), upsert = t.mock.method(db.keywordSourceRow, "upsert");
  const rows = [auditRow(undefined, { checkedAt: "2026-10-15T11:00:00Z" }), auditRow("keyword-2 api", { checkedAt: "2026-10-15T11:00:00Z" })];
  const result = await auditKeywordPages(payload(rows, { requestId: "mixed-evidence" }));
  assert.equal(result.imported, 2);
  assert.equal(createMany.mock.calls.length, 1);
  assert.deepEqual(createMany.mock.calls[0].arguments[0].data.map(row => row.rowKey), ["keyword:keyword-2"]);
  assert.equal(upsert.mock.calls.length, 1);
  assert.equal(upsert.mock.calls[0].arguments[0].where.siteDomain_sourceId_rowKey.rowKey, "keyword:keyword-1");
  assert.equal(state.sourceRows.length, 2);
  assert.ok(state.sourceRows.every(row => row.observedAt.toISOString() === "2026-10-15T11:00:00.000Z"));
});

test("a conflicting initial snapshot rolls back every optimistic member write instead of silently skipping evidence", async (t) => {
  addMember(); addMember("keyword-2");
  const before = clone(state);
  t.mock.method(db.keywordSourceRow, "createMany", async args => {
    assert.notEqual(args.skipDuplicates, true);
    throw new Error("simulated snapshot uniqueness conflict");
  });
  await assert.rejects(auditKeywordPages(payload([auditRow(), auditRow("keyword-2 api")])), /snapshot uniqueness conflict/);
  assert.deepEqual(state, before);
});

test("missing 404 or 410 clears every target for the completed keyword audit and retains old evidence candidates", async () => {
  addMember("missing-404", { targetUrls: ["https://flatkey.ai/one", "https://flatkey.ai/two"], protected: true });
  addMember("missing-410");
  const result = await auditKeywordPages(payload([
    auditRow("missing-404 api", { verdict: "MISSING", httpStatus: 404, canonicalUrl: undefined }),
    auditRow("missing-410 api", { verdict: "MISSING", httpStatus: 410, canonicalUrl: undefined }),
  ]));
  assert.equal(result.pageSummary.missing, 2);
  assert.equal(state.memberships[0].mappingStatus, "NEEDS_BUILD");
  assert.deepEqual(state.memberships[0].targetUrls, []);
  assert.deepEqual(new Set(state.memberships[0].candidateUrls), new Set(["https://flatkey.ai/one", "https://flatkey.ai/two", "https://flatkey.ai/blog/verified-api"]));
  assert.equal(state.memberships[0].protected, true);
  assert.equal(state.memberships[1].mappingStatus, "NEEDS_BUILD");
  assert.deepEqual(state.memberships[1].targetUrls, []);
});

test("HTTP 200 intent mismatch clears targets into candidates without changing formal membership", async () => {
  const original = clone(addMember());
  const result = await auditKeywordPages(payload([auditRow(undefined, { verdict: "MISMATCH" })]));
  assert.equal(result.pageSummary.mismatch, 1);
  assert.equal(state.memberships[0].mappingStatus, "NEEDS_REMAP");
  assert.deepEqual(state.memberships[0].targetUrls, []);
  assert.deepEqual(new Set(state.memberships[0].candidateUrls), new Set([...original.targetUrls, "https://flatkey.ai/blog/verified-api"]));
  assert.equal(state.memberships[0].pool, "FORMAL");
  assert.equal(state.memberships[0].active, true);
  assert.equal(state.memberships[0].reviewStatus, "CONFIRMED");
});

test("REVIEW stores evidence without altering READY, MODEL_PROTECTED or RECORDED members", async () => {
  const statuses = ["READY", "MODEL_PROTECTED", "RECORDED"];
  for (const [index, mappingStatus] of statuses.entries()) addMember(`review-${index}`, { mappingStatus, protected: mappingStatus === "MODEL_PROTECTED" });
  const before = clone(state.memberships);
  const result = await auditKeywordPages(payload(statuses.map((_, index) => auditRow(`review-${index} api`, { verdict: "REVIEW", httpStatus: 429, canonicalUrl: undefined, evidence: {} }))));
  assert.equal(result.pageSummary.review, 3);
  assert.equal(result.imported, 3);
  assert.deepEqual(state.memberships, before);
  assert.equal(state.membershipWrites.length, 0);
  assert.equal(state.sourceRows.length, 3);
  assert.ok(result.changes.every(change => change.fields.length === 0));
});

test("unknown, other-site, non-formal and inactive identities reject atomically without creating inventory", async () => {
  for (const overrides of [null, { siteDomain: "rackrate.org" }, { pool: "RESEARCH" }, { active: false }, { keyword: { text: "keyword-1 api", active: false } }]) {
    state.memberships = [];
    if (overrides) addMember("keyword-1", overrides);
    const before = clone(state);
    await assert.rejects(auditKeywordPages(payload()), error => error.status === 400);
    assert.deepEqual(state, before);
  }
});

test("normalized duplicate formal identities are conflicts rather than arbitrary remappings", async () => {
  addMember("keyword-1"); addMember("keyword-2", { keyword: { text: "ＫＥＹＷＯＲＤ-1 API", active: true } });
  const before = clone(state);
  await assert.rejects(auditKeywordPages(payload()), error => error.status === 409);
  assert.deepEqual(state, before);
});

test("an exact lost-response replay bypasses its old preview token and never overwrites later manual page edits", async () => {
  addMember();
  const incoming = payload();
  const preview = await auditKeywordPages({ ...incoming, action: "preview" });
  const approved = { ...incoming, expectedStateHash: preview.stateHash };
  await auditKeywordPages(approved);
  const afterFirst = clone(state);
  const replay = await auditKeywordPages(approved);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.imported, 0);
  assert.deepEqual(state, afterFirst);
  state.memberships[0].targetUrls = ["https://flatkey.ai/later-manual-page"];
  state.memberships[0].mappingStatus = "RECORDED";
  const afterManual = clone(state);
  assert.equal((await auditKeywordPages(approved)).duplicate, true);
  assert.deepEqual(state, afterManual);
});

test("old or contradictory same-time evidence cannot replace newer proof or a later manual audit", async () => {
  addMember();
  await auditKeywordPages(payload());
  const before = clone(state);
  for (const checkedAt of ["2026-10-15T09:59:59Z", "2026-10-15T10:00:00Z"]) {
    await assert.rejects(auditKeywordPages(payload([auditRow(undefined, { verdict: "MISSING", canonicalUrl: undefined, httpStatus: 404, checkedAt })])), error => error.status === 409);
    assert.deepEqual(state, before);
  }
  state.sourceRows = [];
  state.memberships[0].curatedAt = new Date("2026-10-15T12:00:00Z");
  const afterManual = clone(state);
  await assert.rejects(auditKeywordPages(payload()), error => error.status === 409);
  assert.deepEqual(state, afterManual);
});

test("a newer same-outcome inspection records fresh evidence without changing unrelated configuration", async () => {
  addMember();
  await auditKeywordPages(payload());
  const result = await auditKeywordPages(payload([auditRow(undefined, { checkedAt: "2026-10-15T11:00:00Z" })], { requestId: "later-audit" }));
  assert.equal(result.duplicate, false);
  assert.equal(result.imported, 1);
  assert.equal(state.sourceRows[0].observedAt.toISOString(), "2026-10-15T11:00:00.000Z");
  assert.deepEqual(state.memberships[0].targetUrls, ["https://flatkey.ai/blog/verified-api"]);
});

test("preview binds both evidence payload and later manual membership changes", async () => {
  addMember();
  const incoming = payload();
  const preview = await auditKeywordPages({ ...incoming, action: "preview" });
  const altered = payload([auditRow(undefined, { pageUrl: "https://flatkey.ai/alternate", canonicalUrl: "https://flatkey.ai/alternate" })], { expectedStateHash: preview.stateHash });
  const before = clone(state);
  await assert.rejects(auditKeywordPages(altered), error => error.status === 409);
  assert.deepEqual(state, before);
  state.memberships[0].candidateUrls = ["https://flatkey.ai/later-proposal"];
  const afterManual = clone(state);
  await assert.rejects(auditKeywordPages({ ...incoming, expectedStateHash: preview.stateHash }), error => error.status === 409);
  assert.deepEqual(state, afterManual);
});

test("source evidence failures roll back every member update and identical concurrent requests commit once", async () => {
  addMember(); addMember("keyword-2");
  state.failEvidenceWrite = true;
  const before = clone(state), incoming = payload([auditRow(), auditRow("keyword-2 api")]);
  await assert.rejects(auditKeywordPages(incoming), /simulated page evidence write failure/);
  assert.deepEqual(state, before);
  state.failEvidenceWrite = false;
  const results = await Promise.all([auditKeywordPages(incoming), auditKeywordPages(incoming)]);
  assert.equal(results.filter(result => result.duplicate).length, 1);
  assert.equal(state.sourceRows.length, 2);
  assert.equal(state.membershipWrites.length, 2);
});

test("optimistic member guards cancel the batch if manual configuration changes during application", async (t) => {
  addMember();
  const originalUpdate = db.$queryRaw;
  let intercepted = false;
  t.mock.method(db, "$queryRaw", async args => {
    if (!intercepted) {
      intercepted = true;
      state.memberships[0].protected = true;
      state.memberships[0].topicId = "changed-manual-topic";
    }
    return originalUpdate(args);
  });
  await assert.rejects(auditKeywordPages(payload()), error => error.status === 409);
  assert.equal(state.sourceRows.length, 0);
  assert.equal(state.membershipWrites.length, 0);
});

test("route requires an enabled real cookie session and rejects collector, cron and disabled-login access", async () => {
  addMember();
  const incoming = payload(undefined, { action: "preview" });
  assert.equal((await POST(request(incoming))).status, 401);
  assert.equal((await POST(request(incoming, "Bearer fictional-page-audit-import-token"))).status, 401);
  process.env.CRON_SECRET = "fictional-page-audit-cron-token";
  assert.equal((await POST(request(incoming, "Bearer fictional-page-audit-cron-token"))).status, 401);
  sessionToken = "incorrect-session";
  assert.equal((await POST(request(incoming))).status, 401);
  sessionToken = await getAuthToken();
  const signedIn = await POST(request(incoming));
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.headers.get("Cache-Control"), /no-store/);
  assert.equal((await signedIn.json()).kind, "page-audit");
  delete process.env.LOGIN_PWD;
  assert.equal((await POST(request(incoming))).status, 401);
  assert.equal(state.dataWrites, 0);
});

test("route rejects invalid evidence and returns safe failure details without exposing private errors", async () => {
  addMember();
  sessionToken = await getAuthToken();
  assert.equal((await POST(request({ ...payload(), rank: 1 }))).status, 400);
  assert.equal(state.dataWrites, 0);
  state.failEvidenceWrite = true;
  const response = await POST(request(payload()));
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.ok(!JSON.stringify(result).includes("simulated page evidence write failure"));
  assert.equal(state.sourceRows.length, 0);
  assert.equal(state.membershipWrites.length, 0);
});
