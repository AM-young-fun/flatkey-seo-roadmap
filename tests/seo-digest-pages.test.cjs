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
 assert.match(report.text,/Google 点击 · 分模块 Top 3.*2026-11-10.*覆盖 1\/5 站/);assert.match(report.text,/自然搜索访问（会话） · 分模块 Top 3/);
 assert.match(report.text,/https:\/\/flatkey.ai\/p7.*Google 点击 8/);assert.match(report.text,/缺少前一日基线/);assert.match(report.text,/覆盖缺口/);
 assert.equal(buildSeoDigest({...input,date:"2026-11-13",kind:"weekly",now:new Date("2026-11-13T10:00:00Z")}).pagePerformance.length,2);
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
test("module leaders are selected before global top five, preserve language and ignore GSC section duplicates", () => {
 const manyBlogs=Array.from({length:7},(_,i)=>[url('blog/post-'+i),100-i]);
 const ranking=rank([gs('2026-11-10',[...manyBlogs,[url('ja/compute'),8],[url('es/prompts/example'),6],[url('models/qwen'),4],[url('blog/post-0')+'#section',200]])])[0];
 assert.equal(ranking.pages.length,5);assert.equal(ranking.pages[0].value,100);
 assert.equal(ranking.modules.find(m=>m.id==='gpu').pages[0].url,url('ja/compute'));
 assert.equal(ranking.modules.find(m=>m.id==='prompts').pages[0].value,6);
 assert.equal(ranking.modules.find(m=>m.id==='models').pages[0].value,4);
 assert.equal(ranking.modules.find(m=>m.id==='blog').pages.length,3);
 assert.deepEqual(ranking.modules.find(m=>m.id==='other').pages,[]);
});
test("group summary selects one module highlight and keeps full module rankings and diagnostics in detail", () => {
 const report=buildSeoDigest({date:'2026-11-11',now,notificationCompact:true,observations:[],pageObservations:[gs('2026-11-10',[[url('compute'),10],[url('prompts/example'),7]]),ga('2026-11-10',[['flatkey.ai','/compute',5],['flatkey.ai','/prompts/example',6]])],publications:[],optimizations:[],effects:[],priorities:[],issues:Array.from({length:7},(_,i)=>'issue-marker-'+i),runNotes:[],publicationCoverage:'missing',optimizationCoverage:'missing'});
 assert.match(report.text,/关键变化/);assert.equal((report.text.match(/https:\/\/flatkey.ai\/compute/g)||[]).length,1);
 assert.match(report.text,/点击 10（基线待补）/);assert.match(report.text,/GSC 2026-11-10/);
 assert.doesNotMatch(report.text,/issue-marker-|每模块点击|工作统计|Asia\/|America\//);
 assert.match(report.detailText,/issue-marker-6/);assert.match(report.detailText,/分模块 Top 3/);
 assert.match(report.text,/暂无上线回执/);assert.match(report.text,/数据基础/);assert.ok(Buffer.byteLength(report.text)<4500);
});


test("compact module comparison names its own dates when site totals use a newer window", () => {
 const report=buildSeoDigest({date:'2026-11-12',now:new Date('2026-11-12T04:00:00Z'),notificationCompact:true,
  observations:['2026-11-08','2026-11-09'].map((date,i)=>({site:'flatkey.ai',date,source:'GSC',timezone:'America/Los_Angeles',observedAt:'2026-11-11T08:00:00Z',complete:true,scope:'google-web',clicks:i?254:95,impressions:1000})),
  pageObservations:[gs('2026-11-07',[[url(''),8]]),gs('2026-11-08',[[url(''),19]])],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:'missing',optimizationCoverage:'missing'});
 assert.match(report.text,/Google 点击[^\n]*95→254/);
 assert.match(report.text,/首页及其他功能页[^\n]*点击 8→19 · 2026-11-07→2026-11-08/);
 assert.match(report.text,/数据：GSC 2026-11-08—2026-11-09/);
 assert.ok(Buffer.byteLength(report.text)<4500);
});

test("compact module fallback names the available source date without inventing a baseline", () => {
 const report=buildSeoDigest({date:'2026-11-11',now,notificationCompact:true,observations:[],
  pageObservations:[ga('2026-11-10',[['flatkey.ai','/compute',5]])],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:'missing',optimizationCoverage:'missing'});
 assert.match(report.text,/GPU[^\n]*自然会话 5（基线待补） · 2026-11-10/);
 assert.doesNotMatch(report.text,/2026-11-09→2026-11-10/);
});

test("Flatkey module leaderboards rank ten pages and use the same six weekdays when one date is missing", () => {
  const rows = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 9, 29 + i)).toISOString().slice(0, 10);
    return gs(date, Array.from({ length: 12 }, (_, j) => [url(`blog/api-guide-${j}`), i + j + 1]), { observedAt: "2026-11-13T15:00:00Z" });
  });
  const asOf = new Date("2026-11-13T16:00:00Z");
  const period = { start: "2026-11-05", end: "2026-11-11" };
  const getBlog = input => digestTopPages(input, "2026-11-13", asOf, period)[0].flatkey.modules.find(module => module.id === "blog");
  assert.equal(getBlog(rows).pages.length, 10);
  assert.equal(getBlog(rows).pages[0].url, url("blog/api-guide-11"));
  assert.ok(getBlog(rows).current > getBlog(rows).previous);
  assert.equal(getBlog(rows).impressions.current, getBlog(rows).current * 10);
  assert.equal(getBlog(rows).impressions.previous, getBlog(rows).previous * 10);
  const partial = getBlog(rows.slice(0, -1));
  assert.equal(partial.current, 1152);
  assert.equal(partial.previous, 648);
  assert.equal(partial.pages.length, 10);
  assert.equal(partial.pages[0].previous, 87);
  assert.deepEqual(digestTopPages(rows.slice(0,-1), "2026-11-13", asOf, period)[0].flatkey.comparisonDates, ["2026-11-05","2026-11-06","2026-11-07","2026-11-08","2026-11-09","2026-11-10"]);
});
