const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { keywordRankingTag, keywordPageTag } = require("../src/lib/keyword-status-tags.ts");
const snapshot = (rank, overrides = {}) => ({ source: "dataforseo_labs", rank, rankStatus: rank == null ? "no_data" : "ranked", checkedAt: "2026-10-16T08:00:00Z", ...overrides });

test("ranking tags form one exclusive interval at every boundary", () => {
  const expected = [[1, "TOP_10", "前10"], [10, "TOP_10", "前10"], [11, "TOP_30", "前30"], [30, "TOP_30", "前30"],
    [31, "TOP_50", "前50"], [50, "TOP_50", "前50"], [51, "TOP_100", "前100"], [100, "TOP_100", "前100"]];
  for (const [rank, key, label] of expected) {
    const result = keywordRankingTag(snapshot(rank));
    assert.equal(result.key, key, String(rank)); assert.equal(result.label, label, String(rank));
    assert.equal(Array.isArray(result), false, "one rank returns one tag, never a cumulative list");
  }
  const counts = {};
  for (let rank = 1; rank <= 100; rank++) {
    const tag = keywordRankingTag(snapshot(rank));
    counts[tag.key] = (counts[tag.key] ?? 0) + 1;
  }
  assert.deepEqual(counts, { TOP_10: 10, TOP_30: 20, TOP_50: 20, TOP_100: 50 });
  assert.equal(keywordRankingTag(snapshot(8)).label, "前10");
});

test("identical no-rank labels distinguish never captured, not returned and confirmed outside in their evidence", () => {
  const absent = keywordRankingTag(null), notReturned = keywordRankingTag(snapshot(null)), outside = keywordRankingTag(snapshot(null, { rankStatus: "outside_top100" }));
  for (const tag of [absent, notReturned, outside, keywordRankingTag(snapshot(101))]) {
    assert.equal(tag.key, "UNRANKED"); assert.equal(tag.label, "暂无排名");
  }
  assert.match(absent.tooltip, /尚未抓取/); assert.match(notReturned.tooltip, /本次.*未检出/); assert.match(outside.tooltip, /明确报告前100外/);
  assert.match(notReturned.tooltip, /不等于确认/);
});

test("legacy averages and invalid positions cannot receive a positive ranking tag", () => {
  for (const source of ["gsc", "ahrefs", "serpapi", undefined]) assert.equal(keywordRankingTag(snapshot(8, { source })).key, "UNRANKED", String(source));
  for (const rank of [null, undefined, 0, -1, 1.5, 10.1, NaN, Infinity]) assert.equal(keywordRankingTag(snapshot(rank)).key, "UNRANKED", String(rank));
});

const page = { siteDomain: "flatkey.ai", mappingStatus: "READY", targetUrls: ["https://flatkey.ai/blog/model-api"], candidateUrls: [] };
test("matched page tag requires READY, a valid own-site page and no negative latest verdict", () => {
  for (const latestPageAuditVerdict of [undefined, null, "VERIFIED"]) assert.equal(keywordPageTag({ ...page, latestPageAuditVerdict }).key, "MATCHED");
  for (const change of [{ mappingStatus: "RECORDED" }, { mappingStatus: "MODEL_PROTECTED" }, { targetUrls: [] },
    { targetUrls: ["https://flatkey.ai.attacker.example/page"] }, { latestPageAuditVerdict: "REVIEW" }, { latestPageAuditVerdict: "MISMATCH" }, { latestPageAuditVerdict: "MISSING" }, { latestPageAuditVerdict: "NO_MATCH" }, { latestPageAuditVerdict: "CONTENT_GAP" }]) {
    assert.notEqual(keywordPageTag({ ...page, ...change }).key, "MATCHED", JSON.stringify(change));
  }
});

test("only unverified existing URLs stay pending", () => {
  for (const input of [
    { ...page, mappingStatus: "RECORDED" },
    { ...page, latestPageAuditVerdict: "REVIEW" },
    { ...page, mappingStatus: "NEEDS_BUILD", targetUrls: [], candidateUrls: page.targetUrls },
  ]) {
    const tag = keywordPageTag(input);
    assert.equal(tag.key, "REVIEW"); assert.equal(tag.label, "候选·页面待核实");
  }
});

test("completed page checks expose concrete outcomes even if a stale target URL remains", () => {
  for (const [verdict, key, label] of [["NO_MATCH", "BUILD", "候选·待建设"], ["MISSING", "BUILD", "候选·待建设"],
    ["CONTENT_GAP", "EXPAND", "候选·需补内容"], ["MISMATCH", "MISMATCH", "候选·页面错配"]]) {
    const result = keywordPageTag({ ...page, latestPageAuditVerdict: verdict });
    assert.equal(result.key, key); assert.equal(result.label, label); assert.doesNotMatch(result.label, /待核实/);
  }
  assert.equal(keywordPageTag({ ...page, mappingStatus: "NEEDS_EXPANSION" }).key, "EXPAND");
  assert.equal(keywordPageTag({ ...page, mappingStatus: "NEEDS_REMAP" }).key, "MISMATCH");
});

test("one keyword can have several independently matched pages without counting duplicate URL spellings", () => {
  const result = keywordPageTag({ ...page, targetUrls: [...page.targetUrls, `${page.targetUrls[0]}/#example`, "https://flatkey.ai/models/model", "https://elsewhere.example/page"], latestPageAuditVerdict: "VERIFIED" });
  assert.equal(result.key, "MATCHED"); assert.equal(result.label, "已匹配 2 页"); assert.match(result.tooltip, /关键词只计一次/);
});

test("truly unmapped plans and confirmed missing pages are kept as build candidates", () => {
  for (const mappingStatus of ["NEEDS_BUILD", "UNMAPPED"]) assert.equal(keywordPageTag({ ...page, mappingStatus, targetUrls: [] }).key, "BUILD");
  const missing = keywordPageTag({ ...page, mappingStatus: "NEEDS_BUILD", targetUrls: [], candidateUrls: page.targetUrls, latestPageAuditVerdict: "MISSING" });
  assert.equal(missing.key, "BUILD"); assert.match(missing.tooltip, /已确认目标页面缺失/);
  assert.equal(keywordPageTag({ ...page, mappingStatus: "UNMAPPED", targetUrls: [], latestPageAuditVerdict: "REVIEW" }).key, "REVIEW");
});
