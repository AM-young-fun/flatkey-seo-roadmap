const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const mock = (relative, exports) => { const file = path.join(root, relative); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
let rows = [];
mock("src/lib/prisma.ts", { prisma: { weeklyTraffic: { findMany: async () => rows }, weeklyReportDraft: { findUnique: async () => null } } });
mock("src/lib/database-read.ts", { settleReads: promises => Promise.all(promises) });
mock("src/lib/read-profile.ts", { timedRead: (_, read) => read() });
mock("src/lib/services/weekly-serp.ts", { loadWeeklySerp: async () => ({ ranking: { baseline: true }, comparison: null }) });
mock("src/lib/weekly-report-diagnosis.ts", { diagnoseWeeklyReport: async () => ({ significant: false, findings: [] }) });
const { reportPeriods } = require("../src/lib/weekly-traffic.ts");
const { buildWeeklyReport } = require("../src/lib/services/weekly-report.ts");
const { rankingImportSchema } = require("../src/lib/ranking-import.ts");
const pageVisitors = { metric: "totalUsers", eventName: "page_view", ruleVersion: 1, sourceUrl: "https://analytics.google.com/analytics/web/", groups: [{ key: "models", users: { current: 60, previous: null } }, { key: "prompts", users: { current: 20, previous: null } }] };
const current = () => ({ siteDomain: "flatkey.ai", periodStart: new Date("2026-10-23"), periodEnd: new Date("2026-10-29"), collectedAt: new Date("2026-10-30T02:15:00Z"), newUsers: 50, newRegistrations: 5, timezone: "America/Los_Angeles", ga4PropertyId: "541304395", registrationMetric: "sign_up_success_distinct_users", analysis: { complete: true, totals: { current: { newUsers: 50, newRegistrations: 5 }, previous: { newUsers: 40, newRegistrations: 4 } }, channels: [{ name: "Organic Search", newUsers: { current: 20, previous: 10 }, registrations: { current: 2, previous: 1 } }, { name: "Direct", newUsers: { current: 30, previous: 30 }, registrations: { current: 3, previous: 3 } }], sources: ["https://analytics.google.com/analytics/web/"], pageVisitors } });
const previous = () => ({...current(), periodStart:new Date("2026-10-16"),periodEnd:new Date("2026-10-22"),collectedAt:new Date("2026-10-23T02:15:00Z"),newUsers:40,newRegistrations:4,analysis:{...current().analysis,totals:{current:{newUsers:40,newRegistrations:4},previous:{newUsers:30,newRegistrations:3}},channels:[{name:"Organic Search",newUsers:{current:10,previous:5},registrations:{current:1,previous:1}},{name:"Direct",newUsers:{current:30,previous:25},registrations:{current:3,previous:2}}]}});

test("the SEO report projects organic totals and hides unscoped page, funnel, draft and Codex evidence", async () => {
  const input=current();input.analysis.codexSummary={preparedAt:"2026-10-30T02:15:00Z",text:"广告增长带来注册",findings:[{title:"付费搜索增长",evidence:"全渠道结论",action:"继续投放",level:"finding"}]};
  input.analysis.newVisitorFunnel={current:[{name:"first_visit",users:50,completionRate:.1},{name:"sign_up_success",users:5,completionRate:null}],previous:[{name:"first_visit",users:40,completionRate:.1},{name:"sign_up_success",users:4,completionRate:null}]};
  rows = [input];
  const original=structuredClone(input);
  const report = await buildWeeklyReport(reportPeriods("2026-10-23"));
  assert.equal(report.traffic.current.newUsers,20);assert.equal(report.traffic.current.newRegistrations,2);
  assert.equal(report.traffic.previous.newUsers,10);assert.equal(report.traffic.trafficScope,"organic_search");
  assert.equal(report.evidence.codexSummary,undefined);assert.equal(report.evidence.newVisitorFunnel,undefined);
  assert.equal(report.pageVisitors,null);assert.deepEqual(report.pageTrafficHistory,[]);assert.equal(report.draft,null);
  assert.doesNotMatch(JSON.stringify(report.diagnosis),/广告|付费|直接访问/);
  assert.deepEqual(input,original);
});

test("page visitors require explicit matching SEO scope, and invalid raw totals never become SEO totals",async()=>{
 const input=current();input.analysis.trafficScope="organic_search";input.analysis.channels=input.analysis.channels.slice(0,1);
 input.analysis.totals={current:{newUsers:20,newRegistrations:2},previous:{newUsers:10,newRegistrations:1}};
 input.newUsers=20;input.newRegistrations=2;rows=[input];
 let report=await buildWeeklyReport(reportPeriods("2026-10-23"));assert.deepEqual(report.pageVisitors,pageVisitors);
 input.newUsers=21;report=await buildWeeklyReport(reportPeriods("2026-10-23"));assert.equal(report.pageVisitors,null);assert.equal(report.traffic.current,null);
});

test("Friday snapshots keep their cutoff and do not compare against complete weeks or unverified prior snapshots",async()=>{
 const input=current(),prior=previous();input.analysis.reportingCutoff={kind:"FRIDAY_1010_SNAPSHOT",scheduledAt:"2026-10-30T02:10:00Z"};rows=[input,prior];
 let report=await buildWeeklyReport(reportPeriods("2026-10-23"));
 assert.equal(report.traffic.comparable,false);assert.equal(report.traffic.changes.newUsers,null);assert.equal(report.reportingCutoff.comparable,false);
 prior.analysis.reportingCutoff={kind:"FRIDAY_1010_SNAPSHOT",scheduledAt:"2026-10-23T02:10:00Z"};
 report=await buildWeeklyReport(reportPeriods("2026-10-23"));
 assert.equal(report.traffic.comparable,true);assert.equal(report.reportingCutoff.comparable,true);assert.equal(report.traffic.changes.newUsers,1);
 rows=[input];report=await buildWeeklyReport(reportPeriods("2026-10-23"));assert.equal(report.traffic.comparable,false);assert.equal(report.evidence,null);
});

test("the original weekly import cannot save a filtered organic total labelled as all_users",()=>{
 const input=current();input.analysis.trafficScope="organic_search";input.analysis.channels=input.analysis.channels.slice(0,1);
 input.analysis.totals={current:{newUsers:20,newRegistrations:2},previous:{newUsers:10,newRegistrations:1}};
 const payload={requestId:"weekly-organic-parent-guard-test",targetDomain:"flatkey.ai",traffic:[{periodStart:"2026-10-23",periodEnd:"2026-10-29",timezone:input.timezone,newUsers:20,newRegistrations:2,scope:"all_users",ga4PropertyId:input.ga4PropertyId,registrationMetric:input.registrationMetric,collectedAt:"2026-10-31T12:00:00Z",analysis:input.analysis}]};
 assert.equal(rankingImportSchema.safeParse(payload).success,false);
 payload.traffic[0]={...payload.traffic[0],newUsers:50,newRegistrations:5,analysis:current().analysis};
 assert.equal(rankingImportSchema.safeParse(payload).success,true);
});
