const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
const resolve=Module._resolveFilename,root=path.resolve(__dirname,"..");
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest);};
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {weeklySnapshotAt,comparableWeeklyCutoffs}=require("../src/lib/weekly-cutoff.ts");
const {rankingImportSchema}=require("../src/lib/ranking-import.ts");
const cutoff=scheduledAt=>({reportingCutoff:{kind:"TUESDAY_1010_SNAPSHOT",scheduledAt}});

test("the Tuesday 10:10 Shanghai snapshot has a fixed UTC cutoff through Los Angeles DST changes",()=>{
 assert.equal(weeklySnapshotAt("2026-10-26"),"2026-10-27T02:10:00.000Z");
 assert.equal(weeklySnapshotAt("2026-11-02"),"2026-11-03T02:10:00.000Z");
 assert.equal(comparableWeeklyCutoffs({},{}),true);
 assert.equal(comparableWeeklyCutoffs(cutoff(weeklySnapshotAt("2026-11-02")),cutoff(weeklySnapshotAt("2026-10-26"))),true);
 assert.equal(comparableWeeklyCutoffs(cutoff(weeklySnapshotAt("2026-11-02")),{}),false);
 assert.equal(comparableWeeklyCutoffs({},cutoff(weeklySnapshotAt("2026-11-02"))),false);
 assert.equal(comparableWeeklyCutoffs(cutoff(weeklySnapshotAt("2026-11-02")),cutoff(weeklySnapshotAt("2026-11-02"))),false);
});

test("explicit Tuesday-morning reports can publish before the property week closes, without relaxing ordinary imports",t=>{
 t.mock.method(Date,"now",()=>Date.parse("2026-10-27T02:20:00Z"));
 const row={periodStart:"2026-10-20",periodEnd:"2026-10-26",timezone:"America/Los_Angeles",newUsers:10,newRegistrations:1,scope:"all_users",registrationMetric:"sign_up_success_distinct_users",ga4PropertyId:"541304395",collectedAt:"2026-10-27T02:12:00Z",analysis:{complete:true,...cutoff(weeklySnapshotAt("2026-10-26")),totals:{current:{newUsers:10,newRegistrations:1},previous:{newUsers:20,newRegistrations:2}},channels:[{name:"Direct",newUsers:{current:10,previous:20},registrations:{current:1,previous:2}}],sources:["https://analytics.google.com/analytics/web/"]}};
 const batch=value=>({requestId:"weekly-snapshot",targetDomain:"flatkey.ai",traffic:[value]});
 assert.equal(rankingImportSchema.safeParse(batch(row)).success,true);
 const unmarked=structuredClone(row);delete unmarked.analysis.reportingCutoff;
 assert.equal(rankingImportSchema.safeParse(batch(unmarked)).success,false);
 for(const change of [value=>value.collectedAt="2026-10-27T02:09:59Z",value=>value.analysis.reportingCutoff.scheduledAt="2026-10-27T01:00:00Z",value=>value.periodEnd="2026-11-02",value=>value.collectedAt="2026-10-27T03:00:00Z"]){const invalid=structuredClone(row);change(invalid);assert.equal(rankingImportSchema.safeParse(batch(invalid)).success,false);}
});
