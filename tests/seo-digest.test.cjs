const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { buildSeoDigest, comparableMetric, digestWindow, digestClaimable, SEO_DATA_HUB } = require("../src/lib/seo-digest.ts");
const { accountRegistrationSnapshotSchema, accountRegistrationSummary } = require("../src/lib/seo-account-registrations.ts");
const { technicalQaReport } = require("../src/lib/seo-technical-qa-report.ts");
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
test("new weekly drafts use the same closed LA Thursday-Wednesday period on Thursday and Friday", () => {
 const thursday = digestWindow("2026-11-19", "weekly"), friday = digestWindow("2026-11-20", "weekly");
 assert.deepEqual(thursday, friday);
 assert.equal(thursday.trafficStart, "2026-11-12"); assert.equal(thursday.trafficEnd, "2026-11-18");
 assert.equal(thursday.workStart, "2026-11-12T08:00:00.000Z"); assert.equal(thursday.workEnd, "2026-11-19T08:00:00.000Z");
 assert.equal(thursday.readyAfter, "2026-11-19T16:30:00+08:00");
 const before = buildSeoDigest({ ...base("2026-11-19"), kind: "weekly", now: new Date("2026-11-19T16:29:59+08:00") });
 const ready = buildSeoDigest({ ...base("2026-11-19"), kind: "weekly", now: new Date("2026-11-19T16:30:00+08:00"), notificationCompact: true });
 assert.equal(before.preliminary, true); assert.equal(ready.preliminary, false);
 assert.deepEqual(ready.reportPeriod, { start: "2026-11-12", end: "2026-11-18", timezone: "America/Los_Angeles" });
 assert.match(ready.text, /统计期\*\* 2026-11-12—2026-11-18（洛杉矶）/);
 assert.match(ready.text, /待用户审核/); assert.match(ready.detailText, /2026-11-13 — 2026-11-19（北京时间，周五至周四）/);
 assert.equal(buildSeoDigest({ ...base("2026-11-13"), kind: "weekly" }).reportPeriod, undefined);
 assert.throws(() => digestWindow("2026-11-21", "weekly"), /周四或周五/);
});
test("future LA weekly work boundaries and preparation clocks follow DST", () => {
 const summer = digestWindow("2027-07-01", "weekly"), spring = digestWindow("2027-03-18", "weekly"), autumn = digestWindow("2027-11-11", "weekly");
 assert.equal(summer.workEnd, "2027-07-01T07:00:00.000Z");
 assert.equal(summer.readyAfter, "2027-07-01T07:30:00.000Z");
 assert.equal((Date.parse(spring.workEnd) - Date.parse(spring.workStart)) / 3600000, 167);
 assert.equal((Date.parse(autumn.workEnd) - Date.parse(autumn.workStart)) / 3600000, 169);
});
test("weekly deliveries are counted using Beijing Friday–Thursday boundaries and actual verification receipt time", () => {
 const publication = (id, stamp) => ({ id, title: id, url: "https://flatkey.ai/blog/" + id, kind: "source", publishedAt: stamp, verifiedAt: stamp, recordedAt: stamp });
 const report = buildSeoDigest({ ...base("2026-11-19"), kind: "weekly", publications: [
  publication("before", "2026-11-12T15:59:59Z"), publication("start", "2026-11-12T16:00:00Z"),
  publication("last", "2026-11-19T15:59:59Z"), publication("after", "2026-11-19T16:00:00Z"),
 ], now: new Date("2026-11-20T00:00:00+08:00") });
 assert.equal(report.counts.originals, 2);
});
test("new LA weeks keep stage values but do not compute a weekly change from six days", () => {
 const rows = Array.from({ length: 14 }, (_, i) => ga(new Date(Date.parse("2026-11-05T00:00:00Z") + i * 86400000).toISOString().slice(0, 10), i < 7 ? 10 : 20));
 const partial = buildSeoDigest({ ...base("2026-11-19"), kind: "weekly", notificationCompact: true, observations: rows.filter(row => row.date !== "2026-11-18") });
 const metric = partial.weeklyTraffic.find(row => row.label === "自然搜索会话");
 assert.equal(metric.current, "120"); assert.equal(metric.previous, "60"); assert.equal(metric.change, "—");
 assert.match(metric.dates, /阶段值不计算周环比/); assert.doesNotMatch(partial.text, /100\.0%/);
 const full = buildSeoDigest({ ...base("2026-11-19"), kind: "weekly", notificationCompact: true, observations: rows });
 assert.match(full.text, /自然搜索会话 70 → \*\*140\*\*（\+70 \/ \+100\.0%）/);
});
test("new LA weeks reject other property-day timezones and keep UTC account registration separately labelled", () => {
 const rows = [ga("2026-11-05", 10, { site: "rackrate.org", timezone: "Asia/Shanghai" }), ga("2026-11-12", 20, { site: "rackrate.org", timezone: "Asia/Shanghai" })];
 const metric = comparableMetric(rows, "rackrate.org", "sessions", "2026-11-19", "all", "weekly");
 assert.equal(metric.current, null); assert.match(metric.reason, /不能代替洛杉矶统计周期/);
 const report = buildSeoDigest({ ...base("2026-11-19"), kind: "weekly", notificationCompact: true, observations: rows,
  accountRegistrations: { start: "2026-11-12", end: "2026-11-18", users: 15, missing: [] } });
 assert.match(report.text, /UTC（独立来源日桶，非洛杉矶周合计）/);
 assert.match(report.detailText, /不计入洛杉矶统计期合计/);
});
test("new weekly registration stages show their covered dates without a weekly percentage", () => {
 const registrationPeriods = [
  { start: "2026-11-05", end: "2026-11-09", users: 10, observedAt: "2026-11-18T00:00:00Z" },
  { start: "2026-11-12", end: "2026-11-16", users: 20, observedAt: "2026-11-19T08:00:00Z" },
 ];
 const report = buildSeoDigest({ ...base("2026-11-19"), kind: "weekly", notificationCompact: true, registrationPeriods });
 assert.match(report.text, /首次自然搜索获客去重注册 10 → \*\*20\*\* · 2026-11-05—2026-11-09 → 2026-11-12—2026-11-16（覆盖待齐，不计算周环比）/);
 assert.doesNotMatch(report.text, /100\.0%/);
 assert.equal(report.weeklyTraffic.find(row => row.label === "自然搜索去重注册用户").change, "—");
 assert.equal(report.organicRegistrationCanCompare, false);
 const complete = buildSeoDigest({ ...base("2026-11-19"), kind: "weekly", registrationPeriods: registrationPeriods.map(row => ({ ...row,
  end: row.start === "2026-11-12" ? "2026-11-18" : "2026-11-11" })) });
 assert.equal(complete.organicRegistrationCanCompare, true);
 assert.equal(buildSeoDigest({ ...base("2026-11-13"), kind: "weekly" }).organicRegistrationCanCompare, undefined);
});
test("new weekly detail does not present a one-day page leaderboard change as a weekly percentage", () => {
 const page = (date, clicks) => ({ kind: "gsc-pages", property: "sc-domain:flatkey.ai", source: "google-api", date,
  observedAt: "2026-11-19T08:00:00Z", complete: true, rows: [{ url: "https://flatkey.ai/blog/page", clicks, impressions: clicks * 10, position: 3 }] });
 const report = buildSeoDigest({ ...base("2026-11-19"), kind: "weekly", notificationCompact: true,
  pageObservations: [page("2026-11-16", 10), page("2026-11-17", 20)] });
 assert.equal(report.pagePerformance[0].modules.find(row => row.id === "blog").pages[0].percentage, 100);
 assert.doesNotMatch(report.detailText, /100\.0%/);
 assert.doesNotMatch(report.text, /100\.0%/);
});
test("late verification is counted in the next window, sources and translations remain separate", () => {
 const rows = [
  { id: "a", title: "source", url: "https://flatkey.ai/blog/a", kind: "source", publishedAt: "2026-11-09T17:58:00+08:00", verifiedAt: "2026-11-09T18:05:00+08:00", recordedAt: "2026-11-09T18:05:00+08:00" },
  { id: "b", title: "translation", url: "https://flatkey.ai/ja/blog/a", kind: "translation", publishedAt: "2026-11-09T17:58:00+08:00", verifiedAt: "2026-11-09T18:05:00+08:00", recordedAt: "2026-11-09T18:05:00+08:00" },
 ];
 assert.equal(buildSeoDigest({ ...base("2026-11-09"), publications: rows }).counts.originals, 0);
 assert.deepEqual(buildSeoDigest({ ...base(), publications: rows }).counts, { originals: 1, translations: 1, backfillTranslations: 0, blogPages: 2, landingPages: 0, clusterPages: 0, optimizedPages: 0 });
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
 assert.equal(result.current, null); assert.equal(result.previous, 0); assert.deepEqual(result.dates, []);
 assert.match(result.reason, /当日数据待补/);
 assert.equal(comparableMetric(rows, "flatkey.ai", "sessions", "2026-11-09").current, 0);
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
 assert.doesNotMatch(report.text, /GA4 行为与转化/);
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
 assert.equal(comparableMetric(rows,"flatkey.ai","sessions","2026-11-10","BR").current,50);
 assert.equal(comparableMetric(rows,"flatkey.ai","sessions","2026-11-10","BR").canCompare,false);
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
 assert.equal(report.preliminary, true); assert.match(report.text, /新增博客页面 暂无上线回执/);
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
 assert.match(result.detailText,/待审核 0 项[^\n]*待补材料 1 项/);
 assert.match(result.detailText,/未提交草稿 2 张，关联 1 项任务 \/ 220 个页面版本，其中 1 项任务待补材料/);
 assert.doesNotMatch(result.text,/220 项任务/);
});


test("DingTalk daily and weekly cards show comparable data with the real dates and a short operational summary", () => {
 const date = "2026-11-13";
 const gsc = (day, clicks, impressions) => ({ site: "flatkey.ai", date: day, source: "GSC",
   scope: "google-web", timezone: "America/Los_Angeles", complete: true, observedAt: date + "T08:00:00Z", clicks, impressions });
 const observations = [ga("2026-11-10", 10), ga("2026-11-11", 0),
   gsc("2026-11-09", 5, 50), gsc("2026-11-10", 10, 100), gsc("2026-11-03", 4, 40)];
 const input = { ...base(date), notificationCompact: true, observations, issues: ["private-diagnostic-marker"],
   nextPlanStatus: "scheduled", ...workflow([approval("compact-test")]) };
 const daily = buildSeoDigest({...input, observations:[ga("2026-11-11",10),ga("2026-11-12",0),gsc("2026-11-11",5,50),gsc("2026-11-12",10,100)]});
 assert.match(daily.text, /\*\*Flatkey SEO 日报｜2026-11-12\*\*/);
 assert.match(daily.text, /自然搜索会话 10 → \*\*0\*\*（-10 \/ -100.0%） · 2026-11-11 → 2026-11-12/);
 assert.match(daily.text, /Google 全站点击 5 → \*\*10\*\*（\+5 \/ \+100.0%） · 2026-11-11 → 2026-11-12/);
 assert.match(daily.text, /Google 全站曝光 50 → \*\*100\*\*/);
 assert.match(daily.text, /Google CTR 10.00% → 10.00%/);
 assert.match(daily.text, /当日优化效果[\s\S]*关键词实测排名[\s\S]*技术异常[\s\S]*今日完成[\s\S]*数据状态/);
 assert.doesNotMatch(daily.text, /private-diagnostic-marker|https:/);
 assert.match(daily.detailText, /private-diagnostic-marker|待审核/);
 const weekly = buildSeoDigest({ ...input, kind: "weekly" });
 assert.match(weekly.text, /2026-11-06—2026-11-12/);
 assert.match(weekly.text, /Google 全站点击 4 → \*\*10\*\*（\+6 \/ \+150.0%） · 2026-11-03 → 2026-11-10/);
 assert.match(weekly.text, /GA4 自然搜索会话 待更新 → \*\*10\*\*/);
 assert.match(weekly.text, /业务结果与搜索表现[\s\S]*重点页面[\s\S]*关键词与技术异常[\s\S]*上期动作复盘[\s\S]*下周优先事项/);
 assert.match(weekly.detailText, /下周事项与关键词（已排期）/);
});


test("daily card does not replace an unpaired latest day with an older comparison or treat a missing funnel as zero", () => {
 const date = "2026-11-17";
 const dailyAcquisition = { points: [
   { date: "2026-11-15", newUsers: 80, newRegistrations: 1 },
   { date: "2026-11-16", newUsers: 96, newRegistrations: 0 },
 ] };
 const pageGroups = { groups: [{ key: "gpu_compute", points: [
   { date: "2026-11-15", totalUsers: 23, pageViews: 33, funnel: { entrants: 20, registrations: 2 }, collectedAt: "2026-11-16T12:00:00Z" },
   { date: "2026-11-16", totalUsers: 31, pageViews: 40, funnel: null, collectedAt: "2026-11-17T12:00:00Z" },
 ] }] };
 const observations = [ga("2026-11-12", 30), ga("2026-11-13", 32), ga("2026-11-16", 115)];
 const report = buildSeoDigest({ ...base(date), now:new Date("2026-11-19T18:00:00+08:00"), notificationCompact: true, dailyAcquisition, pageGroups, observations });
 assert.match(report.text, /GA4 新用户（首次来源为自然搜索） 80 → \*\*96\*\*（\+16 \/ \+20\.0%）/);
 assert.match(report.text, /GA4 去重注册（首次来源为自然搜索） 1 → \*\*0\*\*/);
 assert.match(report.text, /GA4 自然搜索会话 待更新 → \*\*115\*\* · 待更新 → 2026-11-16/);
 assert.doesNotMatch(report.text, /页面组表现|GPU 算力 ·|同日注册 2/);
 assert.match(report.text, /当日页面组 0\/4/);
});

test("actual verified ES optimization stays visible when the overall execution coverage is missing",()=>{
 const fixture=require("./fixtures/seo-digest-verified-es-optimization-20261112.json");
 const report=buildSeoDigest({...base(fixture.date),now:new Date(fixture.now),notificationCompact:true,
  publications:fixture.publications,optimizations:fixture.optimizations,
  publicationCoverage:fixture.coverage.publications,optimizationCoverage:fixture.coverage.optimizations});
 assert.deepEqual(report.counts,{...fixture.expectedCounts,blogPages:0});
 assert.match(report.text,/优化 \*\*1 个页面\*\*/);
 assert.match(report.detailText,/今日优化 已核实 1 个页面，台账覆盖待补/);
 assert.match(report.detailText,/https:\/\/flatkey.ai\/es\/blog\/gpu-server/);
 assert.doesNotMatch(report.text,/优化 暂无上线回执/);
});

test("incomplete coverage reports verified lower bounds and keeps unknown zero distinct from a verified zero",()=>{
 const publication={id:"source",title:"Verified source",url:"https://flatkey.ai/blog/source",kind:"source",publishedAt:"2026-11-10T12:00:00+08:00",verifiedAt:"2026-11-10T12:01:00+08:00",recordedAt:"2026-11-10T12:02:00+08:00"};
 const optimization={id:"change",url:publication.url,keyword:"gpu server",changes:"title",verifiedAt:publication.verifiedAt,recordedAt:publication.recordedAt,baselineId:"baseline"};
 for(const coverage of ["missing","partial"]){
  const report=buildSeoDigest({...base(),notificationCompact:true,publicationCoverage:coverage,optimizationCoverage:coverage,publications:[publication],optimizations:[optimization]});
  assert.match(report.detailText,/新增博客页面 已核实 1 页/);assert.match(report.detailText,/优化 已核实 1 个页面/);
  assert.match(report.detailText,/新增博客页面 已核实 1 页/);
  assert.match(report.detailText,/落地页\/工具页 暂无上线回执，集群交付 暂无上线回执/);
  const unknown=buildSeoDigest({...base(),notificationCompact:true,publicationCoverage:coverage,optimizationCoverage:coverage});
  assert.match(unknown.detailText,/优化 暂无上线回执/);assert.match(unknown.detailText,/新增博客页面 暂无上线回执/);
  assert.doesNotMatch(unknown.detailText,/至少 0/);
 }
 const complete=buildSeoDigest({...base(),notificationCompact:true});
 assert.match(complete.detailText,/博客.*0 篇/);assert.match(complete.detailText,/优化 0 个页面/);assert.doesNotMatch(complete.detailText,/至少/);
});

test("a checked empty publication is distinct from a category without a receipt", () => {
 const report = buildSeoDigest({ ...base(), notificationCompact: true, publicationCoverage: "partial",
   deliveryStates: { blogs: true, landing: false, cluster: false, optimizations: false } });
 assert.match(report.detailText, /新增博客页面 已核实 0 页[\s\S]*落地页\/工具页 暂无上线回执/);
});

test("natural-search registrations compare verified distinct GA4 users without using all-channel or daily sums", () => {
 const organic = (start, end, users, extra = {}) => ({ scope: "session-organic-search", country: "all", start, end,
   hostScope: "production-hosts-v1", observedAt: "2026-11-13T16:00:00Z", complete: true, reasons: [], rows: [{ event: "sign_up", users, events: users }], ...extra });
 const date = "2026-11-13";
 const businessObservations = [organic("2026-11-11", "2026-11-11", 5), organic("2026-11-12", "2026-11-12", 0),
   organic("2026-11-12", "2026-11-12", 15, { scope: "all-channels" }),
   organic("2026-11-06", "2026-11-12", 17), organic("2026-10-30", "2026-11-05", 11)];
 const registrationPeriods = businessObservations.filter(row => row.scope === "session-organic-search").map(row => ({ start: row.start, end: row.end, users: row.rows[0].users, observedAt: row.observedAt }));
 const input = { ...base(date), businessObservations, registrationPeriods };
 assert.deepEqual(buildSeoDigest({ ...input, registrationPeriods: [] }).organicRegistrations, { previous: null, current: null });
 assert.deepEqual(buildSeoDigest(input).organicRegistrations, { previous: 5, current: 0 });
 assert.deepEqual(buildSeoDigest({ ...input, kind: "weekly" }).organicRegistrations, { previous: 11, current: 17 });
 assert.deepEqual(buildSeoDigest({ ...input, kind: "weekly", registrationPeriods: registrationPeriods.slice(0, 2) }).organicRegistrations, { previous: null, current: null });
});
test("Friday platform reports remind only unfinished weekly and overdue approvals", () => {
 const date = "2026-11-13";
 const approvals = [approval("due"), approval("late"), approval("future"), approval("done")];
 const tasks = approvals.map((row, i) => approvalTask(row, { weekStart: ["2026-11-09", "2026-11-02", "2026-11-16", "2026-11-09"][i] }));
 approvals[3].decisions = [{ itemIds: [approvals[3].items[0].id], decision: "approved" }];
 for (const kind of ["daily", "weekly"]) {
   const report = buildSeoDigest({ ...base(date), ...workflow(approvals, tasks), kind, notificationCompact: true, optimizationMonitoring: [] });
   assert.match(report.detailText, /审批逾期 1 项 · 本周仍有 1 项待处理/);
   assert.match(report.detailText, /\[去审核\]\(https:\/\/flatkey-seo-roadmap.vercel.app\/approvals\)/);
 }
 const monday = buildSeoDigest({ ...base("2026-11-16"), ...workflow(approvals, tasks), notificationCompact: true, optimizationMonitoring: [] });
 assert.match(monday.detailText, /审批逾期 2 项/);
 assert.doesNotMatch(monday.detailText, /本周仍有/);
});
test("recent optimization comparison includes the full month and excludes new or unverified pages", () => {
 const { recentPublishedPages } = require("../src/lib/seo-digest-recent-pages.ts");
 const page = (name, day, kind = "optimization", extra = {}) => ({ pageUrl: "https://flatkey.ai/" + name, siteDomain: "flatkey.ai", title: name, kind,
   publishedAt: day + "T15:00:00Z", verifiedAt: day + "T15:05:00Z", verificationRecordedAt: day + "T15:10:00Z", status: "verified", ...extra });
 const publications = [page("new", "2026-11-04", "landing", { automaticWrite: { operation: "create" } }),
   page("optimized", "2026-11-07"), page("optimized", "2026-11-10"), page("older", "2026-10-29"),
   page("unknown", "2026-11-10", "optimization", { status: "published" })];
 const search = (day, name, clicks) => ({ kind: "gsc-pages", complete: true, date: day, property: "sc-domain:flatkey.ai",
   observedAt: "2026-11-13T16:00:00Z", rows: [{ url: "https://flatkey.ai/" + name, clicks, impressions: clicks * 10 }] });
 const observations = [search("2026-11-03", "new", 1), search("2026-11-09", "new", 100),
   search("2026-11-12", "optimized", 3), search("2026-11-09", "optimized", 1),
   search("2026-10-28", "older", 1), search("2026-11-11", "older", 11)];
 const monthly = recentPublishedPages({ approvals: [], publications }, observations, "2026-11-13", new Date("2026-11-13T17:00:00Z"), true);
 assert.deepEqual(monthly.map(row => [row.title, row.change]), [["older", "optimization"], ["optimized", "optimization"]]);
 assert.equal(monthly[1].before.clicks, 1);
 assert.equal(monthly[1].latest.clicks, 3);
 const daily = recentPublishedPages({ approvals: [], publications }, [...observations, search("2026-11-11", "optimized", 2)], "2026-11-13", new Date("2026-11-13T17:00:00Z"), false);
 assert.deepEqual(daily.map(row => [row.title,row.before.date,row.latest.date]), [["optimized","2026-11-11","2026-11-12"]]);
 assert.deepEqual(recentPublishedPages({ approvals: [], publications }, observations, "2026-11-13", new Date("2026-11-13T17:00:00Z"), false), [], "an older launch baseline cannot replace the missing previous day");
});
test("monthly optimization ranking keeps the traffic cutoff when execution work has another timezone", () => {
 const { recentPublishedPages } = require("../src/lib/seo-digest-recent-pages.ts");
 const page = (name, stamp) => ({ pageUrl: "https://flatkey.ai/" + name, siteDomain: "flatkey.ai", title: name, kind: "optimization",
  publishedAt: stamp, verifiedAt: stamp, verificationRecordedAt: stamp, status: "verified" });
 const publications = [page("last", "2026-11-18T08:00:00Z"), page("after", "2026-11-19T08:00:00Z")];
 const observations = ["last", "after"].flatMap(name => [
  { kind: "gsc-pages", complete: true, date: "2026-11-17", property: "sc-domain:flatkey.ai", observedAt: "2026-11-20T00:00:00Z", rows: [{ url: "https://flatkey.ai/" + name, clicks: 0, impressions: 1 }] },
  { kind: "gsc-pages", complete: true, date: "2026-11-20", property: "sc-domain:flatkey.ai", observedAt: "2026-11-21T00:00:00Z", rows: [{ url: "https://flatkey.ai/" + name, clicks: 10, impressions: 20 }] },
 ]);
 const window = { trafficStart: "2026-11-12", trafficEnd: "2026-11-18", workEnd: "2026-11-20T00:00:00+08:00", workTimezone: "Asia/Shanghai" };
 assert.deepEqual(recentPublishedPages({ approvals: [], publications }, observations, "2026-11-19", new Date("2026-11-21T08:30:00Z"), true, window), []);
});

test("daily and weekly reports preserve linked plans and include the next scheduled tasks in the weekly card", () => {
 const tasks = ["optimization", "blog", "landing"].map((kind, i) => ({ id: kind, kind, title: kind, keyword: "local keyword",
   country: "US", language: "en", pageUrl: null, dueAt: "2026-11-13T10:00:00Z", status: i === 0 ? "verified" : "drafting", action: "" }));
 const workPlan = { weekStart: "2026-11-09", status: "reviewed", tasks };
 const report = buildSeoDigest({ ...base("2026-11-13"), workPlan, notificationCompact: true, optimizationMonitoring: [] });
 assert.deepEqual(report.workPlan.tasks, tasks);
 assert.doesNotMatch(report.text, /local keyword/);
 const weekly = buildSeoDigest({ ...base("2026-11-13"), workPlan, kind: "weekly", notificationCompact: true, optimizationMonitoring: [] });
 assert.match(weekly.text, /下周优先事项[\s\S]*local keyword US[\s\S]*截止 2026-11-13/);
 assert.equal(weekly.workPlan.tasks.length, 3);
});

test("a daily QA receipt shows issues from its evidence and distinguishes linked work from an issue alone", () => {
 const now = new Date("2026-11-17T10:00:00Z");
 const observedAt = "2026-11-17T02:01:00Z";
 const evidence = [{ artifact: "qa-summary", observedAt }];
 const run = {
   id: "qa", stage: "TECHNICAL_QA", scheduledFor: "2026-11-17T02:00:00Z", startedAt: "2026-11-17T02:00:00Z",
   completedAt: "2026-11-17T02:02:00Z", failureReason: "PSI 429。", status: "partial", coverage: "partial",
   completedItems: 182, checkedItems: 183, sourceDates: {}, nextAction: "", evidence, taskIds: [],
 };
 const issue = { id: "psi", weekStart: "2026-11-16", title: "PSI 限流", taskId: null, priority: "P2", status: "open", nextAction: "复查", evidence };
 const linked = { ...issue, id: "css", title: "旧 CSS", taskId: "css-task", priority: "P1" };
 const qa = technicalQaReport({ runs: [run], issues: [issue, linked], approvals: [], tasks: [{ id: "css-task", weekStart: "2026-11-09" }] },
   "2026-11-16T10:00:00Z", "2026-11-17T10:00:00Z", now);
 const report = buildSeoDigest({ ...base("2026-11-17"), now, technicalQa: qa });
 assert.match(report.detailText, /issues\?week=2026-11-16#issue-psi\) · 尚未建工作任务/);
 assert.match(report.detailText, /work\/css-task\?week=2026-11-09/);
});

test("account registrations keep UTC dates, real zero, later corrections, and incomplete weeks", () => {
 const earlier = {
   version: 1, source: "flatkey-console-usage-report", timezone: "UTC", group: "all",
   observedAt: "2026-11-13T05:00:00Z", days: [{ date: "2026-11-11", registered: 7 }, { date: "2026-11-12", registered: 0 }],
 };
 const corrected = { ...earlier, observedAt: "2026-11-14T05:00:00Z", days: [{ date: "2026-11-11", registered: 8 }] };
 assert.ok(accountRegistrationSnapshotSchema.safeParse(earlier).success);
 assert.equal(accountRegistrationSnapshotSchema.safeParse({ ...earlier, group: "plg" }).success, false);
 assert.equal(accountRegistrationSnapshotSchema.safeParse({ ...earlier, days: [{ date: "2026-11-13", registered: 1 }] }).success, false);
 assert.equal(accountRegistrationSnapshotSchema.safeParse({ ...earlier, days: [...earlier.days, earlier.days[0]] }).success, false);
 assert.equal(accountRegistrationSummary({ start: "2026-11-11", end: "2026-11-12" }, [corrected, earlier]).users, 8);
 const accountRegistrations = accountRegistrationSummary({ start: "2026-11-12", end: "2026-11-12" }, [earlier, corrected]);
 const daily = buildSeoDigest({ ...base("2026-11-13"), accountRegistrations, notificationCompact: true });
 assert.equal(daily.accountRegistrations.users, 0);
 assert.match(daily.text, /Flatkey 账户注册 0 人 · UTC/);
 assert.match(daily.detailText, /Flatkey 注册人数 0 人（账户系统 · 2026-11-12 UTC/);
 const week = accountRegistrationSummary({ start: "2026-11-06", end: "2026-11-12" }, [earlier, corrected]);
 assert.equal(week.missing.length, 5);
 assert.equal(week.users, null);
});


test("daily card compares optimization gains on the report day against its previous day", () => {
 const { bestMonthlyOptimizations } = require("../src/lib/seo-digest-recent-pages.ts");
 const row = (name, day, beforeClicks, afterClicks, change = "optimization") => ({ day, change, url: "https://flatkey.ai/blog/" + name, title: name,
  before: { date: "2026-11-15", property: "sc-domain:flatkey.ai", clicks: beforeClicks, impressions: beforeClicks * 10 },
  latest: { date: "2026-11-16", property: "sc-domain:flatkey.ai", clicks: afterClicks, impressions: afterClicks * 10 },
  beforeVisits: null, latestVisits: null });
 const date = "2026-11-17", report = buildSeoDigest({ ...base(date), notificationCompact: true, resolvedIssues: 2,
   priorities: [{ title: "approval-private-marker", reason: "pending", action: "review" }],
   recentPages: bestMonthlyOptimizations([
     row("updated", "2026-11-10", 4, 11),
     row("older-month-gain", "2026-10-25", 10, 30),
     row("outside-month", "2026-10-17", 0, 100),
     row("new-page", "2026-11-09", 0, 999, "new"),
     row("regression", "2026-11-09", 10, 0),
   ]) });
 assert.match(report.text, /当日优化效果.*2026-11-16.*已核实提升 2 个页面/);
 assert.match(report.text, /优化 \/blog\/updated · Google 点击 4 → \*\*11\*\*.*2026-11-15 → 2026-11-16/);
 assert.ok(report.text.indexOf("/blog/older-month-gain") < report.text.indexOf("/blog/updated"), "larger improvements stay first even when they were optimized earlier in the month");
 assert.match(report.text, /修复 \*\*2 个问题\*\*/);
 assert.doesNotMatch(report.text, /outside-month|new-page|regression|approval-private-marker|下一步/);
});

test("daily cards do not substitute older acquisition or funnel data for a missing report day", () => {
 const current={date:"2026-11-15",newUsers:124,newRegistrations:14};
 const previous={date:"2026-11-14",newUsers:101,newRegistrations:10};
 const points=[previous,current,{date:"2026-11-17",newUsers:null,newRegistrations:null}];
 const funnel={entrants:1,registrations:0,collectedAt:"2026-11-18T08:00:00Z",sources:["https://analytics.google.com/"]};
 const report=buildSeoDigest({...base("2026-11-18"),notificationCompact:true,dailyAcquisition:{points},pageGroups:{groups:[{key:"gpu_compute",points:[{date:"2026-11-14",totalUsers:1,pageViews:2,funnel,collectedAt:funnel.collectedAt},{date:"2026-11-15",totalUsers:null,pageViews:null,funnel:null}]}]}});
 assert.match(report.text,/GA4 新用户[^\n]*待更新/);
 assert.match(report.text,/GA4 去重注册[^\n]*待更新/);
 assert.doesNotMatch(report.text,/101 →|124|GPU 算力 ·|2026-11-14 → 2026-11-15/);
 assert.match(report.text,/当日页面组 0\/4/);
});

test('daily preview uses the latest closed LA day, ignores ongoing day, and retains missing values',()=>{
 const report=buildSeoDigest({...base('2026-11-19'),notificationCompact:true,dailyAcquisition:{points:[
 {date:'2026-11-16',newUsers:171,newRegistrations:11},
 {date:'2026-11-17',newUsers:138,newRegistrations:15},
 {date:'2026-11-18',newUsers:128,newRegistrations:2},
 {date:'2026-11-19',newUsers:999,newRegistrations:999}]}});
 assert.match(report.text,/GA4 去重注册（首次来源为自然搜索） 15 → \*\*2\*\*/);
 assert.match(report.text,/获客\/注册 2026-11-18/);
 assert.doesNotMatch(report.text,/999/);
 assert.match(report.text,/最新数据可能继续更新/);
});
