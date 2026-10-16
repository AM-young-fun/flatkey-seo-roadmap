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

let rows, reads, siteLinks, sessionToken;
const db = {
  keywordSourceRow: { findMany: async args => { reads.push(args); return rows; } },
  seoSite: { findMany: async () => [{ domain: "flatkey.ai", name: "Flatkey", ga4PropertyId: null }, { domain: "rackrate.org", name: "RackRate", ga4PropertyId: null }] },
  keywordCurationAudit: { findFirst: async () => ({ id: "applied-audit" }) },
  siteKeyword: { findMany: async () => siteLinks },
  rankingImport: { findMany: async () => [] },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: {
  cookies: async () => ({ get: name => name === "seo_rank_auth" && sessionToken ? { value: sessionToken } : undefined }),
} };
const { loadLatestPageAudits } = require("../src/lib/services/keyword-page-audit-state.ts");
const { GET: exportWorklist } = require("../src/app/api/seo/worklist/route.ts");
const { getAuthToken } = require("../src/lib/auth.ts");
const audit = (id, verdict = "VERIFIED", overrides = {}) => ({ rowKey: `keyword:${id}`, snapshot: {
  version: 1, keywordId: id, keyword: `${id} api`, verdict, checkedAt: "2026-10-16T06:00:00.000Z", reason: "The latest manual inspection directly checked the page and keyword intent.", ...overrides,
} });

beforeEach(() => {
  rows = []; reads = []; siteLinks = []; sessionToken = null;
  process.env.LOGIN_PWD = "page-audit-state-test-password";
});

test("empty monitoring inventory does not read any audit rows", async () => {
  const result = await loadLatestPageAudits([]);
  assert.ok(result instanceof Map);
  assert.equal(result.size, 0);
  assert.equal(reads.length, 0);
});

test("one site-scoped batch returns each latest verdict together with its human evidence metadata", async () => {
  rows = [audit("verified"), audit("missing", "MISSING"), audit("mismatch", "MISMATCH"), audit("review", "REVIEW")];
  const result = await loadLatestPageAudits(["verified", "missing", "mismatch", "review"]);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].where.siteDomain, "flatkey.ai");
  assert.equal(reads[0].where.sourceId, "page_audit");
  assert.deepEqual(new Set(reads[0].where.rowKey.in), new Set(rows.map(row => row.rowKey)));
  for (const [id, verdict] of [["verified", "VERIFIED"], ["missing", "MISSING"], ["mismatch", "MISMATCH"], ["review", "REVIEW"]]) {
    assert.deepEqual(result.get(id), { verdict, reason: rows[0].snapshot.reason, checkedAt: rows[0].snapshot.checkedAt });
  }
});

test("an absent audit is absent from the map instead of becoming an invented negative verdict", async () => {
  rows = [audit("existing", "REVIEW")];
  const result = await loadLatestPageAudits(["existing", "not-reviewed"]);
  assert.equal(result.get("existing").verdict, "REVIEW");
  assert.equal(result.has("not-reviewed"), false);
  assert.equal(result.get("not-reviewed"), undefined);
  assert.equal(reads.length, 1);
});

test("malformed stored audit rows fail closed while missing or non-string metadata remains nullable", async () => {
  rows = [
    { rowKey: "keyword:null-snapshot", snapshot: null },
    { rowKey: "keyword:primitive", snapshot: "VERIFIED" },
    { rowKey: "keyword:unknown", snapshot: { verdict: "UNKNOWN" } },
    { rowKey: "keyword:wrong-shape", snapshot: { status: "VERIFIED" } },
    audit("bad-metadata", "VERIFIED", { reason: 9, checkedAt: false }),
  ];
  const ids = ["null-snapshot", "primitive", "unknown", "wrong-shape", "bad-metadata"];
  const result = await loadLatestPageAudits(ids);
  for (const id of ids.slice(0, -1)) assert.deepEqual(result.get(id), { verdict: "REVIEW", reason: null, checkedAt: null });
  assert.deepEqual(result.get("bad-metadata"), { verdict: "VERIFIED", reason: null, checkedAt: null });
});

test("evidence for a different keyword identity cannot verify the requested row", async () => {
  rows = [audit("requested", "VERIFIED", { keywordId: "different-keyword" }), audit("legacy", "MISSING", { keywordId: undefined })];
  const result = await loadLatestPageAudits(["requested", "legacy"]);
  assert.equal(result.get("requested").verdict, "REVIEW");
  assert.equal(result.get("legacy").verdict, "MISSING");
});

test("unexpected source-row identities are ignored even if a database adapter returns extra rows", async () => {
  rows = [audit("requested"), audit("not-requested"), { rowKey: "api_main:requested", snapshot: audit("requested").snapshot }];
  const result = await loadLatestPageAudits(["requested", "requested"]);
  assert.equal(reads.length, 1);
  assert.deepEqual([...result.keys()], ["requested"]);
  assert.equal(result.get("requested").verdict, "VERIFIED");
});

test("invalid evidence dates remain null while valid timestamps are consistently serialized to UTC", async () => {
  rows = [audit("invalid-date", "REVIEW", { checkedAt: "not-a-date" }), audit("offset-date", "VERIFIED", { checkedAt: "2026-10-16T14:00:00+08:00" })];
  const result = await loadLatestPageAudits(["invalid-date", "offset-date"]);
  assert.equal(result.get("invalid-date").checkedAt, null);
  assert.equal(result.get("offset-date").checkedAt, "2026-10-16T06:00:00.000Z");
});

test("worklist export applies the latest page verdict with one batched read and preserves site boundaries", async () => {
  const link = (keywordId, overrides = {}) => ({ keywordId, siteDomain: "flatkey.ai", origin: "PLANNED", pool: "FORMAL", mappingStatus: "READY",
    targetUrls: ["https://flatkey.ai/models/model"], keyword: { text: `${keywordId} api` }, topic: { text: "Models" }, ...overrides });
  siteLinks = [link("latest-review"), link("verified"), link("not-audited"), link("protected-model", { mappingStatus: "MODEL_PROTECTED" }),
    link("latest-review", { siteDomain: "rackrate.org", targetUrls: ["https://rackrate.org/models/model"] })];
  rows = [audit("latest-review", "REVIEW"), audit("verified"), audit("protected-model")];
  sessionToken = await getAuthToken();
  const response = await exportWorklist();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /private, no-store/);
  const result = await response.json();
  assert.equal(reads.length, 1);
  assert.deepEqual(new Set(reads[0].where.rowKey.in), new Set(["keyword:latest-review", "keyword:verified", "keyword:not-audited", "keyword:protected-model"]));
  const flatkey = result.sites.find(site => site.domain === "flatkey.ai");
  const reviewCandidate = flatkey.candidates.find(entry => entry.keyword === "latest-review api");
  assert.equal(reviewCandidate.latestPageAuditVerdict, "REVIEW");
  assert.equal(reviewCandidate.mappingStatus, "READY");
  assert.equal(reviewCandidate.monitoringEligible, false);
  assert.ok(!flatkey.keywords.some(entry => entry.keyword === "latest-review api"));
  assert.equal(flatkey.keywords.find(entry => entry.keyword === "verified api").latestPageAuditVerdict, "VERIFIED");
  assert.equal(flatkey.keywords.find(entry => entry.keyword === "not-audited api").latestPageAuditVerdict, null);
  const protectedCandidate = flatkey.candidates.find(entry => entry.keyword === "protected-model api");
  assert.equal(protectedCandidate.latestPageAuditVerdict, "VERIFIED");
  assert.equal(protectedCandidate.monitoringEligible, false);
  const rackrate = result.sites.find(site => site.domain === "rackrate.org");
  assert.equal(rackrate.keywords[0].latestPageAuditVerdict, null);
  assert.equal(rackrate.keywords[0].monitoringEligible, true);
});
