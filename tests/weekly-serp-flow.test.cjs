const assert=require("node:assert/strict"), {test}=require("node:test");
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
let mode="baseline",run=null,includes=[];
const model={keywordId:"flatkey",keyword:"flatkey",siteDomain:"flatkey.ai",targetUrls:["https://flatkey.ai/"]};
const saved=(rank,status="RANKED")=>({...model,status,rank,pages:rank?[{url:"https://flatkey.ai/",rankGroup:rank}]:[],captureComplete:status!=="PENDING",checkedAt:"2026-10-16T03:00:00Z"});
const original=Module._load;
Module._load=function(request,parent,main){
 if(request==="@/lib/prisma")return {prisma:{serpMonitorRun:{findUnique:async()=>run}}};
 if(request==="@/lib/services/serp-targets")return {loadSerpTargetCohort:async()=>({targets:[model]})};
 if(request==="@/lib/services/serp-results")return {loadSerpTasks:async(region,_lang,_device,_start,end,runId)=>{includes.push(runId);return mode==="baseline"&&end==="2026-10-13"?[]:[saved(mode==="missing"&&end==="2026-10-20"?null:region==="US"?3:9,mode==="missing"&&end==="2026-10-20"?"PENDING":"RANKED")];}};
 if(request==="@/lib/serp-results")return {buildSerpKeywordResults:(_targets,tasks)=>tasks};
 if(request.startsWith("@/"))return original.call(this,path.resolve(__dirname,"../src",request.slice(2)),parent,main);
 return original.call(this,request,parent,main);
};
const {loadWeeklySerp}=require("../src/lib/services/weekly-serp.ts");
const {reportPeriods,activeReportPeriods}=require("../src/lib/weekly-traffic.ts");
const {weeklyEvidenceSchema}=require("../src/lib/weekly-evidence-schema.ts");

test("Monday opens the report ending today without changing the closed-week import rule",()=>{
 assert.equal(activeReportPeriods(new Date("2026-10-19T03:00:00Z")).current.start,"2026-10-13");
 assert.equal(activeReportPeriods(new Date("2026-10-20T03:00:00Z")).current.start,"2026-10-13");
});
test("first SERP baseline deduplicates four markets and calls every actual ranked word new",async()=>{
 mode="baseline";run=null;const result=await loadWeeklySerp(reportPeriods("2026-10-13"));
 assert.equal(result.comparison.current,1);assert.equal(result.comparison.entered,1);assert.equal(result.comparison.previous,0);
 assert.equal(result.ranking.baseline,true);assert.equal(result.ranking.captureWeek,true);assert.equal(result.ranking.capturedKeywords,1);
});
test("a noncapture week reuses snapshots without claiming a new weekly check",async()=>{
 mode="reuse";const result=await loadWeeklySerp(reportPeriods("2026-10-20"));
 assert.equal(result.ranking.captureWeek,false);assert.equal(result.ranking.noNewCapture,true);assert.equal(result.ranking.status,"NOT_SCHEDULED");
});
test("unfinished runs wait, include their late receipts and never publish partial comparisons",async()=>{
 mode="reuse";run={id:"late-run",status:"RUNNING",cohortJson:[model]};includes=[];
 const result=await loadWeeklySerp(reportPeriods("2026-10-13"));assert.equal(result.ranking.waiting,true);assert.equal(result.comparison,null);assert.ok(includes.includes("late-run"));run=null;
});
test("missing captures do not turn the preceding week's actual rank into a confirmed loss",async()=>{
 mode="missing";const result=await loadWeeklySerp(reportPeriods("2026-10-13"));assert.equal(result.comparison,null);assert.equal(result.ranking.unresolvedWords,1);
});
test("saved channel and sequential funnel evidence passes validation, event-count substitutions do not",()=>{
 const archive=require("../src/lib/data/weekly-traffic-evidence.json");const data=archive.weeks["2026-10-06"];
 const {registrationCountries,...supported}=data;assert.equal(weeklyEvidenceSchema.safeParse(supported).success,true);
 const wrong=structuredClone(supported);wrong.channels[0].registrations.current+=10;
 assert.equal(weeklyEvidenceSchema.safeParse(wrong).success,false);
 const badFunnel=structuredClone(supported);badFunnel.newVisitorFunnel.current[1].users=999999;
 assert.equal(weeklyEvidenceSchema.safeParse(badFunnel).success,false);
});
