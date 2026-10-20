const assert=require("node:assert/strict"),{test,beforeEach}=require("node:test"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
const root=path.resolve(__dirname,".."),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest);};
require.extensions[".ts"]=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const mock=(relative,exports)=>{const filename=path.join(root,relative);require.cache[filename]={id:filename,filename,loaded:true,exports};};
let job,config,report,updates,providerCalls,imports,ranking;
const db={projectAutomation:{upsert:async()=>config,findUnique:async()=>config,update:async()=>{throw new Error("unexpected mutation");}},projectJob:{createMany:async()=>({count:0}),updateMany:async input=>{updates.push(input);return {count:1};},findFirst:async()=>job},$queryRaw:async()=>[job],weeklyTraffic:{findFirst:async()=>report},serpMonitorConfig:{findUnique:async()=>({paidEnabled:true})},serpMonitorRun:{findUnique:async()=>ranking}};
mock("src/lib/prisma.ts",{prisma:db});
mock("src/lib/services/display-change.ts",{displayDataChanged:async()=>{}});
mock("src/lib/services/seo-import.ts",{importSeo:async()=>{imports++;}});
const ga4=require("../src/lib/ga4-collector.ts");
mock("src/lib/ga4-collector.ts",{...ga4,ga4Client:async()=>{providerCalls++;throw new Error("unexpected provider request");}});
const service=require("../src/lib/services/project-jobs.ts");
const {GET:cron}=require("../src/app/api/cron/project-jobs/route.ts");
const {POST:worker}=require("../src/app/api/automation/worker/route.ts");
const completedAnalysis={complete:true,totals:{current:{newUsers:100,newRegistrations:20},previous:{newUsers:80,newRegistrations:15}},channels:[{name:"Direct",newUsers:{current:100,previous:80},registrations:{current:20,previous:15}}],sources:["https://analytics.google.com/analytics/web/"]};
beforeEach(()=>{
  config={trafficEnabled:true,sheetsEnabled:true,ga4Credentials:null,workerTokenHash:null};report=null;updates=[];providerCalls=0;imports=0;ranking={status:"COMPLETED"};
  job={id:"traffic:2026-10-13",kind:"TRAFFIC",periodStart:"2026-10-13",leaseToken:"owner",leaseUntil:new Date(Date.now()+600000),status:"RUNNING",payload:null,attempts:0};
});
const resultUpdate=()=>updates.findLast(input=>input.where.leaseToken==="owner")?.data;
test("weekly job waits for complete-week cutoff without provider calls or consuming attempts",async()=>{
  assert.equal((await service.runProjectJobs(new Date("2026-10-20T02:30Z"))).status,"WAITING_DATA");
  assert.equal(resultUpdate().nextAttemptAt.toISOString(),"2026-10-20T10:30:00.000Z");
  assert.equal(resultUpdate().attempts,undefined);assert.equal(providerCalls,0);
});
test("missing authorization is blocked rather than empty success, but an existing full report can complete without credentials",async()=>{
  assert.equal((await service.runProjectJobs(new Date("2026-10-20T11:00Z"))).status,"BLOCKED");
  assert.equal(resultUpdate().errorCode,"GA4_NOT_CONNECTED");assert.equal(imports,0);
  report={analysis:completedAnalysis,newUsers:100,newRegistrations:20};
  assert.equal((await service.runProjectJobs(new Date("2026-10-20T11:05Z"))).status,"COMPLETED");
  assert.equal(providerCalls,0);assert.equal(imports,0);assert.match(resultUpdate().detail,/复用/);
});
test("capture-week reports wait for the same keyword issue; noncapture weeks never wait or create paid calls",async()=>{
  report={analysis:completedAnalysis,newUsers:100,newRegistrations:20};ranking={status:"RUNNING"};
  assert.equal((await service.runProjectJobs(new Date("2026-10-20T11:00Z"))).status,"WAITING_KEYWORDS");
  assert.equal(await service.keywordDependency("2026-10-20"),false);
  assert.equal(providerCalls,0);assert.equal(imports,0);
});
test("expired owner cannot mark success; transient failures stop after four attempts",async()=>{
  const original=db.projectJob.updateMany;
  db.projectJob.updateMany=async()=>({count:0});
  await assert.rejects(()=>service.finishProjectJob(job,{status:"COMPLETED"}),/JOB_LEASE_LOST/);
  db.projectJob.updateMany=original;
  await service.failProjectJob({...job,attempts:3},"GA4_REQUEST_FAILED");
  assert.equal(resultUpdate().status,"FAILED");assert.equal(resultUpdate().attempts,4);
});
test("new cron and worker endpoints reject missing credentials and cannot start provider work",async()=>{
  delete process.env.CRON_SECRET;
  assert.equal((await cron(new Request("https://example.com/api/cron/project-jobs"))).status,401);
  assert.equal((await worker(new Request("https://example.com/api/automation/worker",{method:"POST",body:JSON.stringify({action:"claim"})}))).status,401);
  assert.equal(providerCalls,0);assert.equal(updates.length,0);
});
