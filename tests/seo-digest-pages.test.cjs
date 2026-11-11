const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { digestTopPages } = require("../src/lib/seo-digest-pages.ts");
const { buildSeoDigest } = require("../src/lib/seo-digest.ts");
const now = new Date("2026-11-11T10:00:00Z");
const gs = (date, rows, extra = {}) => ({ kind: "gsc-pages", property: "sc-domain:flatkey.ai", source: "google-api", date, observedAt: now.toISOString(), complete: true, rows: rows.map(([url, clicks]) => ({url, clicks, impressions: clicks * 10, position: 3})), ...extra });
const ga = (date, rows, extra = {}) => ({ kind: "ga4-pages", property: "541304395", source: "google-api", scope: "session-organic-search", date, observedAt: now.toISOString(), complete: false, sessionsComplete: true, hostnameDimension: "hostName", rows: rows.map(([hostname, path, sessions]) => ({hostname, path, sessions, registrations: null})), ...extra });
const rank = rows => digestTopPages(rows, "2026-11-11", now);
const url = path => "https://flatkey.ai/" + path;
test("each source chooses one ended complete day and never mixes newer partial, today, or country slices", () => {
 const result = rank([gs("2026-11-09",[[url("a"),10]]),gs("2026-11-10",[[url("partial"),900]],{complete:false}),gs("2026-11-11",[[url("today"),1000]]),gs("2026-11-10",[[url("country"),700]],{country:"US"}),gs("2026-11-08",[["https://rackrate.org/old",999]],{property:"https://rackrate.org/"}),ga("2026-11-10",[["flatkey.ai","/landing",5]])]);
 assert.equal(result[0].date,"2026-11-09"); assert.equal(result[0].pages[0].url,url("a"));assert.equal(result[0].pages.length,1);
 assert.match(result[0].gaps.join(";"),/rackrate.org.*与榜单日期不同/); assert.equal(result[1].date,"2026-11-10");
});
test("GA4 requires organic scope and real owned hostname, including cluster landing hosts", () => {
 const result = rank([ga("2026-11-10",[[null,"/unknown",100]]),ga("2026-11-10",[["flatkey.ai","/paid",400]],{scope:"all-channels"}),ga("2026-11-10",[["rackrate.org","/gpu",7]],{property:"558899190"})])[1];
 assert.deepEqual(result.coveredSites,["rackrate.org"]);assert.equal(result.pages[0].url,"https://rackrate.org/gpu");assert.equal(result.pages[0].timezone,"Asia/Shanghai");
 assert.match(result.gaps.join(";"),/flatkey.ai.*缺少 hostname/);
});
test("same-property previous-day baselines preserve unknowns and only prove absent zero from full Google collection", () => {
 const older = gs("2026-11-09",[[url("a"),4],[url("zero"),0]]), newer = gs("2026-11-10",[[url("a"),6],[url("zero"),2],[url("new"),3]]);
 const pages = rank([older,newer])[0].pages;
 assert.equal(pages.find(p=>p.url===url("a")).percentage,50);
 assert.equal(pages.find(p=>p.url===url("zero")).percentage,null); assert.equal(pages.find(p=>p.url===url("new")).previous,0);
 const legacy = rank([{...older,source:"browser-export"},{...newer,source:"browser-export"}])[0].pages.find(p=>p.url===url("new"));
 assert.equal(legacy.previous,null);assert.match(legacy.comparisonReason,/不能按0/);
 assert.equal(rank([newer])[0].pages[0].previous,null);
 assert.equal(rank([{...older,complete:false},newer])[0].pages[0].previous,null);
});
test("newer partial baseline, different property and host coverage never supply percentages", () => {
 const rows=[gs("2026-11-09",[[url("a"),4]],{observedAt:"2026-11-10T12:00:00Z"}),gs("2026-11-09",[[url("a"),4]],{complete:false}),gs("2026-11-10",[[url("a"),6]])];
 assert.equal(rank(rows)[0].pages[0].previous,null);
 assert.equal(rank([gs("2026-11-09",[[url("a"),4]],{property:"https://flatkey.ai/"}),gs("2026-11-10",[[url("a"),6]])])[0].pages[0].previous,null);
 assert.equal(rank([ga("2026-11-09",[["flatkey.ai","/a",4]],{hostnameDimension:undefined}),ga("2026-11-10",[["flatkey.ai","/a",6]])])[1].pages[0].previous,null);
});
test("collection on an unfinished source day is not made final by running a later digest", () => {
 const row=gs("2026-11-10",[[url("a"),10]],{observedAt:"2026-11-10T20:00:00Z"});
 assert.equal(rank([row])[0].date,null);
});
test("source duplicates and overlapping properties never double count or repeat pages", () => {
 const rows=[gs("2026-11-10",[[url("a"),3]],{observedAt:"2026-11-11T09:00:00Z"}),gs("2026-11-10",[[url("a"),5]]),gs("2026-11-10",[[url("a"),99]],{property:"https://flatkey.ai/"})];
 assert.equal(rank(rows)[0].pages.length,1);assert.equal(rank(rows)[0].pages[0].value,5);
});
test("each leaderboard is capped at five and report text shows dates, URL, value, gaps and no invented percentages", () => {
 const pages=Array.from({length:8},(_,i)=>[url("p"+i),i+1]), gaPages=pages.map(([u,n])=>["flatkey.ai",new URL(u).pathname,n]);
 const input={date:"2026-11-11",now,observations:[],pageObservations:[gs("2026-11-10",pages),ga("2026-11-10",gaPages)],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:"verified",optimizationCoverage:"verified"};
 const report=buildSeoDigest(input);
 assert.equal(report.pagePerformance.reduce((n,r)=>n+r.pages.length,0),10);
 assert.match(report.text,/Google 点击 Top 5.*2026-11-10.*覆盖 1\/5 站/);assert.match(report.text,/自然搜索访问（会话） Top 5/);
 assert.match(report.text,/https:\/\/flatkey.ai\/p7.*Google 点击 8/);assert.match(report.text,/缺少前一日基线/);assert.match(report.text,/覆盖缺口/);
 assert.equal(buildSeoDigest({...input,date:"2026-11-13",kind:"weekly",now:new Date("2026-11-13T10:00:00Z")}).pagePerformance.length,0);
});
test("zero is only displayed as an observed result and no data never becomes zero pages", () => {
 assert.equal(rank([])[0].date,null); const empty=rank([gs("2026-11-10",[])]);assert.equal(empty[0].date,"2026-11-10");assert.equal(empty[0].pages.length,0);
});

test("unsafe or foreign hosts and source records fetched in the future cannot enter a leaderboard", () => {
 assert.equal(rank([gs("2026-11-10",[["http://flatkey.ai/a",4]])])[0].date,null);
 assert.equal(rank([ga("2026-11-10",[["outside.example","/a",6]])])[1].date,null);
 assert.equal(rank([gs("2026-11-10",[[url("a"),4]],{observedAt:"2026-11-12T10:00:00Z"})])[0].date,null);
});

const properties = [["flatkey.ai","541304395"],["mochichatbot.com","561876347"],["jev-llm.com","555043733"],["rackrate.org","558899190"],["modelfit.cc","558978062"]];
test("10:30 Beijing mixed timezones prefer the latest common five-site day rather than hiding Flatkey", () => {
 const collectedAt="2026-11-11T02:30:00Z";
 const common=properties.map(([host,property])=>ga("2026-11-09",[[host,"/page",8]],{property,observedAt:collectedAt}));
 const newer=properties.slice(3).map(([host,property])=>ga("2026-11-10",[[host,"/newer",50]],{property,observedAt:collectedAt}));
 const result=rank([...common,...newer])[1];
 assert.equal(result.date,"2026-11-09");assert.equal(result.coveredSites.length,5);assert.equal(result.pages.length,5);
 assert.ok(result.pages.some(page=>page.site==="flatkey.ai"));assert.match(result.selectionReason,/最近五站共同完整日.*2026-11-10/);
});
test("without a common day use the most complete site coverage within seven days, break ties by recency", () => {
 const rows=properties.slice(0,3).flatMap(([host,property])=>["2026-11-08","2026-11-09"].map(date=>ga(date,[[host,"/a",4]],{property})));
 rows.push(ga("2026-11-10",[["rackrate.org","/a",10]],{property:"558899190"}));
 const result=rank(rows)[1];assert.equal(result.date,"2026-11-09");assert.equal(result.coveredSites.length,3);assert.match(result.selectionReason,/优先完整站覆盖/);
});
test("old complete snapshots cannot pull a leaderboard outside the seven-day fallback or fourteen-day absolute bound", () => {
 const old=properties.slice(0,4).map(([host,property])=>ga("2026-11-01",[[host,"/old",999]],{property}));
 const current=ga("2026-11-10",[["rackrate.org","/a",2]],{property:"558899190"});
 assert.equal(rank([...old,current])[1].date,"2026-11-10");
 const staleCommon=properties.map(([host,property])=>ga("2026-10-27",[[host,"/old",999]],{property}));
 assert.equal(rank(staleCommon)[1].date,null);assert.match(rank(staleCommon)[1].selectionReason,/最近14天/);
});
