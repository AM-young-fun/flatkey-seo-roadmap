const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const review = require("../src/lib/approved-keyword-review.ts");
const { buildSerpTask, configForSerpRegion, serpTaskId, serpQueryKey } = require("../src/lib/dataforseo-serp.ts");
const { isOwnedBrandKeyword } = require("../src/lib/keyword-market-policy.ts");
const plan = () => review.getApprovedKeywordReviewPlan();
function validRun() {
  return { id: review.RUN_ID, scope: review.APPROVED_KEYWORD_REVIEW_SCOPE, periodKey: review.PERIOD_KEY, status: "RUNNING",
    targetCount: 1031, queryCount: 1031, estimatedCostMicros: review.MAX_COST_MICROS, reservedCostMicros: review.MAX_COST_MICROS,
    actualCostMicros: null, cohortHash: review.APPROVED_KEYWORD_REVIEW_QUERY_HASH, cohortJson: plan().targets,
    configJson: { paidEnabled: false, approvedKeywordReview: { quoteSha256: review.APPROVAL_QUOTE_SHA256,
      queryHash: review.APPROVED_KEYWORD_REVIEW_QUERY_HASH, userApproved: true, approvalText: "Exact user-approved one-off review", approvalRecordedAt: "2026-11-23T03:00:00Z" } } };
}
function validTasks() {
  return plan().queries.map(query => ({ id: serpTaskId(review.RUN_ID, query.queryKey), runId: review.RUN_ID,
    queryKey: query.queryKey, keyword: query.keyword, region: query.region, state: "PLANNED", costMicros: null,
    targetsJson: query.targets, requestJson: buildSerpTask(query, serpTaskId(review.RUN_ID, query.queryKey), configForSerpRegion(query.region)) }));
}

test("frozen approval is exactly 1031 original single-country queries and the $6.186 cap", () => {
  const p = plan(), counts = { US: 0, JP: 0, ES: 0, BR: 0 };
  assert.equal(p.queries.length, 1031); assert.equal(p.targets.length, 1031);
  assert.equal(review.APPROVAL_QUOTE_SHA256, "593fe62523e30b831e7c6d821f8278ab0c9b345a27f8271c970cdbe4ca025e86");
  assert.equal(p.queryHash, "b37a0e1195d6f3304eb0525f6f01195cfd211673a405f39d3bdb6731efcb08df");
  assert.equal(p.queries.length * 6000, review.MAX_COST_MICROS);
  assert.equal(review.MAX_COST_MICROS, 6186000);
  for (const q of p.queries) {
    counts[q.region]++;
    assert.equal(q.queryKey, `${q.region}:${serpQueryKey(q.keyword)}`);
    assert.equal(isOwnedBrandKeyword(q.keyword), false);
    assert.equal(q.targets.length, 1); assert.equal(q.targets[0].siteDomain, "flatkey.ai");
    assert.equal(q.targets[0].keywordId, q.keywordId); assert.equal(q.targets[0].keyword, q.keyword);
    assert.deepEqual(q.targets[0].targetUrls, q.targetUrls);
    assert.equal(Object.hasOwn(q.targets[0], "marketAssignment"), false, "approval must not manufacture a permanent primary market");
    const request = buildSerpTask(q, serpTaskId(review.RUN_ID, q.queryKey), configForSerpRegion(q.region));
    assert.equal(request.depth, 100); assert.equal(request.device, "desktop");
    assert.equal(request.calculate_rectangles, false); assert.equal(request.load_async_ai_overview, false);
  }
  assert.deepEqual(counts, { US: 1002, JP: 20, ES: 1, BR: 8 });
  assert.equal(new Set(p.queries.map(q => serpQueryKey(q.keyword))).size, 1031, "no cross-country broadcast");
  assert.equal(p.queries.some(q => q.queryKey === "BR:nvidia b300"), false, "the prior paid combination is not charged again");
  assert.equal(p.queries.filter(q => !q.targetUrls.length).length, 150, "missing pages remain approved diagnostics, not invented page matches");
});

test("468 held words remain a separate unassigned display inventory without paid queries", () => {
  const held = review.APPROVED_KEYWORD_REVIEW_HELD, ids = new Set(plan().targets.map(q => q.keywordId));
  assert.equal(held.length, 468); assert.equal(new Set(held.map(q => q.keywordId)).size, 468);
  for (const row of held) { assert.equal(ids.has(row.keywordId), false); assert.ok(row.reason); assert.equal(Object.hasOwn(row, "region"), false); }
  assert.ok(held.some(row => row.keyword === "nvidia b300"));
});

test("returned plans cannot mutate the frozen paid approval", () => {
  const first = plan(); first.queries[0].keyword = "injected pricing";
  first.targets[0].targetUrls.push("https://flatkey.ai/injected"); first.queries.pop();
  assert.notEqual(plan().queries[0].keyword, "injected pricing"); assert.equal(plan().queries.length, 1031);
  assert.equal(plan().targets[0].targetUrls.includes("https://flatkey.ai/injected"), false);
  assert.equal(Object.isFrozen(review.APPROVED_KEYWORD_REVIEW_QUERIES), true);
  assert.equal(Object.isFrozen(review.APPROVED_KEYWORD_REVIEW_QUERIES[0].targetUrls), true);
});

test("a one-off run is authorized while recurring paidEnabled remains false", () => {
  const run = validRun(); assert.deepEqual(review.assertApprovedKeywordReviewRun(run), plan());
  assert.equal(run.configJson.paidEnabled, false);
  assert.deepEqual(review.assertApprovedKeywordReviewRun(run, validTasks()), plan());
});

test("whole task verification ignores DB JSON object-key order and task row order", () => {
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  const run = reorder(validRun()), tasks = validTasks().reverse().map(reorder);
  assert.deepEqual(review.assertApprovedKeywordReviewRun(run, tasks), plan());
});

test("scope, approval, frozen cohort, reserved cap and unknown outcomes cannot be bypassed", () => {
  const mutations = [
    r => r.scope = "SCHEDULED", r => r.id += "-retry", r => r.periodKey = "2026-11-17",
    r => r.queryCount = 5995, r => r.targetCount--,
    r => r.estimatedCostMicros++, r => r.reservedCostMicros++, r => r.reservedCostMicros--,
    r => r.configJson.approvedKeywordReview.quoteSha256 = "0".repeat(64),
    r => r.configJson.approvedKeywordReview.queryHash = "0".repeat(64),
    r => r.configJson.approvedKeywordReview.userApproved = false,
    r => r.cohortHash = "0".repeat(64), r => r.cohortJson[0].keyword += " changed",
    r => r.cohortJson[0].targetUrls.push("https://flatkey.ai/changed"),
    r => r.cohortJson[0].marketAssignment = { primaryCountry: "BR" },
    r => r.status = "UNKNOWN", r => r.actualCostMicros = 6186001,
  ];
  for (const mutate of mutations) { const run = validRun(); mutate(run); assert.throws(() => review.assertApprovedKeywordReviewRun(run), /APPROVED_KEYWORD_REVIEW_/); }
});

test("a partial, duplicated or expanded task collection is never a whole approved manifest", () => {
  const fewer = validTasks(); fewer.pop(); assert.throws(() => review.assertApprovedKeywordReviewRun(validRun(), fewer), /WHOLE_TASK_SET/);
  const extra = validTasks(); extra.push(extra[0]); assert.throws(() => review.assertApprovedKeywordReviewRun(validRun(), extra), /WHOLE_TASK_SET/);
  const duplicate = validTasks(); duplicate[1] = structuredClone(duplicate[0]); assert.throws(() => review.assertApprovedKeywordReviewRun(validRun(), duplicate), /TASK_IDENTITY/);
});

test("every paid task is tied to its exact word, one country, original targets, escaped request and tag", () => {
  const mutations = [
    t => t.id += "-changed", t => t.runId += "-changed", t => t.queryKey = "JP:injected pricing",
    t => t.keyword += " changed", t => t.region = t.region === "US" ? "JP" : "US",
    t => t.targetsJson[0].keywordId += "-changed", t => t.targetsJson[0].targetUrls.push("https://flatkey.ai/new-page"),
    t => t.targetsJson[0].marketAssignment = { primaryCountry: "US" },
    t => t.requestJson.keyword = "different keyword", t => t.requestJson.language_code = "xx",
    t => t.requestJson.location_code = 9999, t => t.requestJson.depth = 1000,
    t => t.requestJson.calculate_rectangles = true, t => t.requestJson.tag = "other-task",
    t => t.requestJson.extra_paid_option = true, t => t.state = "UNKNOWN", t => t.costMicros = 6001,
  ];
  for (const mutate of mutations) { const tasks = validTasks(); mutate(tasks[0]); assert.throws(() => review.assertApprovedKeywordReviewRun(validRun(), tasks), /APPROVED_KEYWORD_REVIEW_/); }
});
