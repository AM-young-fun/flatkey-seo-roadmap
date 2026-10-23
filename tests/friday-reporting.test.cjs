const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
const root=path.resolve(__dirname,".."),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest);};
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {weeklyPeriods,reportPeriods,activeReportPeriods}=require("../src/lib/weekly-traffic.ts");
const {scheduledSerpDue,periodDue}=require("../src/lib/serp-periods.ts");
const {nextCollectorTime}=require("../src/lib/operations.ts");
const {weeklyPageVisitorsSchema,pageVisitorRows}=require("../src/lib/weekly-page-visitors.ts");
const {rankingImportSchema}=require("../src/lib/ranking-import.ts");
const {collectorRunSchema}=require("../src/lib/collector-runs.ts");
test("Friday reports cover Friday through Thursday at the Shanghai day boundary",()=>{
 assert.deepEqual(weeklyPeriods(new Date("2026-10-30T02:10:00Z")),{current:{start:"2026-10-23",end:"2026-10-29"},previous:{start:"2026-10-16",end:"2026-10-22"}});
 assert.equal(weeklyPeriods(new Date("2026-10-29T15:59:59Z")).current.end,"2026-10-22");
 assert.equal(weeklyPeriods(new Date("2026-10-29T16:00:00Z")).current.end,"2026-10-29");
 assert.equal(activeReportPeriods(new Date("2026-10-29T02:00Z")).current.start,"2026-10-23");
 assert.equal(reportPeriods("2026-10-13").current.end,"2026-10-19");
 assert.equal(nextCollectorTime(new Date("2026-10-30T02:09:59Z"),"traffic"),"2026-10-30T02:10:00.000Z");
 assert.equal(nextCollectorTime(new Date("2026-10-30T02:10:00Z"),"traffic"),"2026-11-06T02:10:00.000Z");
});
test("both old enabled cursors converge on Thursday without mutating historical paid slots",()=>{
 for(const cursor of ["2026-11-03T02:30:00Z","2026-11-02T16:00:00Z","2026-11-05T00:00:00Z"])assert.equal(scheduledSerpDue(cursor).toISOString(),"2026-11-05T00:00:00.000Z");
 assert.equal(periodDue("2026-10-20").toISOString(),"2026-10-20T02:30:00.000Z");
 assert.equal(periodDue("2026-11-17").toISOString(),"2026-11-19T00:00:00.000Z");
});
const pillars=()=>({metric:"totalUsers",eventName:"page_view",ruleVersion:2,sourceUrl:"https://analytics.google.com/analytics/web/",siteUsers:{current:200,previous:100},groups:[{key:"models",users:{current:120,previous:80}},{key:"prompts",users:{current:100,previous:30}}]});
test("each pillar share uses whole-site distinct users, allows overlap, and reports percentage points",()=>{
 const value=weeklyPageVisitorsSchema.parse(pillars()),rows=pageVisitorRows(value,true);
 assert.equal(rows[0].currentShare,.6);assert.equal(rows[1].currentShare,.5);
 assert.ok(Math.abs(rows[0].sharePoints+20)<1e-10);assert.equal(rows[1].sharePoints,20);
 const invalid=pillars();invalid.siteUsers.current=119;assert.equal(weeklyPageVisitorsSchema.safeParse(invalid).success,false);
 delete invalid.siteUsers;assert.equal(weeklyPageVisitorsSchema.safeParse(invalid).success,false);
 value.siteUsers.current=0;assert.ok(pageVisitorRows(value,true).every(row=>row.currentShare===null));
 const old={...pillars(),ruleVersion:1};delete old.siteUsers;assert.ok(pageVisitorRows(old,true).every(row=>row.currentShare===null));
});
test("Friday snapshot imports use Thursday endpoints and cannot publish before 10:10",t=>{
 t.mock.method(Date,"now",()=>Date.parse("2026-10-30T02:20Z"));
 const row={periodStart:"2026-10-23",periodEnd:"2026-10-29",timezone:"America/Los_Angeles",newUsers:10,newRegistrations:1,scope:"all_users",registrationMetric:"sign_up_success_distinct_users",ga4PropertyId:"541304395",collectedAt:"2026-10-30T02:12:00Z",analysis:{complete:true,reportingCutoff:{kind:"FRIDAY_1010_SNAPSHOT",scheduledAt:"2026-10-30T02:10:00Z"},pageVisitors:pillars(),totals:{current:{newUsers:10,newRegistrations:1},previous:{newUsers:20,newRegistrations:2}},channels:[{name:"Direct",newUsers:{current:10,previous:20},registrations:{current:1,previous:2}}],sources:["https://analytics.google.com/analytics/web/"]}};
 const batch=value=>({requestId:"friday-snapshot",targetDomain:"flatkey.ai",traffic:[value]});
 assert.equal(rankingImportSchema.safeParse(batch(row)).success,true);
 assert.equal(collectorRunSchema.safeParse({kind:"GA4",periodStart:"2026-10-23",status:"RUNNING"}).success,true);
 for(const mutate of [v=>v.collectedAt="2026-10-30T02:09:59Z",v=>v.analysis.reportingCutoff.kind="TUESDAY_1010_SNAPSHOT",v=>delete v.analysis.reportingCutoff]){const v=structuredClone(row);mutate(v);assert.equal(rankingImportSchema.safeParse(batch(v)).success,false);}
});
