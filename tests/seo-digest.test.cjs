const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { buildSeoDigest, comparableMetric, digestWindow, digestClaimable, SEO_DATA_HUB } = require("../src/lib/seo-digest.ts");
const { providerReceipt } = require("../scripts/seo-digest-dws.cjs");
const base = (date = "2026-11-10") => ({ date, now: new Date(date + "T18:00:00+08:00"), publications: [], optimizations: [], observations: [], effects: [], priorities: [], issues: [], runNotes: [], publicationCoverage: "verified", optimizationCoverage: "verified" });
const ga = (date, sessions, extra = {}) => ({ site: "flatkey.ai", date, sessions, source: "GA4", timezone: "America/Los_Angeles", scope: "session-organic-search", observedAt: "2026-11-10T00:00:00Z", complete: true, ...extra });
const approval = (id, extra = {}) => ({id, title:"成本计算器页面", siteDomain:"flatkey.ai", weekStart:"2026-10-26", status:"pending", submittedRecordedAt:"2026-10-30T09:00:00Z", decisions:[], supersedesApprovalIds:[], items:[{id:id+":en",pageUrl:"https://flatkey.ai/llm-cost-calculator",language:"en",operation:"new",contentVersion:"v1",changeSummary:"新增可交互的成本计算表单"}], ...extra});
test("daily and Friday reports retain cross-week pending approval links without counting deliveries", () => {
 for(const date of ["2026-11-10","2026-11-13"]){
  const result=buildSeoDigest({...base(date),approvals:[approval("calculator-approval")]});
  assert.deepEqual(result.approvalQueue,{tickets:1,pages:1});
  assert.match(result.text,/1 张审批单，1 个页面版本待审批/);
  assert.match(result.text,/approvals\?approvalId=calculator-approval/);
  assert.match(result.text,/版本 v1/); assert.equal(result.counts.landingPages,0);
 }
});
test("only unresolved items are reminded after partial decisions and version replacement", () => {
 const old=approval("old");
 const fresh=approval("new",{supersedesApprovalIds:["old"],items:[{...old.items[0],id:"new:en",contentVersion:"v2"},{...old.items[0],id:"new:ja",pageUrl:"https://flatkey.ai/ja/llm-cost-calculator",language:"ja",contentVersion:"v2"}],decisions:[{itemIds:["new:en"],decision:"approved"}]});
 const result=buildSeoDigest({...base(),approvals:[old,fresh,approval("draft",{status:"draft",submittedRecordedAt:null}),approval("rejected",{items:[{...old.items[0],id:"rejected:en",pageUrl:"https://flatkey.ai/rejected"}],decisions:[{itemIds:["rejected:en"],decision:"rejected"}]})]});
 assert.deepEqual(result.approvalQueue,{tickets:1,pages:1});
 assert.match(result.text,/approvalId=new/); assert.doesNotMatch(result.text,/approvalId=old/); assert.match(result.text,/· ja · 新增/);
});
test("missing approval source stays unknown and an actual empty queue reports no pending pages", () => {
 assert.equal(buildSeoDigest(base()).approvalQueue,null);
 assert.match(buildSeoDigest(base()).text,/审批台账读取失败或尚未接通/);
 assert.deepEqual(buildSeoDigest({...base(),approvals:[]}).approvalQueue,{tickets:0,pages:0});
 assert.match(buildSeoDigest({...base(),approvals:[]}).text,/当前没有待审批页面/);
});
test("long approval queues keep a bounded digest and a link to all pending items", () => {
 const tickets=Array.from({length:12},(_,i)=>approval("ticket"+i,{items:[{...approval("a").items[0],id:"item"+i,pageUrl:"https://flatkey.ai/page-"+i}]}));
 const result=buildSeoDigest({...base(),approvals:tickets});
 assert.deepEqual(result.approvalQueue,{tickets:12,pages:12});
 assert.match(result.text,/其余 4 个页面版本/); assert.equal((result.text.match(/approvalId=/g)||[]).length,8);
});
test("Friday replaces the daily report and includes Friday work; planning week is independent", () => {
 const report = buildSeoDigest(base("2026-11-13"));
 assert.equal(report.kind, "weekly");
 assert.deepEqual(report.workWindow, { start: "2026-11-06T18:00:00+08:00", end: "2026-11-13T18:00:00+08:00" });
 assert.equal(digestWindow("2026-11-13").trafficStart, "2026-11-06");
 assert.equal(digestWindow("2026-11-13").trafficEnd, "2026-11-12");
 assert.match(report.text, /数据基础/); assert.ok(report.text.endsWith(`[数据基础](${SEO_DATA_HUB})`));
});
test("late verification is counted in the next window, sources and translations remain separate", () => {
 const rows = [
  { id: "a", title: "source", url: "https://flatkey.ai/blog/a", kind: "source", publishedAt: "2026-11-09T17:58:00+08:00", verifiedAt: "2026-11-09T18:05:00+08:00", recordedAt: "2026-11-09T18:05:00+08:00" },
  { id: "b", title: "translation", url: "https://flatkey.ai/ja/blog/a", kind: "translation", publishedAt: "2026-11-09T17:58:00+08:00", verifiedAt: "2026-11-09T18:05:00+08:00", recordedAt: "2026-11-09T18:05:00+08:00" },
 ];
 assert.equal(buildSeoDigest({ ...base("2026-11-09"), publications: rows }).counts.originals, 0);
 assert.deepEqual(buildSeoDigest({ ...base(), publications: rows }).counts, { originals: 1, translations: 1, backfillTranslations: 0, landingPages: 0, clusterPages: 0, optimizedPages: 0 });
});
test("backdated verification arriving late is counted by actual receipt time", () => {
 const row = { id: "a", title: "late", url: "https://flatkey.ai/blog/a", kind: "source", publishedAt: "2026-11-08T12:00:00+08:00", verifiedAt: "2026-11-08T12:30:00+08:00", recordedAt: "2026-11-10T12:00:00+08:00" };
 assert.equal(buildSeoDigest({ ...base(), publications: [row] }).counts.originals, 1);
});
test("same page edits count once and no baseline does not count", () => {
 const row = { id: "a", url: "https://flatkey.ai/blog/a", keyword: "model api", changes: "title", verifiedAt: "2026-11-10T12:30:00+08:00", recordedAt: "2026-11-10T12:31:00+08:00", baselineId: "baseline" };
 assert.equal(buildSeoDigest({ ...base(), optimizations: [row, { ...row, id: "b" }, { ...row, id: "c", url: "https://flatkey.ai/blog/c", baselineId: "" }] }).counts.optimizedPages, 1);
});
test("missing source is not zero while an actual reported zero remains valid", () => {
 const rows = [ga("2026-11-07", 3), ga("2026-11-08", 0), ga("2026-11-09", null)];
 const result = comparableMetric(rows, "flatkey.ai", "sessions", "2026-11-10");
 assert.equal(result.current, 0); assert.equal(result.previous, 3); assert.deepEqual(result.dates, ["2026-11-08"]);
 assert.match(result.reason, /未齐/);
 assert.equal(comparableMetric([], "flatkey.ai", "sessions", "2026-11-10").current, null);
});
test("weekly comparison matches weekday pairs and never sums daily distinct registrations", () => {
 const rows = [ga("2026-11-12", 10, { registrations: 3 }), ga("2026-11-05", 8, { registrations: 2 }), ga("2026-11-11", 500)];
 const result = comparableMetric(rows, "flatkey.ai", "sessions", "2026-11-13");
 assert.equal(result.current, 10); assert.equal(result.previous, 8); assert.equal(result.dates.length, 1);
 assert.equal(comparableMetric(rows, "flatkey.ai", "registrations", "2026-11-13").current, null);
});
test("paid/direct and provisional observations cannot leak into organic metrics", () => {
 assert.equal(comparableMetric([ga("2026-11-09", 400, { scope: "all-channels" }), ga("2026-11-08", 100)], "flatkey.ai", "sessions", "2026-11-10").current, null);
 assert.equal(comparableMetric([ga("2026-11-09", 400, { complete: false }), ga("2026-11-08", 100)], "flatkey.ai", "sessions", "2026-11-10").current, null);
});
test("country slices never overwrite global totals or another country", () => {
 const rows = [ga("2026-11-09", 100), ga("2026-11-08", 80), ga("2026-11-09", 30, {country:"US"}), ga("2026-11-08", 20, {country:"US"}), ga("2026-11-09", 50, {country:"BR"})];
 assert.equal(comparableMetric(rows,"flatkey.ai","sessions","2026-11-10").current,100);
 assert.equal(comparableMetric(rows,"flatkey.ai","sessions","2026-11-10","US").current,30);
 assert.equal(comparableMetric(rows,"flatkey.ai","sessions","2026-11-10","BR").current,null);
});
test("Friday retains today's verified links while old backfill is not new translation", () => {
 const p={ id:"friday",title:"Friday launch",url:"https://flatkey.ai/new-tool",kind:"landing",publishedAt:"2026-11-13T11:00:00+08:00",verifiedAt:"2026-11-13T12:00:00+08:00",recordedAt:"2026-11-13T12:01:00+08:00" };
 const report=buildSeoDigest({...base("2026-11-13"),publications:[p,{...p,id:"backfill",url:"https://flatkey.ai/ja/blog/old",kind:"backfill_translation"}]});
 assert.equal(report.counts.landingPages,1); assert.equal(report.counts.translations,0); assert.equal(report.counts.backfillTranslations,1);
 assert.match(report.text,/周五今日上线与优化\n• \[Friday launch\]/);
});
test("preview before 18 is preliminary and absent run receipt is not a zero-work claim", () => {
 const report = buildSeoDigest({ ...base(), now: new Date("2026-11-10T17:30:00+08:00"), publicationCoverage: "missing" });
 assert.equal(report.preliminary, true); assert.match(report.text, /新增博客 待核实/);
});
test("unknown provider result and started send are never automatically reclaimed", () => {
 for (const status of ["UNKNOWN", "SENDING", "DELIVERED"]) assert.equal(digestClaimable({ status, leaseUntil: new Date(0), attemptedAt: new Date(0) }), false);
 assert.equal(digestClaimable({ status: "CLAIMED", leaseUntil: new Date(0), attemptedAt: null }), true);
 assert.equal(digestClaimable({ status: "CLAIMED", leaseUntil: new Date(Date.now() + 60000), attemptedAt: null }), false);
});
test("provider acceptance needs an actual query receipt, not success text", () => {
 assert.equal(providerReceipt({ success: true }), null);
 assert.equal(providerReceipt({ success: false, processQueryKey: "x" }), null);
 assert.equal(providerReceipt({ success: true, result: { processQueryKey: "verified" } }), "verified");
});
test("late historical import is reported next window without becoming newly published output", () => {
 const archive={id:"archive",recordedAt:"2026-11-10T18:05:00+08:00",sourceRunId:"blog-2026-11-10",originals:5,translations:45,liveVerified:5,artifactOnly:45,unknownFirstVerification:50,pendingEvidence:262,pendingRevisions:5};
 const before=buildSeoDigest({...base(),historicalImports:[archive]});
 const after=buildSeoDigest({...base("2026-11-11"),historicalImports:[archive]});
 assert.doesNotMatch(before.text,/历史交付归档/); assert.match(after.text,/历史交付归档（不计入当期新增）/);
 assert.equal(after.counts.originals,0); assert.equal(after.counts.translations,0); assert.match(after.text,/262 项待补证据/);
});
