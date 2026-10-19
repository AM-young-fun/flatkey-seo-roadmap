const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),ts=require("typescript");
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {weeklyReportDraftSchema}=require("../src/lib/weekly-report-draft.ts");
const {auditedWeeklyDiagnosis}=require("../src/lib/weekly-audit-diagnosis.ts");
const sample=()=>({kind:"weekly-report-draft",siteDomain:"flatkey.ai",periodStart:"2026-10-13",periodEnd:"2026-10-19",timezone:"America/Los_Angeles",ga4PropertyId:"541304395",collectedAt:"2026-10-19T04:50:00Z",
 stageTotals:{newUsers:110,newRegistrations:12,collectedAt:"2026-10-19T04:40:00Z"},comparisonPeriods:{current:{start:"2026-10-13",end:"2026-10-17"},previous:{start:"2026-10-06",end:"2026-10-10"}},
 evidence:{complete:true,totals:{current:{newUsers:100,newRegistrations:10},previous:{newUsers:80,newRegistrations:12}},channels:[{name:"Direct",newUsers:{current:100,previous:80},registrations:{current:10,previous:12}}],sources:["https://analytics.google.com/analytics/web/"]},findings:[],otherSites:[]});
test("a partial week can carry a completed same-weekday window without becoming a final weekly import",()=>{
 const d=weeklyReportDraftSchema.parse(sample());assert.equal(d.kind,"weekly-report-draft");assert.equal(d.periodEnd,"2026-10-19");assert.equal(d.comparisonPeriods.current.end,"2026-10-17");
});
test("unfinished, mismatched and shifted comparison days are rejected",()=>{
 for(const change of [d=>d.comparisonPeriods.current.end="2026-10-19",d=>d.comparisonPeriods.previous.end="2026-10-11",d=>{d.comparisonPeriods.previous.start="2026-10-07";d.comparisonPeriods.previous.end="2026-10-11";}]){const d=sample();change(d);assert.equal(weeklyReportDraftSchema.safeParse(d).success,false);}
});
test("stage totals cannot undercut the completed subwindow, and channel users must reconcile",()=>{
 const d=sample();d.stageTotals.newUsers=99;assert.equal(weeklyReportDraftSchema.safeParse(d).success,false);
 const e=sample();e.evidence.channels[0].registrations.current=11;assert.equal(weeklyReportDraftSchema.safeParse(e).success,false);
});
test("period evidence never reuses the prior week's China or search-growth conclusion",()=>{
 const e=sample().evidence;e.directRegistrationCountries={China:{current:8,previous:3},Brazil:{current:1,previous:7}};
 e.search={clicks:{current:5,previous:20},impressions:{current:50,previous:90},decliningPages:[]};
 const result=auditedWeeklyDiagnosis(e);assert.ok(result.findings.some(row=>row.evidence.startsWith("巴西直接访问")));assert.ok(result.findings.some(row=>row.title==="Google 自然搜索点击下降"));assert.ok(result.findings.every(row=>!row.title.includes("点击未下降")));
});
