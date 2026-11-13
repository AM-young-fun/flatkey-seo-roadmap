const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { buildSeoDigest, comparableMetric, digestWindow, digestClaimable, SEO_DATA_HUB } = require("../src/lib/seo-digest.ts");
const { providerReceipt } = require("../scripts/seo-digest-dws.cjs");
const base = (date = "2026-11-10") => ({ date, now: new Date(date + "T18:00:00+08:00"), publications: [], optimizations: [], observations: [], effects: [], priorities: [], issues: [], runNotes: [], publicationCoverage: "verified", optimizationCoverage: "verified" });
const ga = (date, sessions, extra = {}) => ({ site: "flatkey.ai", date, sessions, source: "GA4", timezone: "America/Los_Angeles", scope: "session-organic-search", observedAt: "2026-11-10T00:00:00Z", complete: true, ...extra });
const approval = (id, extra = {}) => ({id, title:"成本计算器页面", siteDomain:"flatkey.ai", weekStart:"2026-10-26", status:"pending", submittedRecordedAt:"2026-10-30T09:00:00Z", decisions:[], supersedesApprovalIds:[], items:[{
 id:id+":en",taskId:id+":task",pageUrl:"https://flatkey.ai/llm-cost-calculator",language:"en",operation:"new",contentVersion:"v1",
 changeSummary:"新增可交互的成本计算表单",previewContentVersion:"v1",previewUrl:"https://preview.example.com/calculator",
 evidence:[{label:"桌面截图",url:"https://images.example.com/share/123",observedAt:"2026-10-30T09:00:00Z"},{label:"手机截图",url:"https://images.example.com/share/mobile",observedAt:"2026-10-30T09:00:00Z"}],
}], ...extra});
function approvalTask(approval, extra = {}) {
 const {taskId, pageUrl, language, contentVersion} = approval.items[0];
 return { id:taskId, title:approval.title, siteDomain:approval.siteDomain, weekStart:approval.weekStart, kind:"landing", status:"review_pending", pageUrl, language, contentVersion, evidence:[], ...extra };
}
const workflow = (approvals, tasks = approvals.map(row => approvalTask(row))) => ({ reviewWorkflow: { approvals, tasks, publications: [], historicalImports: [] } });
test("daily and Friday reports retain cross-week pending approval links without counting deliveries", () => {
 for(const date of ["2026-11-10","2026-11-13"]){
  const result=buildSeoDigest({...base(date),...workflow([approval("calculator-approval")])});
  assert.deepEqual(result.approvalQueue,{tickets:1,pages:1});
  assert.match(result.text,/待审核 1 项（1 张审批单，1 个页面版本） · 待补材料 0 项 · \[SEO 平台审批\]\(https:\/\/flatkey-seo-roadmap\.vercel\.app\/approvals\)/);
  assert.match(result.text,/approvals\?approvalId=calculator-approval/);
  assert.match(result.text,/\[测试链接\]\(https:\/\/preview\.example\.com\/calculator\) · \[截图\]\(https:\/\/images\.example\.com\/share\/123\)/);
  assert.match(result.text,/版本 v1/); assert.equal(result.counts.landingPages,0);
 }
});
test("only unresolved items are reminded after partial decisions and version replacement", () => {
 const old=approval("old");
 const fresh=approval("new",{status:"partially_reviewed",supersedesApprovalIds:["old"],items:[{...old.items[0],id:"new:en",taskId:"new:task",contentVersion:"v2"},{...old.items[0],id:"new:ja",taskId:"new:task",pageUrl:"https://flatkey.ai/ja/llm-cost-calculator",language:"ja",contentVersion:"ja-v3",previewContentVersion:"ja-v3"}],decisions:[{itemIds:["new:en"],decision:"approved"}]});
 const rejected=approval("rejected",{status:"rejected",decisions:[{itemIds:["rejected:en"],decision:"rejected"}]});
 const result=buildSeoDigest({...base(),...workflow([old,fresh,rejected],[approvalTask(old),approvalTask(fresh,{kind:"blog"}),approvalTask(rejected)])});
 assert.deepEqual(result.approvalQueue,{tickets:1,pages:1});
 assert.match(result.text,/待审核 1 项（1 张审批单，1 个页面版本） · 待补材料 0 项/);
 assert.match(result.text,/approvalId=new/); assert.doesNotMatch(result.text,/approvalId=old/); assert.match(result.text,/· ja · 新增/);
});
test("missing approval source stays unknown and an actual empty queue reports no pending pages", () => {
 assert.equal(buildSeoDigest(base()).approvalQueue,null);
 assert.match(buildSeoDigest(base()).text,/审批台账读取失败或尚未接通/);
 assert.match(buildSeoDigest(base()).text,/待审核 待更新 · 待补材料 待更新.*\/approvals\)/);
 assert.deepEqual(buildSeoDigest({...base(),...workflow([])}).approvalQueue,{tickets:0,pages:0});
 assert.match(buildSeoDigest({...base(),...workflow([])}).text,/待审核 0 项（0 张审批单，0 个页面版本） · 待补材料 0 项.*\/approvals\)/);
});
test("long approval queues keep a bounded digest and a link to all pending items", () => {
 const tickets=Array.from({length:12},(_,i)=>approval("ticket"+i,{items:[{...approval("a").items[0],id:"item"+i,taskId:"task"+i,pageUrl:"https://flatkey.ai/page-"+i}]}));
 const result=buildSeoDigest({...base(),...workflow(tickets)});
 assert.deepEqual(result.approvalQueue,{tickets:12,pages:12});
 assert.match(result.text,/其余 9 个页面版本/); assert.equal((result.text.match(/approvalId=/g)||[]).length,3);
});
test("pending review deduplicates a multi-page ticket and its task and separates unsubmitted material", () => {
 const submitted = approval("submitted");
 submitted.items.push({ ...submitted.items[0], id:"submitted:ja", language:"ja", pageUrl:"https://flatkey.ai/ja/calculator", contentVersion:"ja-v3",previewContentVersion:"ja-v3" });
 const research = { label:"搜索意图证据", artifact:"sample:research", observedAt:"2026-11-10T00:00:00Z" };
 const independent = approvalTask(approval("independent"), { kind:"research", title:"独立研究任务", evidence:[research] });
 const draft = approval("draft", { status:"draft", submittedRecordedAt:null });
 const result = buildSeoDigest({...base(),...workflow([submitted, submitted, draft], [
  approvalTask(submitted,{kind:"blog"}), independent, independent, approvalTask(draft),
 ])});
 assert.deepEqual(result.approvalQueue,{tickets:1,pages:2});
 assert.match(result.text,/待审核 1 项（1 张审批单，2 个页面版本） · 待补材料 0 项/);
 assert.doesNotMatch(result.text,/独立研究任务/);
 assert.match(result.text,/未提交草稿 1 张，关联 1 项任务 \/ 1 个页面版本，其中 0 项任务待补材料/);
 assert.doesNotMatch(result.text,/newApproval=1&taskId=draft%3Atask/);
});
test("the review headline counts tasks separately from tickets and page versions", () => {
 const batch = approval("batch");
 const extraTasks = ["one", "two"].map(id => approval(id,{items:[{...batch.items[0],id,taskId:id,pageUrl:"https://flatkey.ai/"+id}]}));
 batch.items.push(...extraTasks.flatMap(row => row.items));
 const translation = approval("translation",{items:[{...batch.items[0],id:"translation:ja",language:"ja",pageUrl:"https://flatkey.ai/ja/calculator",contentVersion:"ja-v2",previewContentVersion:"ja-v2"}]});
 const tasks = [approvalTask(batch,{kind:"blog"}),...extraTasks.map(row => approvalTask(row))];
 const result = buildSeoDigest({...base(),...workflow([batch,translation],tasks)});
 assert.deepEqual(result.approvalQueue,{tickets:2,pages:4});
 assert.match(result.text,/待审核 3 项（2 张审批单，4 个页面版本） · 待补材料 0 项/);
});
test("incomplete review materials count once per task without treating them as pending review", () => {
 const ticket = approval("incomplete");
 const item = ticket.items[0], timestamp = ticket.submittedRecordedAt;
 const local = { label:"截图", artifact:"/tmp/internal.png", observedAt:timestamp };
 const unsafe = { label:"截图", url:"https://user:pass@images.example.com/private.png", observedAt:timestamp };
 ticket.evidence = [{ label:"审批单截图", url:"https://images.example.com/batch.png", observedAt:timestamp }];
 ticket.items = [
  { ...item, changeSummary:"   ", previewUrl:null, draftUrl:"https://drafts.example.com/doc", evidence:[local,unsafe] },
  { ...item, id:"incomplete:ja", language:"ja", pageUrl:"https://flatkey.ai/ja/calculator", previewUrl:"http://preview.example.com/ja", evidence:[local] },
  { ...item, id:"incomplete:fr", language:"fr", pageUrl:"https://flatkey.ai/fr/calculator",
   evidence:[{label:"审稿材料",url:"https://images.example.com/version.WEBP?view=1",observedAt:timestamp}] },
 ];
 const result = buildSeoDigest({...base(),...workflow([ticket],[approvalTask(ticket,{kind:"blog"})])});
 assert.deepEqual(result.approvalQueue,{tickets:0,pages:0});
 assert.match(result.text,/待审核 0 项（0 张审批单，0 个页面版本） · 待补材料 1 项/);
 assert.match(result.text,/缺少独立测试环境链接、桌面截图链接、手机截图链接、改动简介/);
 assert.match(result.text,/缺少独立测试环境链接、桌面截图链接、手机截图链接/);
 assert.doesNotMatch(result.text,/internal\.png|private\.png|batch\.png|drafts\.example\.com|http:\/\/preview/);
});
test("ticket-level screenshots cannot replace version-bound page materials", () => {
 const ticket = approval("single");
 ticket.evidence = ticket.items[0].evidence;
 ticket.items[0].evidence = [];
 const result = buildSeoDigest({...base(),...workflow([ticket])});
 assert.match(result.text,/待审核 0 项（0 张审批单，0 个页面版本） · 待补材料 1 项/);
 assert.match(result.text,/缺少桌面截图链接、手机截图链接/);
});
test("withdrawals, obsolete versions and future submissions do not enter the review total", () => {
 const stale = approval("stale");
 const withdrawn = approval("withdrawn", { status:"withdrawn", decisions:[{itemIds:["withdrawn:en"],decision:"withdrawn"}] });
 const revised = approval("revised", { status:"changes_requested", decisions:[{itemIds:["revised:en"],decision:"changes_requested"}] });
 const future = approval("future", { submittedRecordedAt:"2026-11-10T10:00:01Z" });
 const result = buildSeoDigest({...base(),...workflow([stale, withdrawn, revised, future], [
  approvalTask(stale, { contentVersion:"v2" }), approvalTask(withdrawn), approvalTask(revised), approvalTask(future),
 ])});
 assert.deepEqual(result.approvalQueue,{tickets:0,pages:0});
 assert.match(result.text,/待审核 0 项（0 张审批单，0 个页面版本） · 待补材料 3 项/);
 assert.match(result.text,/approvalId=revised\) · 需按审批意见修改或补充材料/);
 assert.doesNotMatch(result.text,/approvalId=(stale|withdrawn|future)|taskId=withdrawn/);
});
test("a changed live baseline requires a new submission before review", () => {
 const ticket = approval("optimization");
 const item = ticket.items[0];
 Object.assign(item, { operation:"update", baseContentVersion:"live-v1", contentVersion:"draft-v3",previewContentVersion:"draft-v3" });
 const input = workflow([ticket], [approvalTask(ticket,{kind:"optimization"})]);
 input.reviewWorkflow.publications = [{ status:"verified", pageUrl:item.pageUrl, language:item.language, contentVersion:"live-v1", publishedAt:"2026-11-08T12:00:00Z" }];
 assert.match(buildSeoDigest({...base(),...input}).text,/待审核 1 项（1 张审批单，1 个页面版本） · 待补材料 0 项/);
 input.reviewWorkflow.historicalImports = [{ publications:[{ ...input.reviewWorkflow.publications[0], contentVersion:"live-v2", publishedAt:"2026-11-09T12:00:00Z" }] }];
 const result = buildSeoDigest({...base(),...input});
 assert.match(result.text,/待审核 0 项（0 张审批单，0 个页面版本） · 待补材料 1 项/);
 assert.doesNotMatch(result.text,/approvalId=optimization/);
});
test("Friday has a 10am weekly report and an independent 6pm daily report", () => {
 const weekly = buildSeoDigest({...base("2026-11-13"),kind:"weekly",now:new Date("2026-11-13T10:00:00+08:00")});
 const daily = buildSeoDigest(base("2026-11-13"));
 assert.equal(weekly.kind,"weekly"); assert.equal(daily.kind,"daily");
 assert.deepEqual(weekly.workWindow,{start:"2026-11-06T00:00:00+08:00",end:"2026-11-13T00:00:00+08:00"});
 assert.equal(weekly.readyAfter,"2026-11-13T10:00:00+08:00"); assert.equal(weekly.preliminary,false);
 assert.equal(buildSeoDigest({...base("2026-11-13"),kind:"weekly",now:new Date("2026-11-13T09:59:59+08:00")}).preliminary,true);
 assert.equal(daily.readyAfter,"2026-11-13T18:00:00+08:00");
 assert.notEqual(weekly.id,daily.id);
 assert.equal(digestWindow("2026-11-13","weekly").trafficStart,"2026-11-06");
 assert.equal(digestWindow("2026-11-13","daily").trafficStart,"2026-11-12");
 assert.throws(()=>digestWindow("2026-11-12","weekly"),/周五/);
 assert.ok(weekly.text.endsWith(`[数据基础](${SEO_DATA_HUB})`));
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
test("daily digest uses the Flatkey all-channel registration count rather than SEO-attributed users", () => {
 const observations = [ga("2026-11-08", 10, { registrations: 2 }), ga("2026-11-09", 12, { registrations: 3 })];
 const record = { siteDomain: "flatkey.ai", hostScope: "production-hosts-v1", scope: "all-channels", country: "all",
   start: "2026-11-09", end: "2026-11-09", observedAt: "2026-11-10T10:00:00Z", complete: true, reasons: [],
   rows: [{ event: "sign_up", users: 12, events: 14 }] };
 const report = buildSeoDigest({ ...base(), observations, businessObservations: [record] });
 assert.deepEqual(report.flatkeyRegistrations, { start: "2026-11-09", end: "2026-11-09", users: 12 });
 assert.match(report.text, /Flatkey 注册人数 12 人/);
 assert.doesNotMatch(report.text, /注册 2→3/);
 assert.match(report.text, /GA4 行为与转化/);
 assert.match(report.text, /尚无同区间回执，待更新/);
 assert.match(report.text, /全渠道不能当成自然搜索效果/);
});
test("weekly comparison uses only matching weekdays and never sums daily distinct registrations", () => {
 const rows = [ga("2026-11-12", 10, { registrations: 3 }), ga("2026-11-05", 8, { registrations: 2 }), ga("2026-11-11", 500)];
 const result = comparableMetric(rows, "flatkey.ai", "sessions", "2026-11-13", "all", "weekly");
 assert.equal(result.current, 10); assert.equal(result.previous, 8); assert.deepEqual(result.dates, ["2026-11-12"]); assert.match(result.reason, /未齐/);
 assert.equal(comparableMetric(rows, "flatkey.ai", "registrations", "2026-11-13", "all", "weekly").current, null);
});
test("weekly table uses six matched dates for incomplete additive metrics", () => {
 const date = "2026-11-13";
 const dates = Array.from({ length: 14 }, (_, index) => new Date(Date.UTC(2026, 9, 30 + index)).toISOString().slice(0, 10));
 const rows = dates.map((day, index) => ga(day, index < 7 ? 10 : 20));
 const partial = buildSeoDigest({ ...base(date), kind: "weekly", observations: rows.slice(0, -1) });
 const full = buildSeoDigest({ ...base(date), kind: "weekly", observations: rows });
 const period = "2026-10-30—2026-11-05（7日） → 2026-11-06—2026-11-12（7日）";
 assert.ok(partial.weeklyTraffic.slice(1).every(row => row.dates === period));
 assert.deepEqual(partial.weeklyTraffic[0], { label: "自然搜索会话", previous: "60", current: "120", change: "+100%", dates: "2026-10-30—2026-11-04（6日） → 2026-11-06—2026-11-11（6日） · 同星期 6/7 天" });
 assert.deepEqual(full.weeklyTraffic[0], { label: "自然搜索会话", previous: "70", current: "140", change: "+100%", dates: period });
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
 assert.match(report.text,/\[Friday launch\]/);
 assert.equal(buildSeoDigest({...base("2026-11-13"),kind:"weekly",publications:[p]}).counts.landingPages,0);
});
test("preview before 18 is preliminary and absent run receipt is not a zero-work claim", () => {
 const report = buildSeoDigest({ ...base(), now: new Date("2026-11-10T17:30:00+08:00"), publicationCoverage: "missing" });
 assert.equal(report.preliminary, true); assert.match(report.text, /新增博客 暂无上线回执/);
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

test("draft page versions and submitted missing materials deduplicate by task across tickets",()=>{
 const pending=approval("submitted-shared"),task=approvalTask(pending,{kind:"technical",pageUrl:null,status:"drafting"});
 pending.items[0].previewUrl=null;
 const items=Array.from({length:219},(_,i)=>({...pending.items[0],id:"draft-page-"+i,pageUrl:"https://flatkey.ai/page-"+i}));
 const drafts=[approval("draft-shared-1",{status:"draft",submittedRecordedAt:null,items}),approval("draft-shared-2",{status:"draft",submittedRecordedAt:null,items:[{...items[0],id:"extra",pageUrl:"https://flatkey.ai/extra"}]})];
 const future=approval("future-draft",{status:"draft",submittedRecordedAt:null,recordedAt:"2027-01-01T00:00:00Z"});
 const result=buildSeoDigest({...base(),notificationCompact:true,...workflow([pending,...drafts,future],[task,approvalTask(future,{status:"drafting"})])});
 assert.match(result.text,/待审批 0 项 · 材料未齐 1 项/);
 assert.match(result.detailText,/未提交草稿 2 张，关联 1 项任务 \/ 220 个页面版本，其中 1 项任务待补材料/);
 assert.doesNotMatch(result.text,/220 项任务/);
});


test("compact notification is a bounded summary with two next actions, genuine live counts and detail-only diagnostics",()=>{
 const priorities=Array.from({length:8},(_,i)=>({title:"priority-"+i,keyword:"gpu server "+i,country:"US",reason:"checked",action:"prepare draft"}));
 const input={...base(),notificationCompact:true,priorities,issues:["private-diagnostic-marker"],...workflow([])};
 const result=buildSeoDigest(input);
 assert.match(result.text,/今日上线/);assert.match(result.text,/博客.*0 篇/);assert.match(result.text,/待审批 0 项 · 材料未齐 0 项/);
 assert.match(result.text,/priority-1/);assert.doesNotMatch(result.text,/priority-2|private-diagnostic-marker|五站自然搜索|四国（|GA4 业务链/);
 assert.match(result.detailText,/private-diagnostic-marker/);assert.match(result.text,/GitHub 两库/);assert.equal((result.text.match(/数据：/g)||[]).length,1);
 assert.ok(result.text.trim().endsWith(`[数据基础](${SEO_DATA_HUB})`));assert.ok(Buffer.byteLength(result.text)<4500);
 const weekly=buildSeoDigest({...input,date:"2026-11-13",kind:"weekly",now:new Date("2026-11-13T10:00:00+08:00")});
 assert.match(weekly.text,/2026-11-06—2026-11-12/);assert.match(weekly.text,/下周计划 · 尚未排期/);assert.doesNotMatch(weekly.text,/已定事项/);
 const confirmed=buildSeoDigest({...input,date:"2026-11-13",kind:"weekly",nextPlanStatus:"scheduled",now:new Date("2026-11-13T10:00:00+08:00")});
 assert.match(confirmed.text,/下周计划 · 已排期/);assert.match(confirmed.detailText,/下周事项与关键词（已排期）/);
});


test("short GitHub summary adds repository counts only across matching daily windows, never uniques",()=>{
 const github=repository=>({version:1,kind:"github-prompt-channel",repository,observedAt:"2026-11-10T08:00:00Z",timezone:"UTC",stars:10,forks:2,metadataStatus:"ok",metadataReason:null,
 views:{status:"ok",count:7,uniques:3,days:[{date:"2026-11-08",count:3,uniques:2},{date:"2026-11-09",count:4,uniques:2}],reason:null},
 clones:{status:"ok",count:3,uniques:2,days:[{date:"2026-11-08",count:1,uniques:1},{date:"2026-11-09",count:2,uniques:1}],reason:null},
 referrals:[{start:"2026-11-09",end:"2026-11-09",status:"ok",sessions:2,users:1,observedAt:"2026-11-10T08:00:00Z",timezone:"America/Los_Angeles",reason:null}],
 linkAudit:{status:"ok",flatkeyLinks:1,attributedLinks:1,reason:null}});
 const rows=[github("flatkey-ai/awesome-images"),github("flatkey-ai/awesome-seedance-prompts")];
 const report=buildSeoDigest({...base(),notificationCompact:true,githubObservations:rows});
 assert.match(report.text,/Stars 20 \/ Forks 4；浏览 6→8，克隆 2→4；到站 4 会话/);
 assert.match(report.text,/GitHub 2026-11-09/);assert.doesNotMatch(report.text,/去重/);
 rows[1].views.days.pop();rows[1].referrals=[];
 const partial=buildSeoDigest({...base(),notificationCompact:true,githubObservations:rows});
 assert.match(partial.text,/浏览 待更新/);assert.match(partial.text,/到站 待更新/);assert.doesNotMatch(partial.text,/到站 0/);
});

test("partial zero delivery coverage is pending verification instead of a cryptic zero plus",()=>{
 const report=buildSeoDigest({...base(),notificationCompact:true,publicationCoverage:"partial",optimizationCoverage:"partial"});
 assert.doesNotMatch(report.text,/0\+/);assert.doesNotMatch(report.text,/待核实 [篇页]/);assert.match(report.text,/落地页 暂无上线回执/);
});

test("actual verified ES optimization stays visible when the overall execution coverage is missing",()=>{
 const fixture=require("./fixtures/seo-digest-verified-es-optimization-20261112.json");
 const report=buildSeoDigest({...base(fixture.date),now:new Date(fixture.now),notificationCompact:true,
  publications:fixture.publications,optimizations:fixture.optimizations,
  publicationCoverage:fixture.coverage.publications,optimizationCoverage:fixture.coverage.optimizations});
 assert.deepEqual(report.counts,fixture.expectedCounts);
 assert.match(report.text,/优化 至少 1 页（已核实）/);
 assert.match(report.text,/博客.*暂无上线回执 · 落地页 暂无上线回执 · 集群 暂无上线回执/);
 assert.match(report.detailText,/今日优化 至少 1 个页面（已核实），台账覆盖待补/);
 assert.match(report.detailText,/https:\/\/flatkey.ai\/es\/blog\/gpu-server/);
 assert.doesNotMatch(report.text,/优化 暂无上线回执/);
});

test("incomplete coverage reports verified lower bounds and keeps unknown zero distinct from a verified zero",()=>{
 const publication={id:"source",title:"Verified source",url:"https://flatkey.ai/blog/source",kind:"source",publishedAt:"2026-11-10T12:00:00+08:00",verifiedAt:"2026-11-10T12:01:00+08:00",recordedAt:"2026-11-10T12:02:00+08:00"};
 const optimization={id:"change",url:publication.url,keyword:"gpu server",changes:"title",verifiedAt:publication.verifiedAt,recordedAt:publication.recordedAt,baselineId:"baseline"};
 for(const coverage of ["missing","partial"]){
  const report=buildSeoDigest({...base(),notificationCompact:true,publicationCoverage:coverage,optimizationCoverage:coverage,publications:[publication],optimizations:[optimization]});
  assert.match(report.text,/博客.*至少 1 篇（已核实）/);assert.match(report.text,/优化 至少 1 页（已核实）/);
  assert.match(report.detailText,/新增博客 至少 1 篇（已核实）/);
  assert.match(report.text,/落地页 暂无上线回执 · 集群 暂无上线回执/);
  const unknown=buildSeoDigest({...base(),notificationCompact:true,publicationCoverage:coverage,optimizationCoverage:coverage});
  assert.match(unknown.text,/优化 暂无上线回执/);assert.match(unknown.detailText,/新增博客 暂无上线回执/);
  assert.doesNotMatch(unknown.text,/0 [篇页]|至少 0/);
 }
 const complete=buildSeoDigest({...base(),notificationCompact:true});
 assert.match(complete.text,/博客.*0 篇/);assert.match(complete.text,/优化 0 页/);assert.doesNotMatch(complete.text,/至少/);
});

test("a checked empty publication is distinct from a category without a receipt", () => {
 const report = buildSeoDigest({ ...base(), notificationCompact: true, publicationCoverage: "partial",
   deliveryStates: { blogs: true, landing: false, cluster: false, optimizations: false } });
 assert.match(report.text, /博客.*已核实 0 篇 · 落地页 暂无上线回执/);
});

test("natural-search registrations compare verified distinct GA4 users without using all-channel or daily sums", () => {
 const organic = (start, end, users, extra = {}) => ({ scope: "session-organic-search", country: "all", start, end,
   hostScope: "production-hosts-v1", observedAt: "2026-11-13T16:00:00Z", complete: true, reasons: [], rows: [{ event: "sign_up", users, events: users }], ...extra });
 const date = "2026-11-13";
 const businessObservations = [organic("2026-11-11", "2026-11-11", 5), organic("2026-11-12", "2026-11-12", 0),
   organic("2026-11-12", "2026-11-12", 15, { scope: "all-channels" }),
   organic("2026-11-06", "2026-11-12", 17), organic("2026-10-30", "2026-11-05", 11)];
 const input = { ...base(date), businessObservations };
 assert.deepEqual(buildSeoDigest(input).organicRegistrations, { previous: 5, current: 0 });
 assert.deepEqual(buildSeoDigest({ ...input, kind: "weekly" }).organicRegistrations, { previous: 11, current: 17 });
 assert.deepEqual(buildSeoDigest({ ...input, kind: "weekly", businessObservations: businessObservations.slice(0, 3) }).organicRegistrations, { previous: null, current: null });
});
test("Friday DingTalk reports remind only unfinished weekly and overdue approvals", () => {
 const date = "2026-11-13";
 const approvals = [approval("due"), approval("late"), approval("future"), approval("done")];
 const tasks = approvals.map((row, i) => approvalTask(row, { weekStart: ["2026-11-09", "2026-11-02", "2026-11-16", "2026-11-09"][i] }));
 approvals[3].decisions = [{ itemIds: [approvals[3].items[0].id], decision: "approved" }];
 for (const kind of ["daily", "weekly"]) {
   const report = buildSeoDigest({ ...base(date), ...workflow(approvals, tasks), kind, notificationCompact: true, optimizationMonitoring: [] });
   assert.match(report.text, /审批逾期 1 项 · 本周审批还有 1 项未完成/);
   assert.match(report.text, /\[去审核\]\(https:\/\/flatkey-seo-roadmap.vercel.app\/approvals\)/);
 }
 const monday = buildSeoDigest({ ...base("2026-11-16"), ...workflow(approvals, tasks), notificationCompact: true, optimizationMonitoring: [] });
 assert.match(monday.text, /审批逾期 2 项/);
 assert.doesNotMatch(monday.text, /本周审批还有/);
});
test("recent page comparison includes both weeks, excludes unverified and newer weekly records, dedupes by latest change and prioritizes freshness", () => {
 const { recentPublishedPages } = require("../src/lib/seo-digest-recent-pages.ts");
 const page = (name, day, kind = "landing", extra = {}) => ({ pageUrl: "https://flatkey.ai/" + name, siteDomain: "flatkey.ai", title: name, kind,
   publishedAt: day + "T15:00:00Z", verifiedAt: day + "T15:05:00Z", verificationRecordedAt: day + "T15:10:00Z",
   status: "verified", ...(kind === "landing" ? { approvalId: name, approvalItemId: name } : {}), ...extra });
 const publications = [page("new", "2026-11-04"), page("optimized", "2026-11-07", "optimization"), page("optimized", "2026-11-10", "optimization"),
   page("friday", "2026-11-13", "optimization"), page("older", "2026-10-29", "optimization"),
   page("unknown", "2026-11-10", "optimization", { status: "published" })];
 const search = (day, name, clicks) => ({ kind: "gsc-pages", complete: true, date: day, property: "sc-domain:flatkey.ai",
   observedAt: "2026-11-13T16:00:00Z", rows: [{ url: "https://flatkey.ai/" + name, clicks, impressions: clicks * 10 }] });
 const observations = [search("2026-11-09", "new", 100), search("2026-11-12", "optimized", 3), search("2026-11-09", "optimized", 1)];
 const approvals = [{ id: "new", items: [{ id: "new", operation: "new" }] }];
 const now = new Date("2026-11-13T17:00:00Z");
 const weekly = recentPublishedPages({ approvals, publications }, observations, "2026-11-13", now, true);
 assert.deepEqual(weekly.map(row => [row.title, row.change, row.cohort]), [["optimized", "optimization", "current"], ["new", "new", "previous"]]);
 assert.equal(weekly[0].before.clicks, 1);
 assert.equal(weekly[0].latest.clicks, 3);
 assert.equal(recentPublishedPages({ approvals, publications }, observations, "2026-11-13", now, false).some(row => row.title === "friday"), true);
});

test("daily and weekly notifications link to plan details with separate page and keyword counts", () => {
 const tasks = ["optimization", "blog", "landing"].map((kind, i) => ({ id: kind, kind, title: kind, keyword: "local keyword",
   country: "US", language: "en", pageUrl: null, dueAt: "2026-11-13T10:00:00Z", status: i === 0 ? "verified" : "drafting", action: "" }));
 const workPlan = { weekStart: "2026-11-09", status: "reviewed", tasks };
 const report = buildSeoDigest({ ...base("2026-11-13"), workPlan, notificationCompact: true, optimizationMonitoring: [] });
 assert.match(report.text, /页面优化 1\/1 已验收 · 博客关键词 0\/1 已验收 · 落地页关键词 0\/1 已验收/);
 const weekly = buildSeoDigest({ ...base("2026-11-13"), workPlan, kind: "weekly", notificationCompact: true, optimizationMonitoring: [] });
 assert.match(weekly.text, /页面优化 1 项 · 博客关键词 1 项 · 落地页关键词 1 项/);
 assert.equal(weekly.workPlan.tasks.length, 3);
});
