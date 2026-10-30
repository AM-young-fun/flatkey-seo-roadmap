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

test("failed daily capture keeps the last valid ranking and shows failure instead of success", () => {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const { KeywordRankActions } = require("../src/components/KeywordRankActions.tsx");
  const stored = savedRank(9, before, { movement: "FIRST_CHECK" });
  const word = keyword("api", "example api", { latestRanks: { US: stored, JP: null, ES: null, BR: null } });
  const optimized = { ...page([word.text], [result(word.text, null, null, { status: "FAILED" })]), usedToday: true,
    run: { status: "FAILED", queryCount: 16, taskCounts: { FAILED: 16 } } };
  const capture = { data: { connectionConfigured: true, externalEnabled: true, activeRunId: null }, busy: null,
    start: () => assert.fail("displaying a failed receipt must not submit a new paid capture") };
  assert.deepEqual(withOptimizedKeywordRanks(word, [optimized]).latestRanks.US, stored);
  const render = value => renderToStaticMarkup(React.createElement(KeywordRankActions, { pages: [value], capture }));
  const failed = render(optimized);
  assert.ok(failed.includes("今日抓取失败")); assert.ok(!failed.includes("今日已抓取"));
  assert.ok(failed.includes("16/16 个任务失败")); assert.ok(failed.includes("本次未更新排名"));
  assert.match(failed, /<button[^>]*disabled/);
  const partial = render({ ...optimized, run: { ...optimized.run, status: "PARTIAL", taskCounts: { COMPLETE: 8, FAILED: 8 } } });
  assert.ok(partial.includes("今日部分完成")); assert.ok(partial.includes("对应排名保留历史结果"));
  const tomorrow = render({ ...optimized, usedToday: false });
  assert.ok(tomorrow.includes("抓取排名")); assert.ok(tomorrow.includes("上次抓取失败"));
  assert.doesNotMatch(tomorrow, /<button[^>]*disabled/);
  assert.ok(render({ ...optimized, run: { ...optimized.run, status: "RUNNING" } }).includes("处理中"));
  assert.ok(render({ ...optimized, run: { ...optimized.run, status: "UNKNOWN" } }).includes("需核对"));
  assert.ok(render({ ...optimized, run: { ...optimized.run, status: "COMPLETED", taskCounts: { COMPLETE: 16 } } }).includes("今日已完成"));
});

test("capture controls show processing and progress from submission through waiting and result parsing", () => {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const { KeywordRankActions } = require("../src/components/KeywordRankActions.tsx");
  const optimized = page(["example api"]);
  const capture = { data: { connectionConfigured: true, externalEnabled: true, activeRunId: null }, busy: null,
    start: () => assert.fail("rendering progress cannot submit another paid request") };
  const render = (value, busy = null) => renderToStaticMarkup(React.createElement(KeywordRankActions, { pages: [value], capture: { ...capture, busy } }));
  const submitting = render(optimized, optimized.id);
  assert.ok(submitting.includes("处理中")); assert.ok(submitting.includes("正在提交抓取任务"));
  assert.match(submitting, /<button[^>]*disabled/);
  for (const [status, taskCounts, message] of [
    ["PLANNED", { PLANNED: 16 }, "等待提交 16 项"],
    ["RUNNING", { SUBMITTING: 16 }, "正在提交 16 项"],
    ["RUNNING", { COMPLETE: 4, QUEUED: 12 }, "已返回 4/16 项 · 等待结果 12 项"],
    ["RUNNING", { COMPLETE: 8, RECEIVED: 8 }, "已返回 8/16 项 · 正在处理结果 8 项"],
  ]) {
    // Even if the daily flag or global active ID has not refreshed, this
    // page's own in-flight run must keep its capture control disabled.
    const html = render({ ...optimized, run: { status, queryCount: 16, taskCounts } });
    assert.ok(html.includes("处理中")); assert.ok(html.includes(message));
    assert.ok(html.includes("完成后自动更新排名")); assert.ok(!html.includes("今日已完成"));
    assert.ok(!html.includes("上次已返回")); assert.match(html, /<button[^>]*disabled/);
  }
});

test("optimized filter renders keyword rows and capture controls in details, with no separate monitor navigation", () => {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
  const first = keyword("first", "first api"), second = keyword("second", "second api"), pending = keyword("pending", "pending api");
  const words = [first, second, pending], optimized = {...page([first.text, second.text], [result(first.text, 7), result(second.text, 9)]), optimizedAt:"2026-10-12"};
  mock("src/components/useDashboard.ts", { useDashboard: () => ({ data: { keywords: words }, refresh: () => {} }) });
  mock("src/components/useKeywordOkr.ts", { useKeywordOkr: () => ({ data: { initialized: true, keywords: words.map(word => ({
    id: word.id.slice("flatkey.ai:".length), text: word.text, pool: "FORMAL", active: true, siteDomain: "flatkey.ai", businessCategory: "FLATKEY_API",
    targetUrls: [url], candidateUrls: [], actualPages: [], mappingStatus: "NEEDS_EXPANSION", latestPageAuditVerdict: "CONTENT_GAP",
  })) }, refresh: () => {} }) });
  let captureState = { data: { day: "2026-10-22", connectionConfigured: true, externalEnabled: true, pages: [optimized] }, busy: null,
    start: () => assert.fail("render cannot submit a paid request") };
  mock("src/components/useOptimizedPageCapture.ts", { useOptimizedPageCapture: () => captureState });
  const targets = words.map(word => ({ id: word.id.slice("flatkey.ai:".length), text:word.text, pool:"FORMAL", active:true,
    siteDomain:"flatkey.ai", businessCategory:"FLATKEY_API", targetUrls:[url], candidateUrls:[], actualPages:[], mappingStatus:"NEEDS_EXPANSION", latestPageAuditVerdict:"CONTENT_GAP" }));
  mock("src/components/useKeywordPage.ts", { useKeywordPage: () => ({data:{keywords:[first,second],okr:{initialized:true,keywords:targets,tasks:[]},total:2},page:1,setPage:()=>{},refresh:()=>{}}) });
  const { KeywordDetails } = require("../src/components/KeywordDetails.tsx");
  const html = renderToStaticMarkup(React.createElement(KeywordDetails, { initiallyOptimized: true }));
  assert.ok(html.includes("first api")); assert.ok(html.includes("second api"));
  assert.ok(!html.includes("pending api"));
  assert.ok(html.includes("优化完成时间")); assert.ok(html.includes("2026-10-12（日期）"));
  assert.ok(html.includes("业务分类")); assert.ok(html.includes("已优化")); assert.ok(html.includes("抓取排名"));
  assert.ok(!html.includes('href="/monitor"')); assert.ok(!html.includes("全部网站"));
  for (const phase of ["submitting", "PLANNED", "RUNNING"]) {
    captureState = { ...captureState, busy: phase === "submitting" ? optimized.id : null,
      data: { ...captureState.data, pages: [{ ...optimized, run: phase === "submitting" ? null : { status: phase, queryCount: 16, taskCounts: { QUEUED: 16 } } }] } };
    const pending = renderToStaticMarkup(React.createElement(KeywordDetails, { initiallyOptimized: true }));
    const firstRow = pending.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g).find(row => row.includes("first api"));
    assert.ok(firstRow.includes("<strong>处理中</strong>"), phase);
    assert.ok(firstRow.includes("上次有效排名 · 本次处理中"), phase);
    assert.ok(firstRow.includes("#7"), "keep the last valid position visible");
    assert.ok(!firstRow.includes("<strong>仅一次有效实测</strong>"), phase);
  }
  captureState = { ...captureState, busy: null, data: { ...captureState.data, pages: [optimized] } };
  const finished = renderToStaticMarkup(React.createElement(KeywordDetails, { initiallyOptimized: true }));
  assert.ok(finished.includes("美国 · 仅一次有效实测"));
  assert.ok(!finished.includes("本次排名处理中"));
  // The all-country default must surface today's US comparison even
  // when an older Japanese rank is the best numeric position.
  first.latestRanks = { US: savedRank(14, before), JP: savedRank(9, before), ES: savedRank(null, before, { rankStatus: "not_found_capture" }), BR: null };
  const fresh = result(first.text, null, at, { status: "NOT_FOUND_CAPTURE", otherPages: [{ url: "https://flatkey.ai/blog/new-ranking-page", rank: 16 }] });
  const miss = { ...fresh, region: "JP", otherPages: [] };
  captureState = { ...captureState, data: { ...captureState.data, pages: [{ ...optimized,
    run: { status: "COMPLETED", queryCount: 8, taskCounts: { COMPLETE: 8 } }, results: [fresh], attemptResults: [fresh, miss, { ...miss, region: "ES" }],
  }] } };
  const updated = renderToStaticMarkup(React.createElement(KeywordDetails, { initiallyOptimized: true }));
  const updatedRow = updated.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g).find(row => row.includes("first api"));
  const text = updatedRow.replace(/<[^>]+>/g, "");
  assert.ok(text.includes("四国最佳：#9 · 日本"));
  assert.ok(text.includes("美国 · ↓ 下降 2 位")); assert.ok(text.includes("#14 → #16"));
  assert.ok(text.includes("有效采集：2026/10/22 11:00:00"));
  assert.ok(text.includes("日本 · 本次暂无可比结果"));
  assert.ok(text.includes("本次未取得有效名次，保留历史排名"));
  const spain = text.split("西班牙：")[1].split("巴西：")[0];
  assert.ok(spain.includes("本次未取得有效名次"));
  assert.ok(!spain.includes("有效采集："), "invalid historical attempts are not valid captures");
  assert.ok(!spain.includes("保留历史排名"), "a country without a valid rank cannot claim a retained historical ranking");
  const cells = updatedRow.match(/<td\b[^>]*>[\s\S]*?<\/td>/g);
  const observed = cells.find(cell => cell.includes("排名采集："));
  assert.ok(observed.indexOf("new-ranking-page") < observed.indexOf("<details"), "newest country page is visible before historical pages");
  assert.ok(observed.includes("排名采集：2026/10/22 11:00:00"));
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


test("saved country scopes filter Japanese targets before server pagination while retaining cross-language evidence", () => {
  const { keywordDisplayRows } = require("../src/lib/keyword-display-rows.ts");
  const en = keyword("en", "model api", { sourceLanguages:["en"] });
  const ja = keyword("ja", "モデル API", { sourceLanguages:["ja"], latestRanks:{US:savedRank(3),JP:savedRank(4),ES:null,BR:null} });
  const targets = [en,ja].map(word => ({id:word.id.slice("flatkey.ai:".length),text:word.text,siteDomain:"flatkey.ai",active:true,pool:"FORMAL",businessCategory:"FLATKEY_API",targetUrls:[url],candidateUrls:[]}));
  const groups = keywordDisplayRows({keywords:[en,ja],usingDemoData:false},{initialized:true,keywords:targets});
  const english = groups.flatMap(group=>group.members).find(row=>row.text===en.text);
  const japanese = groups.flatMap(group=>group.members).find(row=>row.text===ja.text);
  assert.deepEqual(english._countryScopes,["US"]);
  assert.deepEqual(japanese._countryScopes,["JP"]);
  assert.ok(japanese._crossCountryScopes.includes("US"));
});


test("failed rows offer free retries while unqueried rows explain their own missing eligibility", () => {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const { KeywordRankActions } = require("../src/components/KeywordRankActions.tsx");
  const failed = { ...page(["example api"]), usedToday: true, retryableTaskCount: 16,
    run: { status: "FAILED", queryCount: 16, taskCounts: { FAILED: 16 } } };
  const capture = { data: { connectionConfigured: true, externalEnabled: true, activeRunId: null }, busy: null,
    start: () => assert.fail("render cannot submit"), retry: () => assert.fail("render cannot retrieve") };
  const render = (pageValue, overrides = {}) => renderToStaticMarkup(React.createElement(KeywordRankActions, { pages: [pageValue], capture: { ...capture, ...overrides } }));
  const retry = render(failed);
  assert.ok(retry.includes("重试取结果")); assert.ok(retry.includes("不再次计费"));
  assert.doesNotMatch(retry, /<button[^>]*disabled/);
  const processing = render(failed, { busy: failed.id, busyAction: "retry" });
  assert.ok(processing.includes("处理中")); assert.ok(processing.includes("正在重试读取原任务结果"));
  assert.match(processing, /<button[^>]*disabled/);
  const waiting = render(failed, { data: { ...capture.data, activeRunId: "another-run" } });
  assert.match(waiting, /<button[^>]*disabled/);
  const unqueried = render({ ...page(["ai api pricing"]), queryCount: 0, sourceKeywordCount: 8 });
  assert.ok(unqueried.includes("待核对")); assert.ok(unqueried.includes("8 个关联词，暂无已核实的正式关键词"));
  assert.ok(!unqueried.includes("今日抓取失败")); assert.ok(!unqueried.includes("上次该页"));
  assert.match(unqueried, /<button[^>]*disabled/);
  assert.doesNotMatch(render(page(["another eligible api"])), /<button[^>]*disabled/);
});


test("new verified site match updates keyword rank even when a shallow capture misses the target page", () => {
  const word = keyword("api", "example api", { latestRanks: { US: savedRank(14), JP: null, ES: null, BR: null } });
  const otherUrl = "https://flatkey.ai/blog/other", shallow = result(word.text, null, at, {
    status: "NOT_FOUND_CAPTURE", otherPages: [{ url: otherUrl, rank: 16 }],
  });
  const optimized = { ...page([word.text], [result(word.text, 14, before)]), siteResults: [shallow], previousSiteResults: [result(word.text, 14, before)] };
  const merged = withOptimizedKeywordRanks(word, [optimized]);
  assert.equal(merged.latestRanks.US.rank, 16); assert.equal(merged.latestRanks.US.url, otherUrl);
  assert.equal(merged.latestRanks.US.checkedAt, at); assert.equal(merged.latestRanks.US.rankDelta, -2);
  assert.equal(merged.latestRanks.US.movement, "DOWN");
  assert.equal(keywordRankingPages(merged.latestRanks.US, merged.rankingEvidence.US, "flatkey.ai")[0].checkedAt, at);
  for (const otherPages of [[], [{ url: "https://unrelated.example/blog/other", rank: 3 }], [{ url: otherUrl, rank: 101 }]]) {
    const invalid = { ...optimized, siteResults: [{ ...shallow, otherPages }] };
    assert.equal(withOptimizedKeywordRanks(word, [invalid]).latestRanks.US.rank, 14);
  }
});
