const assert = require("node:assert/strict");
const { test } = require("node:test");
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
const { classifySerpMonitoringCohort, eligibleSerpTargets, serpTargetKey } = require("../src/lib/serp-targets.ts");
const target = (id, changes = {}) => ({ keywordId: id, keyword: `${id} api`, siteDomain: "flatkey.ai", targetUrls: [`https://flatkey.ai/models/${id}`], ...changes });
const proof = (verdict, pageUrls, workPlan) => ({ pageAudit: { verdict, pageUrls, workPlan } });

test("paid readiness preserves the full inventory while existing pages needing optimization remain eligible with empty targetUrls", () => {
  const matched = target("matched"), optimize = target("optimize", { targetUrls: [] }), build = target("build", { targetUrls: [] });
  const evidence = new Map([
    [serpTargetKey(matched), proof("VERIFIED", matched.targetUrls)],
    [serpTargetKey(optimize), proof("CONTENT_GAP", ["https://flatkey.ai/blog/model-pricing"], { action: "EXPAND", pageUrls: ["https://flatkey.ai/blog/model-pricing"] })],
    [serpTargetKey(build), proof("NO_MATCH", [], { action: "BUILD", pageUrls: [] })],
  ]);
  const all = [matched, optimize, build], before = structuredClone(all), result = classifySerpMonitoringCohort(all, evidence);
  assert.deepEqual(result.targets.map(row => row.keywordId), ["matched", "optimize"]);
  assert.deepEqual(result.targets[1].targetUrls, ["https://flatkey.ai/blog/model-pricing"]);
  assert.equal(result.allTargetCount, 3); assert.equal(result.heldTargetCount, 1);
  assert.equal(result.heldTargets[0].reason, "PAGE_NOT_BUILT");
  assert.match(result.heldTargets[0].reasonLabel, /上线并核实/);
  assert.equal(result.breakdown.verifiedPages, 1); assert.equal(result.breakdown.existingPagesToOptimize, 1);
  assert.deepEqual(all, before, "holding a word must not remove or mutate its formal inventory record");
});

test("negative page audits cannot be overridden by a completed source row, an old URL or a ready label", () => {
  const verdicts = ["NO_MATCH", "MISSING", "MISMATCH", "REVIEW"];
  const all = verdicts.map(verdict => target(verdict));
  const evidence = new Map(all.map((row, index) => [serpTargetKey(row), {
    ...proof(verdicts[index], row.targetUrls), verifiedSourcePages: row.targetUrls,
  }]));
  const result = classifySerpMonitoringCohort(all, evidence);
  assert.equal(result.targets.length, 0);
  assert.deepEqual(result.heldTargets.map(row => row.reason), ["PAGE_NOT_BUILT", "PAGE_NOT_BUILT", "PAGE_INTENT_MISMATCH", "PAGE_REVIEW_REQUIRED"]);
});

test("source URLs alone do not qualify either other site and research memberships stay outside the formal input", () => {
  const rows = [target("rack", { siteDomain: "rackrate.org", targetUrls: ["https://rackrate.org/"] }),
    target("model", { siteDomain: "modelfit.cc", targetUrls: ["https://modelfit.cc/calculator"] })];
  assert.deepEqual(classifySerpMonitoringCohort(rows, new Map()).heldTargets.map(row => row.reason), ["NO_VERIFIED_PAGE", "NO_VERIFIED_PAGE"]);
  const candidates = ["FORMAL", "RESEARCH"].map(pool => ({ text: "new model api", keywordId: pool, siteDomain: "flatkey.ai", active: true,
    keywordActive: true, siteActive: true, topicId: "model", pool }));
  assert.deepEqual(eligibleSerpTargets(candidates).map(row => row.pool), ["FORMAL"]);
});

test("every paid target URL needs same-site HTTPS proof and independently verified multi-page matches are retained", () => {
  const row = target("multiple", { targetUrls: ["https://flatkey.ai/models/multiple/", "https://flatkey.ai/blog/multiple#section", "https://flatkey.ai/unverified"] });
  const result = classifySerpMonitoringCohort([row], new Map([[serpTargetKey(row), proof("VERIFIED", ["https://flatkey.ai/models/multiple", "https://flatkey.ai/blog/multiple"] )]]));
  assert.deepEqual(result.targets[0].targetUrls, ["https://flatkey.ai/blog/multiple", "https://flatkey.ai/models/multiple"]);
  const invalid = target("invalid", { targetUrls: ["https://flatkey.ai.attacker.test/model", "http://flatkey.ai/model", "https://flatkey.ai:8443/model"] });
  assert.equal(classifySerpMonitoringCohort([invalid], new Map([[serpTargetKey(invalid), proof("VERIFIED", invalid.targetUrls)]])).targets.length, 0);
});

let queries = [], storedRows = [], cohortRows = [];
const prismaPath = require.resolve("../src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: {
  $queryRaw: async query => {
    queries.push(query);
    if (query.sql.includes("serp-monitor:cohort")) return cohortRows;
    if (query.sql.includes("serp-monitor:page-readiness-evidence")) return storedRows;
    assert.fail("unexpected database read");
  },
} } };
const { loadSerpMonitoringCohort } = require("../src/lib/services/serp-targets.ts");
const sourceRow = (keyword, pageUrl, changes = {}) => ({ siteDomain: "flatkey.ai", sourceId: "optimization", rowKey: keyword,
  snapshot: { completion: "COMPLETED", pageUrl, publication: { pageVerified: true, verificationReason: "页面已公开可访问且正文满足该关键词的主要搜索意图" },
    keywords: [{ keyword, relevance: "RELEVANT", pageIntentMatched: true }], ...changes } });

test("the read-only service admits future completed and independently verified source words without adding candidates or rewriting the denominator", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("readiness must never call a page or paid provider"));
  const rows = [target("matched"), target("optimize", { targetUrls: [] }), target("build", { targetUrls: [] }),
    target("new", { targetUrls: [] }), target("rack", { siteDomain: "rackrate.org", targetUrls: ["https://rackrate.org/"] })];
  const original = structuredClone(rows);
  queries = []; storedRows = [
    { siteDomain: "flatkey.ai", sourceId: "page_audit", rowKey: "keyword:matched", snapshot: { keywordId: "matched", verdict: "VERIFIED", pageUrl: rows[0].targetUrls[0] } },
    { siteDomain: "flatkey.ai", sourceId: "page_audit", rowKey: "keyword:optimize", snapshot: { keywordId: "optimize", verdict: "CONTENT_GAP", pageUrl: "https://flatkey.ai/blog/optimize", workPlan: { action: "EXPAND", pageUrls: ["https://flatkey.ai/blog/optimize"] } } },
    { siteDomain: "flatkey.ai", sourceId: "page_audit", rowKey: "keyword:build", snapshot: { keywordId: "build", verdict: "NO_MATCH" } },
    sourceRow("build api", "https://flatkey.ai/blog/build"),
    sourceRow("new api", "https://flatkey.ai/models/new"), sourceRow("new api", "https://flatkey.ai/blog/new"),
    sourceRow("research api", "https://flatkey.ai/models/research"),
  ];
  const result = await loadSerpMonitoringCohort("all", { targets: rows, hash: "a".repeat(64) });
  assert.equal(queries.length, 1); assert.ok(queries[0].sql.includes("page-readiness-evidence"));
  assert.equal(result.allTargetCount, 5); assert.equal(result.heldTargetCount, 2); assert.equal(result.targets.length, 3);
  assert.equal(result.allTargetHash, "a".repeat(64)); assert.match(result.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.allTargets, original);
  assert.deepEqual(result.targets.find(row => row.keywordId === "new").targetUrls, ["https://flatkey.ai/blog/new", "https://flatkey.ai/models/new"]);
  assert.equal(result.breakdown.sourceVerifiedPages, 1);
  assert.deepEqual(result.heldTargets.map(row => row.keywordId), ["build", "rack"]);
  assert.ok(!result.targets.some(row => row.keywordId === "research"));
  const repeated = await loadSerpMonitoringCohort("all", { targets: rows, hash: "a".repeat(64) });
  assert.equal(repeated.hash, result.hash);
});

test("source completion needs public-page and per-keyword intent verification, and conflicting audit identity fails closed", async () => {
  const rows = [target("pending"), target("not-public"), target("wrong-intent"), target("identity")];
  storedRows = [sourceRow("pending api", rows[0].targetUrls[0], { completion: "PENDING" }),
    sourceRow("not-public api", rows[1].targetUrls[0], { publication: { pageVerified: false, verificationReason: "状态写已完成并不证明真实页面存在" } }),
    sourceRow("wrong-intent api", rows[2].targetUrls[0], { keywords: [{ keyword: "wrong-intent api", relevance: "RELEVANT", pageIntentMatched: false }] }),
    sourceRow("identity api", rows[3].targetUrls[0]),
    { siteDomain: "flatkey.ai", sourceId: "page_audit", rowKey: "keyword:identity", snapshot: { keywordId: "different", verdict: "VERIFIED", pageUrl: rows[3].targetUrls[0] } },
  ];
  const result = await loadSerpMonitoringCohort("all", { targets: rows, hash: "a".repeat(64) });
  assert.equal(result.targets.length, 0); assert.equal(result.heldTargetCount, 4);
  assert.equal(result.heldTargets[3].reason, "PAGE_REVIEW_REQUIRED");
});

test("loading monitoring readiness retains the original strict formal-cohort selector", async () => {
  queries = []; storedRows = [];
  cohortRows = [{ ...target("formal"), text: "formal api", active: true, keywordActive: true, siteActive: true, topicId: "topic", pool: "FORMAL" },
    { ...target("research"), text: "research api", active: true, keywordActive: true, siteActive: true, topicId: "topic", pool: "RESEARCH" }];
  const result = await loadSerpMonitoringCohort();
  assert.equal(result.allTargetCount, 1); assert.equal(result.allTargets[0].keywordId, "formal");
  assert.equal(result.heldTargetCount, 1); assert.equal(queries.length, 2);
});
