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
  seoSite: { findUnique: async () => ({ domain: "flatkey.ai", active: state.siteActive }) },
  siteKeyword: {
    findMany: async ({ where }) => state.memberships.filter(row => matches(row, where)).map(clone),
    updateMany: async ({ where, data }) => {
      if (state.beforeMembershipWrite) state.beforeMembershipWrite();
      const rows = state.memberships.filter(row => matches(row, where));
      if (rows.length) {
        countWrite();
        state.membershipWrites.push(clone({ where, data }));
        for (const row of rows) Object.assign(row, clone(data));
      }
      return { count: rows.length };
    },
  },
  keywordSourceRow: {
    findMany: async ({ where }) => state.sourceRows.filter(row => matches(row, where)).map(clone),
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
  state = { siteActive: true, memberships: [], sourceRows: [], membershipWrites: [], dataWrites: 0, failEvidenceWrite: false };
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
  assert.deepEqual(new Set(state.memberships[0].candidateUrls), new Set(["https://flatkey.ai/one", "https://flatkey.ai/two"]));
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
  assert.deepEqual(state.memberships[0].candidateUrls, original.targetUrls);
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
  const originalUpdate = db.siteKeyword.updateMany;
  let intercepted = false;
  t.mock.method(db.siteKeyword, "updateMany", async args => {
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
