const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions[".css"] = module => { module.exports = {}; };
const { optimizedPagesForKeyword, withOptimizedKeywordRanks } = require("../src/lib/optimized-keyword-details.ts");
const { keywordPageTag } = require("../src/lib/keyword-status-tags.ts");
const { keywordRankingPages } = require("../src/lib/keyword-ranking-pages.ts");
const url = "https://flatkey.ai/blog/optimized";
const at = "2026-10-22T03:00:00Z", before = "2026-10-20T03:00:00Z";
const keyword = (id, text, extras = {}) => ({ id: `flatkey.ai:${id}`, text, siteDomain: "flatkey.ai", siteName: "Flatkey", businessCategory: "FLATKEY_API",
  topicId: null, topicText: null, type: "MAIN", active: true, targetUrls: [url], parentId: null, parentIds: [], lastSyncedAt: null, volume: 100,
  marketVolumes: { US: 100, JP: null, ES: null, BR: null }, latestRanks: { US: null, JP: null, ES: null, BR: null }, ...extras });
const result = (text, rank, checkedAt = at, extras = {}) => ({ keyword: text, region: "US", rank, checkedAt, status: rank == null ? "OUTSIDE_TOP100" : "RANKED", otherPages: [], googleUrl: null, ...extras });
const page = (words, results = [], previousResults = []) => ({ id: "a".repeat(64), url, title: "Optimized", sourceRows: ["row"], keywords: words, targets: [], hash: "b".repeat(64),
  sourceKeywordCount: words.length, queryCount: 4, maxCostMicros: 24000, usedToday: false, run: null, results, previousResults });
const savedRank = (rank, checkedAt = before, extras = {}) => ({ rank, checkedAt, rankStatus: "ranked", source: "dataforseo_serp", url, bucket: "TOP_30",
  previousRank: null, rankDelta: null, changed: false, title: null, searchVolume: 100, ...extras });

test("completed optimization membership is keyword-specific, domain-specific and independent of paid eligibility", () => {
  const api = keyword("api", " Example   API "), optimized = page(["ＥＸＡＭＰＬＥ ＡＰＩ"]);
  assert.deepEqual(optimizedPagesForKeyword(api, [optimized]), [optimized]);
  assert.deepEqual(optimizedPagesForKeyword({ ...api, siteDomain: "rackrate.org" }, [optimized]), []);
  assert.deepEqual(optimizedPagesForKeyword(keyword("other", "other api"), [optimized]), []);
  const tag = keywordPageTag({ siteDomain: "flatkey.ai", mappingStatus: "NEEDS_EXPANSION", latestPageAuditVerdict: "CONTENT_GAP", optimized: true });
  assert.equal(tag.key, "OPTIMIZED"); assert.equal(tag.label, "已优化");
  assert.equal(optimized.queryCount, 4); assert.equal(optimized.targets.length, 0, "completion cannot invent audited paid targets");
});

test("manual results update keyword rank, actual page evidence, timestamp and movement together without mutating saved data", () => {
  const word = keyword("api", "example api", { latestRanks: { US: savedRank(18), JP: savedRank(8, before), ES: null, BR: null } });
  const optimized = page([word.text], [result(word.text, 7)], [result(word.text, 18, before)]);
  const original = structuredClone(word), merged = withOptimizedKeywordRanks(word, [optimized]);
  assert.equal(merged.latestRanks.US.rank, 7); assert.equal(merged.latestRanks.US.checkedAt, at);
  assert.equal(merged.latestRanks.US.movement, "UP"); assert.equal(merged.latestRanks.US.rankDelta, 11);
  assert.equal(merged.latestRanks.JP.rank, 8);
  assert.deepEqual(keywordRankingPages(merged.latestRanks.US, merged.rankingEvidence.US, "flatkey.ai").map(row => [row.url, row.rank, row.checkedAt]), [[url, 7, at]]);
  assert.deepEqual(word, original);
  assert.equal(withOptimizedKeywordRanks({ ...word, siteDomain: "modelfit.cc" }, [optimized]).latestRanks.US.rank, 18);
});

test("detail view keeps its site-best-page ranking and never declares a keyword outside when another page ranks", () => {
  const word = keyword("api", "example api"), otherUrl = "https://flatkey.ai/blog/other";
  const optimized = page([word.text], [result(word.text, null, at, { otherPages: [{ url: otherUrl, rank: 3 }] })]);
  const merged = withOptimizedKeywordRanks(word, [optimized]);
  assert.equal(merged.latestRanks.US.rank, 3); assert.equal(merged.latestRanks.US.url, otherUrl);
  assert.equal(merged.latestRanks.US.rankStatus, "ranked");
  assert.equal(keywordRankingPages(merged.latestRanks.US, merged.rankingEvidence.US, "flatkey.ai")[0].url, otherUrl);
});

test("newer scheduled ranks win; pending or invalid manual attempts cannot erase valid ranks", () => {
  const word = keyword("api", "example api", { latestRanks: { US: savedRank(4, "2026-11-03T03:00:00Z"), JP: null, ES: null, BR: null } });
  assert.equal(withOptimizedKeywordRanks(word, [page([word.text], [result(word.text, 7)])]).latestRanks.US.rank, 4);
  for (const status of ["QUEUED", "FAILED", "INCOMPLETE", "QUERY_CHANGED", "NOT_FOUND_CAPTURE"]) {
    const merged = withOptimizedKeywordRanks(word, [page([word.text], [result(word.text, null, "2026-11-04T03:00:00Z", { status })])]);
    assert.equal(merged.latestRanks.US.rank, 4, status);
  }
  const merged = withOptimizedKeywordRanks(word, [page([word.text], [result(word.text, null, "2026-11-04T03:00:00Z")])]);
  assert.equal(merged.latestRanks.US.rankStatus, "outside_top100"); assert.equal(merged.latestRanks.US.movement, "DROPPED_OUT");
});

test("optimized filter renders keyword rows and capture controls in details, with no separate monitor navigation", () => {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
  const first = keyword("first", "first api"), second = keyword("second", "second api"), pending = keyword("pending", "pending api");
  const words = [first, second, pending], optimized = page([first.text, second.text], [result(first.text, 7), result(second.text, 9)]);
  mock("src/components/useDashboard.ts", { useDashboard: () => ({ data: { keywords: words }, refresh: () => {} }) });
  mock("src/components/useKeywordOkr.ts", { useKeywordOkr: () => ({ data: { initialized: true, keywords: words.map(word => ({
    id: word.id.slice("flatkey.ai:".length), text: word.text, pool: "FORMAL", active: true, siteDomain: "flatkey.ai", businessCategory: "FLATKEY_API",
    targetUrls: [url], candidateUrls: [], actualPages: [], mappingStatus: "NEEDS_EXPANSION", latestPageAuditVerdict: "CONTENT_GAP",
  })) }, refresh: () => {} }) });
  mock("src/components/useOptimizedPageCapture.ts", { useOptimizedPageCapture: () => ({ data: { day: "2026-10-22", connectionConfigured: true, externalEnabled: true, pages: [optimized] }, start: () => assert.fail("render cannot submit a paid request") }) });
  const targets = words.map(word => ({ id: word.id.slice("flatkey.ai:".length), text:word.text, pool:"FORMAL", active:true,
    siteDomain:"flatkey.ai", businessCategory:"FLATKEY_API", targetUrls:[url], candidateUrls:[], actualPages:[], mappingStatus:"NEEDS_EXPANSION", latestPageAuditVerdict:"CONTENT_GAP" }));
  mock("src/components/useKeywordPage.ts", { useKeywordPage: () => ({data:{keywords:[first,second],okr:{initialized:true,keywords:targets,tasks:[]},total:2},page:1,setPage:()=>{},refresh:()=>{}}) });
  const { KeywordDetails } = require("../src/components/KeywordDetails.tsx");
  const html = renderToStaticMarkup(React.createElement(KeywordDetails, { initiallyOptimized: true }));
  assert.ok(html.includes("first api")); assert.ok(html.includes("second api"));
  assert.ok(!html.includes("pending api"));
  assert.ok(html.includes("业务分类")); assert.ok(html.includes("已优化")); assert.ok(html.includes("抓取排名"));
  assert.ok(!html.includes('href="/monitor"')); assert.ok(!html.includes("全部网站"));
  const { default: LegacyMonitor } = require("../src/app/monitor/page.tsx");
  assert.throws(() => LegacyMonitor(), error => error.digest?.includes("/keywords?status=optimized"));
});


test("persisted keyword rows include business, optimization status and current rank before server pagination", () => {
  const { keywordDisplayRows } = require("../src/lib/keyword-display-rows.ts");
  const api = keyword("api", "example api"), gpu = keyword("gpu", "gpu rental", {businessCategory:"CLOUD_GPU"});
  const rack = keyword("rack", "gpu rental", {siteDomain:"rackrate.org",businessCategory:"CLOUD_GPU"});
  const targets = [api,gpu].map(word => ({id:word.id.slice("flatkey.ai:".length),text:word.text,siteDomain:"flatkey.ai",active:true,pool:"FORMAL",businessCategory:word.businessCategory,
    targetUrls:[url],candidateUrls:[],mappingStatus:"NEEDS_EXPANSION",latestPageAuditVerdict:"CONTENT_GAP"}));
  const optimized = page([api.text], [result(api.text,7)]);
  const groups = keywordDisplayRows({keywords:[api,gpu,rack],usingDemoData:false},{initialized:true,keywords:targets},false,[optimized]);
  const flat = groups.flatMap(group=>group.members);
  assert.equal(flat.find(row=>row.text===api.text)._optimized,true);
  assert.equal(flat.find(row=>row.text===api.text).latestRanks.US.rank,7);
  assert.equal(flat.find(row=>row.text===api.text).businessCategory,"FLATKEY_API");
  assert.ok(flat.filter(row=>row.text===gpu.text).every(row=>!row._optimized && row.businessCategory==="CLOUD_GPU"));
});
