const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { overviewModuleAnalytics, overviewMetricSummary } = require("../src/lib/seo-overview-analytics.ts");
const range = { start: "2026-11-01", end: "2026-11-02" };
const base = { date: range.start, observedAt: "2026-11-03T00:00:00Z", complete: true, source: "google-api" };
const ga = rows => ({ ...base, kind: "ga4-pages", property: "541304395", scope: "session-organic-search", sessionsComplete: true, rows });
const gs = rows => ({ ...base, kind: "gsc-pages", property: "sc-domain:flatkey.ai", rows });
test("module sessions use one landing path while GSC fragment rows contribute once", () => {
 const rows = [ga([{ hostname:"flatkey.ai",path:"/ja/blog/a",sessions:27,registrations:null }, { hostname:"flatkey.ai",path:"/compute",sessions:9,registrations:null }]),
 gs([{url:"https://flatkey.ai/ja/blog/a",clicks:4,impressions:40,position:2}, {url:"https://flatkey.ai/ja/blog/a#part",clicks:3,impressions:20,position:4}, {url:"https://flatkey.ai/compute",clicks:8,impressions:90,position:3}])];
 const before=structuredClone(rows),view=overviewModuleAnalytics(range,"blog",rows);
 assert.deepEqual(view.daily[0],{date:range.start,sessions:27,clicks:7,impressions:60,searchComplete:true});
 assert.equal(view.daily[1].sessions,null);assert.equal(view.daily[1].clicks,null);
 assert.deepEqual(overviewMetricSummary(view,"sessions"),{total:27,measured:1,days:2});assert.deepEqual(rows,before);
 assert.equal(overviewModuleAnalytics(range,"gpu",rows).daily[0].sessions,9);
});
test("unknown hostname and incomplete empty reports stay missing; verified empty module is zero",()=>{
 const rows=[ga([{hostname:null,path:"/compute",sessions:9,registrations:null}]), {...gs([]),complete:false}];
 const view=overviewModuleAnalytics(range,"gpu",rows);
 assert.equal(view.daily[0].sessions,null);assert.equal(view.daily[0].clicks,null);
 const empty=overviewModuleAnalytics(range,"blog",[ga([]),gs([])]);
 assert.equal(empty.daily[0].sessions,0);assert.equal(empty.daily[0].clicks,0);
});
test("provisional GSC values are visible but cannot count as complete comparison days",()=>{
 const view=overviewModuleAnalytics(range,"gpu",[{...gs([{url:"https://flatkey.ai/compute",clicks:5,impressions:100,position:3}]),complete:false}]);
 assert.deepEqual(overviewMetricSummary(view,"clicks"),{total:5,measured:0,days:2});
});
