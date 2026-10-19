const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
require.extensions[".ts"] = (module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {keywordCyclePlan,discoveryPageMatches}=require("../src/lib/keyword-cycle.ts");
const {buildRankedKeywordsTask,normalizeRankedKeywords}=require("../src/lib/dataforseo-labs.cjs");

test("the discovery cycle binds twelve independent markets and never starts on an intervening week",()=>{
 const plan=keywordCyclePlan(new Date("2026-10-20T02:30:00Z"));
 assert.equal(plan.mayStart,true);assert.equal(plan.jobs.length,12);assert.equal(plan.maxDiscoveryCostMicros,1584000);
 assert.equal(new Set(plan.jobs.map(job=>job.requestId)).size,12);
 for(const job of plan.jobs){assert.equal(job.task.target,job.targetDomain);assert.equal(job.task.include_clickstream_data,false);assert.equal(job.task.offset,0);}
 assert.equal(keywordCyclePlan(new Date("2026-10-27T02:30:00Z")).mayStart,false);
 assert.equal(keywordCyclePlan(new Date("2026-10-20T02:29:59Z")).mayStart,false);
 assert.equal(keywordCyclePlan(new Date("2026-11-03T02:30:00Z")).mayStart,true);
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

let runs=[], fetches=0, failTransport=false;
const connection={scheduleEnabled:true,connectionVersion:1,encryptedCredentials:"test-only"};
const db={
 $executeRaw:async()=>0,$transaction:async fn=>fn(db),siteKeyword:{findMany:async()=>[]},
 dataForSeoConnection:{findUnique:async()=>connection},
 dataForSeoRun:{
 findFirst:async()=>null,
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
const {runKeywordDiscoveryCycle}=require("../src/lib/services/keyword-cycle.ts");

test("disabled discovery never reads credentials or calls the paid provider",async()=>{
 delete process.env.DATAFORSEO_DISCOVERY_PAID_ENABLED;
 const result=await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});
 assert.equal(result.status,"DISABLED");assert.equal(result.paidRequests,0);assert.equal(runs.length,0);
});

test("a twelve-market cycle records each POST once and an uncertain response never resubmits",async()=>{
 const originalFetch=global.fetch;process.env.DATAFORSEO_DISCOVERY_PAID_ENABLED="true";
 global.fetch=async(_url,options)=>{
  fetches++;if(failTransport)throw Error("lost response");const task=JSON.parse(options.body)[0];
  return new Response(JSON.stringify({status_code:20000,tasks_error:0,tasks_count:1,cost:.012,tasks:[{status_code:20000,result:[{target:task.target,location_code:task.location_code,language_code:task.language_code,items:[],items_count:0,total_count:0}]}]}));
 };
 try{
  for(let i=0;i<12;i++)await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});
  const complete=await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});
  assert.equal(complete.ready,true);assert.equal(fetches,12);assert.ok(runs.every(row=>row.status==="COMPLETED"));
  await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});assert.equal(fetches,12);
  runs=[];fetches=0;failTransport=true;
  const first=await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});
  const retry=await runKeywordDiscoveryCycle({now:new Date("2026-10-20T02:30:00Z")});
  assert.equal(first.status,"NEEDS_REVIEW");assert.equal(retry.status,"NEEDS_REVIEW");assert.equal(fetches,1);assert.equal(runs[0].status,"UNKNOWN");
 }finally{global.fetch=originalFetch;delete process.env.DATAFORSEO_DISCOVERY_PAID_ENABLED;}
});
