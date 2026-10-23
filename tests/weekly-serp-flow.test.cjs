const assert=require("node:assert/strict"), {test}=require("node:test");
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
let mode="baseline",run=null,includes=[],firstRun=null,firstLookup=[];
const model={keywordId:"flatkey",keyword:"flatkey",siteDomain:"flatkey.ai",targetUrls:["https://flatkey.ai/"]};
const saved=(rank,status="RANKED")=>({...model,status,rank,pages:rank?[{url:"https://flatkey.ai/",rankGroup:rank}]:[],captureComplete:status!=="PENDING",checkedAt:"2026-10-16T03:00:00Z"});
const original=Module._load;
Module._load=function(request,parent,main){
 if(request==="@/lib/prisma")return {prisma:{serpMonitorRun:{findUnique:async()=>run,findFirst:async(query)=>{firstLookup.push(query);return firstRun;}}}};
 if(request==="@/lib/services/serp-targets")return {loadSerpTargetCohort:async()=>({targets:[model]})};
 if(request==="@/lib/services/serp-results")return {loadSerpTasks:async(region,_lang,_device,_start,end,runId)=>{includes.push(runId);
   if(mode==="first-fallback") {
     if(end==="2026-10-13")return [];
     if(runId===firstRun.id)return [{...saved(3),runId:firstRun.id,region:"US"},{...saved(1),runId:"unrelated-run",keyword:"must not leak",region:"US"}];
     return [{...saved(101,"OUTSIDE_TOP100"),runId:run.id,region:"US"},{...saved(7),keyword:"newly checked word",runId:run.id,region:"US"}];
   }
   return mode==="baseline"&&end==="2026-10-13"?[]:(region==="all"?["US","JP","ES","BR"]:[region]).map(market=>({...saved(mode==="missing"&&end==="2026-10-20"?null:market==="US"?3:9,mode==="missing"&&end==="2026-10-20"?"PENDING":"RANKED"),region:market}));}};
 if(request==="@/lib/serp-results")return {buildSerpKeywordResults:(_targets,tasks)=>tasks,serpTaskPeriod:()=>({label:"2026年10月第1期"})};
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
test("missing previous week uses the first completed issue without mixing other runs or inventing a zero baseline",async()=>{
 mode="first-fallback";firstLookup=[];
 run={id:"current-run",status:"COMPLETED",createdAt:new Date("2026-10-19T07:43:00Z"),cohortJson:[model]};
 firstRun={id:"first-run",periodStart:new Date("2026-10-16"),periodLabel:"old immutable label",cohortJson:[model]};
 const result=await loadWeeklySerp(reportPeriods("2026-10-13"));
 assert.equal(result.ranking.baseline,false);assert.equal(result.comparison.previous,1);assert.equal(result.comparison.current,1);
 assert.equal(result.comparison.entered,1);assert.equal(result.comparison.removed,1);assert.equal(result.comparison.net,0);
 assert.deepEqual(result.ranking.comparisonReference,{kind:"FIRST_ISSUE",label:"2026年10月第1期",checkedAt:"2026-10-16T03:00:00Z",capturedKeywords:1});
 assert.equal(firstLookup[0].where.id.not,"current-run");assert.equal(firstLookup[0].where.createdAt.lt,run.createdAt);
 assert.equal(firstLookup[0].where.status,"COMPLETED");
 run=null;firstRun=null;mode="baseline";
});
test("saved channel and sequential funnel evidence passes validation, event-count substitutions do not",()=>{
 const archive=require("../src/lib/data/weekly-traffic-evidence.json");const data=archive.weeks["2026-10-06"];
 const supported={...data};delete supported.registrationCountries;assert.equal(weeklyEvidenceSchema.safeParse(supported).success,true);
 const wrong=structuredClone(supported);wrong.channels[0].registrations.current+=10;
 assert.equal(weeklyEvidenceSchema.safeParse(wrong).success,false);
 const badFunnel=structuredClone(supported);badFunnel.newVisitorFunnel.current[1].users=999999;
 assert.equal(weeklyEvidenceSchema.safeParse(badFunnel).success,false);
});

test("Friday reports include the Thursday capture and intervening Fridays retain its date",async()=>{
 mode="reuse";run={id:"thursday-run",status:"RUNNING",cohortJson:[model]};
 let result=await loadWeeklySerp(reportPeriods("2026-10-30"));
 assert.equal(result.ranking.captureWeek,true);assert.equal(result.ranking.waiting,true);assert.equal(result.ranking.nextCaptureAt,"2026-11-05T00:00:00.000Z");
 run=null;result=await loadWeeklySerp(reportPeriods("2026-11-06"));
 assert.equal(result.ranking.captureWeek,false);assert.equal(result.ranking.status,"NOT_SCHEDULED");assert.equal(result.ranking.nextCaptureAt,"2026-11-19T00:00:00.000Z");
});
