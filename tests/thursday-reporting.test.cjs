const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
const root=path.resolve(__dirname,".."),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest);};
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {weeklyPeriods,reportPeriods,activeReportPeriods}=require("../src/lib/weekly-traffic.ts");
const {weeklySnapshotAt,comparableWeeklyCutoffs}=require("../src/lib/weekly-cutoff.ts");
const {rankingImportSchema}=require("../src/lib/ranking-import.ts");
const {collectorRunSchema}=require("../src/lib/collector-runs.ts");
const {weeklyReportDraftSchema}=require("../src/lib/weekly-report-draft.ts");
const {buildWeeklySeoTrafficReport}=require("../src/lib/weekly-seo-report.ts");

test("the new Thursday-Wednesday week closes at Los Angeles midnight, including DST",()=>{
 assert.equal(weeklyPeriods(new Date("2026-11-19T07:59:59Z")).current.end,"2026-11-12");
 assert.deepEqual(weeklyPeriods(new Date("2026-11-19T08:00:00Z")),{current:{start:"2026-11-12",end:"2026-11-18"},previous:{start:"2026-11-05",end:"2026-11-11"}});
 assert.equal(activeReportPeriods(new Date("2026-11-19T07:59:59Z")).current.end,"2026-11-12");
 assert.equal(activeReportPeriods(new Date("2026-11-19T08:00:00Z")).current.end,"2026-11-18");
 assert.equal(weeklyPeriods(new Date("2027-07-08T06:59:59Z")).current.end,"2027-06-30");
 assert.equal(weeklyPeriods(new Date("2027-07-08T07:00:00Z")).current.end,"2027-07-07");
 assert.equal(weeklySnapshotAt("2026-11-18"),"2026-11-19T08:30:00.000Z");
 assert.equal(weeklySnapshotAt("2027-07-07"),"2027-07-08T08:30:00.000Z");
 for(const start of ["2026-10-13","2026-11-06","2026-11-12"])assert.equal(reportPeriods(start).current.start,start);
 assert.equal(reportPeriods("2026-11-12").previous.start,"2026-11-05");
});
const analysis=()=>({complete:true,reportingCutoff:{kind:"THURSDAY_1630_SNAPSHOT",scheduledAt:"2026-11-19T08:30:00Z"},channelDimension:"firstUserPrimaryChannelGroup",totals:{current:{newUsers:10,newRegistrations:1},previous:{newUsers:20,newRegistrations:2}},channels:[{name:"Organic Search",newUsers:{current:10,previous:20},registrations:{current:1,previous:2}}],sources:["https://analytics.google.com/analytics/web/"]});
const row=()=>({periodStart:"2026-11-12",periodEnd:"2026-11-18",timezone:"America/Los_Angeles",newUsers:10,newRegistrations:1,scope:"all_users",registrationMetric:"sign_up_success_distinct_users",ga4PropertyId:"541304395",collectedAt:"2026-11-19T08:35:00Z",analysis:analysis()});
test("Thursday snapshots cannot bypass the property day closure or the 16:30 preparation time",t=>{
 t.mock.method(Date,"now",()=>Date.parse("2026-11-19T09:00:00Z"));
 const batch=value=>({requestId:"thursday-snapshot",targetDomain:"flatkey.ai",traffic:[value]});
 assert.equal(rankingImportSchema.safeParse(batch(row())).success,true);
 assert.equal(collectorRunSchema.safeParse({kind:"GA4",periodStart:"2026-11-12",status:"RUNNING"}).success,true);
 for(const mutate of [value=>value.collectedAt="2026-11-19T08:29:59Z",value=>value.collectedAt="2026-11-19T07:59:59Z",value=>value.timezone="Asia/Shanghai",value=>value.analysis.reportingCutoff.kind="FRIDAY_1010_SNAPSHOT",value=>value.analysis.reportingCutoff.scheduledAt="2026-11-19T02:10:00Z"]){const value=row();mutate(value);assert.equal(rankingImportSchema.safeParse(batch(value)).success,false);}
 const ordinary=row();delete ordinary.analysis.reportingCutoff;ordinary.collectedAt="2026-11-19T07:59:59Z";assert.equal(rankingImportSchema.safeParse(batch(ordinary)).success,false);
 const previous={reportingCutoff:{kind:"THURSDAY_1630_SNAPSHOT",scheduledAt:"2026-11-12T08:30:00Z"}};
 assert.equal(comparableWeeklyCutoffs(row().analysis,previous),true);
 assert.equal(comparableWeeklyCutoffs(row().analysis,{reportingCutoff:{kind:"FRIDAY_1010_SNAPSHOT",scheduledAt:"2026-11-12T08:30:00Z"}}),false);
});
test("an unfinished Thursday draft compares only completed matching weekdays",t=>{
 t.mock.method(Date,"now",()=>Date.parse("2026-11-18T10:00:00Z"));
 const input={kind:"weekly-report-draft",siteDomain:"flatkey.ai",periodStart:"2026-11-12",periodEnd:"2026-11-18",timezone:"America/Los_Angeles",ga4PropertyId:"541304395",collectedAt:"2026-11-18T09:00:00Z",stageTotals:{newUsers:10,newRegistrations:1,collectedAt:"2026-11-18T09:00:00Z"},comparisonPeriods:{current:{start:"2026-11-12",end:"2026-11-17"},previous:{start:"2026-11-05",end:"2026-11-10"}},evidence:analysis(),findings:[],otherSites:[]};
 delete input.evidence.reportingCutoff;
 assert.equal(weeklyReportDraftSchema.safeParse(input).success,true);
 input.comparisonPeriods.previous={start:"2026-11-06",end:"2026-11-11"};assert.equal(weeklyReportDraftSchema.safeParse(input).success,false);
});
test("legacy Tuesday and Friday records cannot supply either week of the new report",()=>{
 const legacy=["2026-11-06","2026-11-10"].map(start=>({...row(),siteDomain:"flatkey.ai",periodStart:new Date(start),periodEnd:new Date(reportPeriods(start).current.end),collectedAt:new Date("2026-11-19T08:35:00Z")}));
 const result=buildWeeklySeoTrafficReport(legacy,reportPeriods("2026-11-12"));
 assert.equal(result.traffic.current,null);assert.equal(result.traffic.previous,null);assert.equal(result.traffic.comparable,false);
});
