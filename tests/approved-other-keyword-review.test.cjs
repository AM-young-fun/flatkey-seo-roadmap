const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const review = require("../src/lib/approved-other-keyword-review.ts");
const { buildApprovedChinaSerpTask, normalizeApprovedChinaSerpAdvanced, SERP_MARKETS, SERP_MARKET_CONFIG, isSerpRegion, configForSerpRegion, groupSerpMarketQueries, serpTaskId, serpQueryKey } = require("../src/lib/dataforseo-serp.ts");
const { isOwnedBrandKeyword } = require("../src/lib/keyword-market-policy.ts");
const plan = () => review.getApprovedOtherKeywordReviewPlan();
function validRun() {
  return { id: review.RUN_ID, scope: review.APPROVED_OTHER_KEYWORD_REVIEW_SCOPE, periodKey: review.PERIOD_KEY, status: "RUNNING",
    targetCount: 467, queryCount: 467, estimatedCostMicros: review.MAX_COST_MICROS, reservedCostMicros: review.MAX_COST_MICROS,
    actualCostMicros: null, cohortHash: review.APPROVED_OTHER_KEYWORD_REVIEW_QUERY_HASH, cohortJson: plan().targets,
    configJson: { paidEnabled: false, approvedOtherKeywordReview: { quoteSha256: review.APPROVAL_OTHER_QUOTE_SHA256,
      queryHash: review.APPROVED_OTHER_KEYWORD_REVIEW_QUERY_HASH, userApproved: true, approvalText: "Exact user-approved one-off review", approvalRecordedAt: "2026-11-23T03:00:00Z" } } };
}
function validTasks() {
  return plan().queries.map(query => ({ id: serpTaskId(review.RUN_ID, query.queryKey), runId: review.RUN_ID,
    queryKey: query.queryKey, keyword: query.keyword, region: query.region, state: "PLANNED", costMicros: null,
    targetsJson: query.targets, requestJson: review.approvedOtherTask(query, serpTaskId(review.RUN_ID, query.queryKey)) }));
}

test("frozen approval is exactly 467 original single-country queries and the $2.802 cap", () => {
  const p = plan(), counts = { US: 0, JP: 0, ES: 0, BR: 0, CN: 0 };
  assert.equal(p.queries.length, 467); assert.equal(p.targets.length, 467);
  assert.equal(review.APPROVAL_OTHER_QUOTE_SHA256, "594de337ece1521c6ff32c2fa9ab22948a0f3531dd96ce7f81bd9e0f11a271ef");
  assert.equal(p.queryHash, "0dc54c8938527a33238f27099ad159c02b7a9e8ebeb7f43f396fc7d025e48475");
  assert.equal(p.queries.length * 6000, review.MAX_COST_MICROS);
  assert.equal(review.MAX_COST_MICROS, 2802000);
  for (const q of p.queries) {
    counts[q.region]++;
    assert.equal(q.queryKey, `${q.region}:${serpQueryKey(q.keyword)}`);
    assert.equal(isOwnedBrandKeyword(q.keyword), false);
    assert.equal(q.targets.length, 1); assert.equal(q.targets[0].siteDomain, "flatkey.ai");
    assert.equal(q.targets[0].keywordId, q.keywordId); assert.equal(q.targets[0].keyword, q.keyword);
    assert.deepEqual(q.targets[0].targetUrls, q.targetUrls);
    assert.equal(Object.hasOwn(q.targets[0], "marketAssignment"), false, "approval must not manufacture a permanent primary market");
    const request = review.approvedOtherTask(q, serpTaskId(review.RUN_ID, q.queryKey));
    assert.equal(request.depth, 100); assert.equal(request.device, "desktop");
    assert.equal(request.calculate_rectangles, false); assert.equal(request.load_async_ai_overview, false);
  }
  assert.deepEqual(counts, { US: 447, JP: 2, ES: 1, BR: 1, CN: 16 });
  assert.equal(new Set(p.queries.map(q => serpQueryKey(q.keyword))).size, 467, "no cross-country broadcast");
  assert.equal(p.queries.some(q => q.queryKey === "BR:nvidia b300"), false, "the prior paid combination is not charged again");
  assert.equal(p.queries.filter(q => !q.targetUrls.length).length, 85, "missing pages remain approved diagnostics, not invented page matches");
  assert.deepEqual(p.queries.find(q => q.keywordId === "e8826954-b7b3-4a87-8f77-af009f7c1c04").targetUrls,
    ["https://docs.flatkey.ai/guides/openai-sdk"], "original evidence URL is retained without page access or a replacement target");
});

test("the original 468 other words are covered once, reusing B300 without a new paid task", () => {
  const p = plan(), reused = p.reused;
  const { APPROVED_KEYWORD_REVIEW_HELD } = require("../src/lib/approved-keyword-review.ts");
  assert.equal(reused.length, 1);
  assert.equal(reused[0].keywordId, "53be828d-9ef6-4bed-a6b4-e00f55efba94");
  assert.equal(reused[0].keyword, "nvidia b300"); assert.equal(reused[0].region, "BR");
  assert.equal(reused[0].sourceRunId, "serp-cycle-2026-11-17");
  assert.equal(reused[0].sourceQueryKey, "BR:nvidia b300");
  assert.equal(reused[0].checkedAt, "2026-11-22T11:49:22.000Z"); assert.equal(reused[0].rank, 15);
  assert.deepEqual(reused[0].targetUrls, ["https://flatkey.ai/blog/blackwell-ultra-b300-guide"]);
  assert.equal(Object.hasOwn(reused[0], "providerTaskId"), false, "missing original provider ID is never invented");
  const combined = [...p.queries, ...reused];
  assert.equal(new Set(combined.map(row => serpQueryKey(row.keyword))).size, 468);
  assert.deepEqual(new Map(combined.map(row => [row.keywordId, row.keyword])),
    new Map(APPROVED_KEYWORD_REVIEW_HELD.map(row => [row.keywordId, row.keyword])));
});

test("returned plans cannot mutate the frozen paid approval", () => {
  const first = plan(); first.queries[0].keyword = "injected pricing";
  first.targets[0].targetUrls.push("https://flatkey.ai/injected"); first.queries.pop();
  assert.notEqual(plan().queries[0].keyword, "injected pricing"); assert.equal(plan().queries.length, 467);
  assert.equal(plan().targets[0].targetUrls.includes("https://flatkey.ai/injected"), false);
  assert.equal(Object.isFrozen(review.APPROVED_OTHER_KEYWORD_REVIEW_QUERIES), true);
  assert.equal(Object.isFrozen(review.APPROVED_OTHER_KEYWORD_REVIEW_QUERIES[0].targetUrls), true);
  first.reused[0].rank = 1;
  assert.equal(plan().reused[0].rank, 15);
  assert.equal(Object.isFrozen(review.APPROVED_OTHER_KEYWORD_REVIEW_REUSED[0]), true);
});

test("a one-off run is authorized while recurring paidEnabled remains false", () => {
  const run = validRun(); assert.deepEqual(review.assertApprovedOtherKeywordReviewRun(run), plan());
  assert.equal(run.configJson.paidEnabled, false);
  assert.deepEqual(review.assertApprovedOtherKeywordReviewRun(run, validTasks()), plan());
});

test("whole task verification ignores DB JSON object-key order and task row order", () => {
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  const run = reorder(validRun()), tasks = validTasks().reverse().map(reorder);
  assert.deepEqual(review.assertApprovedOtherKeywordReviewRun(run, tasks), plan());
});

test("scope, approval, frozen cohort, reserved cap and unknown outcomes cannot be bypassed", () => {
  const mutations = [
    r => r.scope = "SCHEDULED", r => r.id += "-retry", r => r.periodKey = "2026-11-17",
    r => r.queryCount = 5995, r => r.targetCount--,
    r => r.estimatedCostMicros++, r => r.reservedCostMicros++, r => r.reservedCostMicros--,
    r => r.configJson.approvedOtherKeywordReview.quoteSha256 = "0".repeat(64),
    r => r.configJson.approvedOtherKeywordReview.queryHash = "0".repeat(64),
    r => r.configJson.approvedOtherKeywordReview.userApproved = false,
    r => r.cohortHash = "0".repeat(64), r => r.cohortJson[0].keyword += " changed",
    r => r.cohortJson[0].targetUrls.push("https://flatkey.ai/changed"),
    r => r.cohortJson[0].marketAssignment = { primaryCountry: "BR" },
    r => r.status = "UNKNOWN", r => r.actualCostMicros = 2802001,
  ];
  for (const mutate of mutations) { const run = validRun(); mutate(run); assert.throws(() => review.assertApprovedOtherKeywordReviewRun(run), /APPROVED_OTHER_KEYWORD_REVIEW_/); }
});

test("a partial, duplicated or expanded task collection is never a whole approved manifest", () => {
  const fewer = validTasks(); fewer.pop(); assert.throws(() => review.assertApprovedOtherKeywordReviewRun(validRun(), fewer), /WHOLE_TASK_SET/);
  const extra = validTasks(); extra.push(extra[0]); assert.throws(() => review.assertApprovedOtherKeywordReviewRun(validRun(), extra), /WHOLE_TASK_SET/);
  const duplicate = validTasks(); duplicate[1] = structuredClone(duplicate[0]); assert.throws(() => review.assertApprovedOtherKeywordReviewRun(validRun(), duplicate), /TASK_IDENTITY/);
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
  for (const mutate of mutations) { const tasks = validTasks(); mutate(tasks[0]); assert.throws(() => review.assertApprovedOtherKeywordReviewRun(validRun(), tasks), /APPROVED_OTHER_KEYWORD_REVIEW_/); }
});

test("CN support never adds a standing fifth country or relaxes normal configuration", () => {
  assert.deepEqual(SERP_MARKETS, ["US", "JP", "ES", "BR"]);
  assert.equal(Object.hasOwn(SERP_MARKET_CONFIG, "CN"), false);
  assert.equal(isSerpRegion("CN"), false);
  assert.throws(() => configForSerpRegion("CN"), /UNAPPROVED_SERP_REGION/);
  assert.throws(() => groupSerpMarketQueries(plan().targets, ["CN"]), /UNAPPROVED_SERP_REGIONS/);
  const config = review.configForApprovedOtherCountry("CN");
  assert.equal(config.region, "CN"); assert.equal(config.languageCode, "zh-CN");
  assert.equal(config.locationCode, 2156); assert.equal(config.paidEnabled, false);
  assert.deepEqual(config.regions, ["CN"]);
  assert.throws(() => review.configForApprovedOtherCountry("OTHER"), /UNAPPROVED_COUNTRY/);
  assert.throws(() => review.approvedOtherTask({ ...plan().queries[0], region: "OTHER" }, "tag"), /UNAPPROVED_COUNTRY/);
});

test("dedicated CN serialization preserves original text, safety checks and standard paid parameters", () => {
  const request = buildApprovedChinaSerpTask({ keyword: "C++ 20% 模型价格", queryKey: "CN:example", targets: [] }, "fictional-cn-task");
  assert.deepEqual(request, { keyword: "C%2B%2B 20%25 模型价格", location_code: 2156, language_code: "zh-CN",
    se_domain: "google.com", device: "desktop", os: "windows", depth: 100, max_crawl_pages: 10, priority: 1,
    tag: "fictional-cn-task", calculate_rectangles: false, load_async_ai_overview: false });
  for (const keyword of ["", "unsafe\nquery", "site:flatkey.ai 模型价格", "flatkey ai", "x".repeat(701)]) {
    assert.throws(() => buildApprovedChinaSerpTask({ keyword, queryKey: "CN:invalid", targets: [] }, "tag"));
  }
  for (const query of plan().queries.filter(row => row.region === "CN")) {
    const actual = review.approvedOtherTask(query, "cn-tag");
    assert.equal(actual.location_code, 2156); assert.equal(actual.language_code, "zh-CN");
    assert.equal(actual.se_domain, "google.com"); assert.equal(actual.keyword, query.keyword);
  }
});

function cnAdvanced(keyword = "gemini api价格") {
  const request = buildApprovedChinaSerpTask({ keyword, queryKey: "CN:test", targets: [] }, "fictional-cn-task");
  return { status_code: 20000, tasks: [{ id: "fictional-cn-provider-id", status_code: 20000,
    data: { ...request, se: "google", se_type: "organic" }, result: [{ type: "organic", keyword,
      location_code: 2156, language_code: "zh-CN", se_domain: "google.com", pages_count: 10,
      datetime: new Date(Date.now() - 60_000).toISOString(), check_url: "https://www.google.com/search?q=example",
      items: Array.from({ length: 100 }, (_, i) => ({ type: "organic", rank_group: i + 1, rank_absolute: i + 1,
        url: `https://example.org/page-${i + 1}`, title: `Page ${i + 1}` })) }] }] };
}
const cnExpected = { providerTaskId: "fictional-cn-provider-id", keyword: "gemini api价格", region: "CN" };

test("CN normalization verifies the fixed query environment and shares complete-depth rules", () => {
  const normalized = review.normalizeApprovedOtherSerpResult(cnAdvanced(), cnExpected);
  assert.equal(normalized.keyword, cnExpected.keyword); assert.equal(normalized.locationCode, 2156);
  assert.equal(normalized.languageCode, "zh-CN"); assert.equal(normalized.completeDepth, true);
  assert.equal(normalized.rankingVerified, true); assert.equal(normalized.organicCount, 100);
  assert.equal(normalized.googleUrl, "https://www.google.com/search?q=example");
  const short = cnAdvanced(); short.tasks[0].result[0].items.length = 10;
  assert.equal(normalizeApprovedChinaSerpAdvanced(short, cnExpected).completeDepth, false);
  const sparse = cnAdvanced(); sparse.tasks[0].result[0].items.splice(9, 1);
  assert.equal(review.normalizeApprovedOtherSerpResult(sparse, cnExpected).coveredThroughRank, 9);
  const corrected = cnAdvanced(); corrected.tasks[0].result[0].spell = { type: "showing_results_for", keyword: "gemini api 定价" };
  corrected.tasks[0].result[0].keyword = "gemini api 定价";
  const correction = review.normalizeApprovedOtherSerpResult(corrected, cnExpected);
  assert.equal(correction.queryStatus, "AUTOCORRECTED"); assert.equal(correction.rankingVerified, false);
  const badSource = cnAdvanced(); badSource.tasks[0].result[0].check_url = "https://google.com.evil.example/search";
  assert.equal(review.normalizeApprovedOtherSerpResult(badSource, cnExpected).googleUrl, null);
});

test("CN normalization cannot accept another country, language, domain, word, request or task", () => {
  const mutations = [
    r => r.tasks[0].id = "wrong-provider-id", r => r.status_code = 50000,
    r => r.tasks[0].data.keyword = "different query", r => r.tasks[0].data.device = "mobile",
    r => r.tasks[0].data.location_code = 2840, r => r.tasks[0].data.language_code = "en",
    r => r.tasks[0].data.depth = 1000, r => r.tasks[0].data.se_domain = "google.cn",
    r => r.tasks[0].result[0].keyword = "translated query", r => r.tasks[0].result[0].location_code = 2840,
    r => r.tasks[0].result[0].language_code = "zh", r => r.tasks[0].result[0].se_domain = "google.cn",
    r => r.tasks[0].result[0].type = "paid", r => r.tasks[0].result[0].datetime = "2026-11-22 10:00:00",
  ];
  for (const mutate of mutations) { const raw = cnAdvanced(); mutate(raw); assert.throws(() => review.normalizeApprovedOtherSerpResult(raw, cnExpected)); }
  const tasks = validTasks(), cnTask = tasks.find(row => row.region === "CN");
  cnTask.requestJson.language_code = "en";
  assert.throws(() => review.assertApprovedOtherKeywordReviewRun(validRun(), tasks), /TASK_REQUEST_MISMATCH/);
});
