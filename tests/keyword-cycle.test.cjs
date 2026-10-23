const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
require.extensions[".ts"] = (module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {keywordCyclePlan,discoveryPageMatches}=require("../src/lib/keyword-cycle.ts");
const {buildRankedKeywordsTask,normalizeRankedKeywords}=require("../src/lib/dataforseo-labs.cjs");

test("the discovery cycle binds four Flatkey markets and never starts on an intervening week",()=>{
 const plan=keywordCyclePlan(new Date("2026-10-20T02:30:00Z"));
 assert.equal(plan.mayStart,true);assert.equal(plan.jobs.length,4);assert.equal(plan.maxDiscoveryCostMicros,528000);
 assert.equal(new Set(plan.jobs.map(job=>job.requestId)).size,4);
 for(const job of plan.jobs){assert.equal(job.targetDomain,"flatkey.ai");assert.equal(job.task.target,job.targetDomain);assert.equal(job.task.include_clickstream_data,false);assert.equal(job.task.offset,0);}
 assert.equal(keywordCyclePlan(new Date("2026-10-27T02:30:00Z")).mayStart,false);
 assert.equal(keywordCyclePlan(new Date("2026-10-20T02:29:59Z")).mayStart,false);
 assert.equal(keywordCyclePlan(new Date("2026-11-03T02:30:00Z")).mayStart,false);
 assert.throws(()=>buildRankedKeywordsTask(1000,"test",{targetDomain:"evil.example",region:"US"}));
});

test("historical foreign-market results are rejected and business intent must match current page content",()=>{
 assert.equal(discoveryPageMatches("flatkey.ai","yes","yes","yes"),false);
 assert.equal(discoveryPageMatches("flatkey.ai","deepseek api pricing","DeepSeek API Pricing",""),true);
 assert.equal(discoveryPageMatches("flatkey.ai","deepseek api pricing","Gemini API Pricing",""),false);
 const raw={status_code:20000,tasks_error:0,tasks_count:1,cost:.012,tasks:[{status_code:20000,result:[{target:"rackrate.org",location_code:2392,language_code:"ja",items:[],items_count:0,total_count:0}]}]};
 const parsed=normalizeRankedKeywords(raw,{runId:"market-test",collectedAt:"2026-10-19T03:00:00Z",scope:{targetDomain:"rackrate.org",region:"JP"}});
 assert.equal(parsed.region,"JP");assert.equal(parsed.targetDomain,"rackrate.org");assert.equal(parsed.realTimeSerpFetch,false);
 assert.throws(()=>normalizeRankedKeywords(raw,{runId:"market-test",collectedAt:"2026-10-19T03:00:00Z"}));
});
test("the next discovery cycle starts at Thursday 08:00 with unchanged four-market request IDs",()=>{
 assert.equal(keywordCyclePlan(new Date("2026-11-04T23:59:59Z")).mayStart,false);
 const plan=keywordCyclePlan(new Date("2026-11-05T00:00:00Z"));
 assert.equal(plan.mayStart,true);assert.equal(plan.period.key,"2026-11-03");
 assert.equal(plan.period.dueAt,"2026-11-05T00:00:00.000Z");
 assert.ok(plan.jobs.every(job=>job.requestId.startsWith("discovery-2026-11-03-flatkey-ai-")));
 assert.equal(keywordCyclePlan(new Date("2026-11-09T16:00:00Z")).mayStart,false);
});

let runs=[], fetches=0, failTransport=false, scheduleEnabled=false;
const connection={scheduleEnabled:true,connectionVersion:1,encryptedCredentials:"test-only"};
const db={
 $executeRaw:async()=>0,$transaction:async fn=>fn(db),siteKeyword:{findMany:async()=>[]},
 dataForSeoConnection:{findUnique:async()=>connection},
 serpMonitorConfig:{findUnique:async()=>({paidEnabled:scheduleEnabled,authorizationVersion:1,nextDueAt:new Date("2026-10-20T02:30:00Z")})},
 dataForSeoRun:{
 findFirst:async({where})=>where.requestId.in ? runs.find(row=>where.requestId.in.includes(row.requestId))??null : null,
 findMany:async({where})=>runs.filter(row=>where.requestId.in.includes(row.requestId)),
 findUnique:async({where})=>runs.find(row=>row.requestId===where.requestId)??null,
 findUniqueOrThrow:async({where})=>{const row=runs.find(row=>row.requestId===where.requestId);if(!row)throw Error("missing");return row;},
 aggregate:async()=>({_sum:{budgetCostMicros:runs.reduce((sum,row)=>sum+row.budgetCostMicros,0)}}),
 create:async({data})=>{const row={...data,importedBatches:0,createdAt:new Date()};runs.push(row);return row;},
 update:async({where,data})=>{const row=runs.find(row=>row.requestId===where.requestId);Object.assign(row,data);return row;},
 },
};
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
 if(request==="@/lib/prisma")return {prisma:db};
 if(request==="@/lib/dataforseo-credentials")return {decryptDataForSeoCredentials:()=>({apiLogin:"fixture",apiPassword:"fixture"})};
 if(request==="@/lib/services/seo-import")return {importSeo:async()=>({imported:0})};
 if(request.startsWith("@/"))return originalLoad.call(this,path.resolve(__dirname,"../src",request.slice(2)),parent,isMain);
 return originalLoad.call(this,request,parent,isMain);
};
const {runKeywordDiscoveryCycle,replayDiscoveryRun,inspectDiscoveryRun}=require("../src/lib/services/keyword-cycle.ts");

test("disabled discovery never reads credentials or calls the paid provider",async()=>{
 delete process.env.DATAFORSEO_DISCOVERY_PAID_ENABLED;
 const result=await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});
 assert.equal(result.status,"DISABLED");assert.equal(result.paidRequests,0);assert.equal(runs.length,0);
});

test("a Flatkey four-market cycle records each POST once and an uncertain response never resubmits",async()=>{
 const originalFetch=global.fetch;scheduleEnabled=true;
 global.fetch=async(_url,options)=>{
  fetches++;if(failTransport)throw Error("lost response");const task=JSON.parse(options.body)[0];
  return new Response(JSON.stringify({status_code:20000,tasks_error:0,tasks_count:1,cost:.012,tasks:[{status_code:20000,result:[{target:task.target,location_code:task.location_code,language_code:task.language_code,items:[],items_count:0,total_count:0}]}]}));
 };
 try{
  for(let i=0;i<4;i++)await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});
  const complete=await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});
  assert.equal(complete.ready,true);assert.equal(fetches,4);assert.ok(runs.every(row=>row.status==="COMPLETED"));
  await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});assert.equal(fetches,4);
  runs=[];fetches=0;failTransport=true;
  const first=await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});
  const retry=await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});
  assert.equal(first.status,"NEEDS_REVIEW");assert.equal(retry.status,"NEEDS_REVIEW");assert.equal(fetches,1);assert.equal(runs[0].status,"UNKNOWN");
 }finally{global.fetch=originalFetch;scheduleEnabled=false;}
});

test("the server continues an already advanced cycle after the browser closes, but never advances a merely enabled schedule",async()=>{
 const originalFetch=global.fetch;scheduleEnabled=true;runs=[];fetches=0;failTransport=false;
 global.fetch=async(_url,options)=>{
  fetches++;const task=JSON.parse(options.body)[0];
  return new Response(JSON.stringify({status_code:20000,tasks_error:0,tasks_count:1,cost:.012,tasks:[{status_code:20000,result:[{target:task.target,location_code:task.location_code,language_code:task.language_code,items:[],items_count:0,total_count:0}]}]}));
 };
 const now=new Date("2026-10-19T12:00:00Z");
 try{
  assert.equal((await runKeywordDiscoveryCycle({now})).status,"NOT_DUE");assert.equal(fetches,0);
  await runKeywordDiscoveryCycle({now,periodKey:"2026-10-20"});assert.equal(fetches,1);
  const resumed=await runKeywordDiscoveryCycle({now});assert.equal(fetches,2);assert.equal(resumed.periodKey,"2026-10-20");
  assert.ok(runs.every(row=>row.requestId.startsWith("discovery-2026-10-20-")));
  scheduleEnabled=false;assert.equal((await runKeywordDiscoveryCycle({now})).status,"DISABLED");assert.equal(fetches,2);
 }finally{global.fetch=originalFetch;scheduleEnabled=false;}
});

test("a cached discovery import can be diagnosed and repaired without a second paid request",async()=>{
 const job=keywordCyclePlan(new Date("2026-10-20T02:30:00Z")).jobs[2], originalFetch=global.fetch;
 let requests=0;
 global.fetch=async()=>{requests++;throw Error("cached replay must not fetch a provider");};
 const receipt=(location,language)=>JSON.stringify({status_code:20000,tasks_error:0,tasks_count:1,cost:.012,tasks:[{status_code:20000,result:[{target:job.targetDomain,location_code:location,language_code:language,items:[],items_count:0,total_count:0}]}]});
 const row={requestId:job.requestId,status:"IMPORT_FAILED",siteDomain:job.targetDomain,rawResponse:receipt(2392,"ja"),collectedAt:new Date("2026-10-19T07:00:00Z"),importedBatches:0,importPayload:null,normalized:null,budgetCostMicros:132000};runs=[row];
 try{
  const invalid=await replayDiscoveryRun(job.requestId);assert.equal(invalid.status,"IMPORT_FAILED");assert.match(invalid.errorCode,/^DISCOVERY_/);
  row.rawResponse=receipt(2724,"es");
  const fixed=await replayDiscoveryRun(job.requestId);assert.equal(fixed.status,"COMPLETED");assert.equal(fixed.errorCode,null);assert.equal(fixed.hasNormalizedResult,true);assert.equal(requests,0);
  const details=JSON.stringify(await inspectDiscoveryRun(job.requestId));
  for(const secret of ["rawResponse","encryptedCredentials","apiPassword"])assert.ok(!details.includes(secret));
 }finally{global.fetch=originalFetch;}
});
test("server discovery normalizes an existing future 10:30 cursor and never resubmits its midnight markets",async t=>{
 scheduleEnabled=true;runs=[];fetches=0;
 t.mock.method(db.serpMonitorConfig,"findUnique",async()=>({paidEnabled:true,authorizationVersion:1,nextDueAt:new Date("2026-11-03T02:30:00Z")}));
 t.mock.method(global,"fetch",async(_url,options)=>{
  fetches++;const task=JSON.parse(options.body)[0];
  return new Response(JSON.stringify({status_code:20000,tasks_error:0,tasks_count:1,cost:.012,tasks:[{status_code:20000,result:[{target:task.target,location_code:task.location_code,language_code:task.language_code,items:[],items_count:0,total_count:0}]}]}));
 });
 const early=await runKeywordDiscoveryCycle({now:new Date("2026-11-04T23:59:59Z")});
 assert.equal(early.status,"NOT_DUE");assert.equal(fetches,0);
 for(let index=0;index<4;index++)await runKeywordDiscoveryCycle({now:new Date("2026-11-05T00:00:00Z")});
 assert.equal(fetches,4);assert.ok(runs.every(row=>row.requestId.startsWith("discovery-2026-11-03-")));
 assert.equal((await runKeywordDiscoveryCycle({now:new Date("2026-11-05T02:30:00Z")})).ready,true);assert.equal(fetches,4);
 scheduleEnabled=false;
});
