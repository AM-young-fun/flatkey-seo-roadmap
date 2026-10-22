const assert=require("node:assert/strict"),{test,beforeEach}=require("node:test"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
const root=path.resolve(__dirname,".."),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest);};
require.extensions[".ts"]=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const mock=(relative,exports)=>{const filename=path.join(root,relative);require.cache[filename]={id:filename,filename,loaded:true,exports};};
let session,stored,report,writes;
mock("src/lib/auth.ts",{AUTH_COOKIE_NAME:"auth",isAuthEnabled:()=>true,isValidAuthToken:async()=>session});
const headers=require.resolve("next/headers");require.cache[headers]={id:headers,filename:headers,loaded:true,exports:{cookies:async()=>({get:()=>undefined})}};
mock("src/lib/import-credential.ts",{getRankingImportSecret:()=>undefined});
mock("src/lib/prisma.ts",{prisma:{collectorRun:{findUnique:async()=>stored,createMany:async({data})=>{writes++;stored??={...data[0]};},updateMany:async({where,data})=>{writes++;if(stored?.status!==where.status.not)Object.assign(stored,data);}},weeklyTraffic:{findFirst:async()=>report}}});
const {collectorRunSchema}=require("../src/lib/collector-runs.ts"),{weeklyEvidenceSchema}=require("../src/lib/weekly-evidence-schema.ts"),{POST}=require("../src/app/api/collectors/runs/route.ts"),{nextCollectorTime}=require("../src/lib/operations.ts");
beforeEach(()=>{session=false;stored=null;report=null;writes=0;});
const sourceChecks=["api_main","cloud_main","optimization"].map(sourceId=>({sourceId,status:"COMPLETED",rows:5}));
const request=body=>new Request("https://example.com/api/collectors/runs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
test("Codex schedule separates daily docs from weekly Ahrefs and the full-week 18:30 publication",()=>{
  const now=new Date("2026-10-20T03:00Z");
  assert.equal(nextCollectorTime(now,"sheets"),"2026-10-21T02:30:00.000Z");
  assert.equal(nextCollectorTime(now,"ahrefs"),"2026-10-27T02:30:00.000Z");
  assert.equal(nextCollectorTime(now,"traffic"),"2026-10-20T10:30:00.000Z");
});
test("three-table completion needs all three actual success receipts; zero changes need not mean no read",()=>{
  const base={kind:"SHEETS",periodStart:"2026-10-20",status:"COMPLETED",checkedItems:15};
  assert.equal(collectorRunSchema.safeParse(base).success,false);
  assert.equal(collectorRunSchema.safeParse({...base,sourceChecks}).success,true);
  assert.equal(collectorRunSchema.safeParse({...base,sourceChecks:[sourceChecks[0],sourceChecks[0],sourceChecks[1]]}).success,false);
  assert.equal(collectorRunSchema.safeParse({...base,sourceChecks:sourceChecks.map((row,i)=>i?row:{...row,status:"FAILED"})}).success,false);
});
test("collector cannot write without existing authentication or regress a completed receipt",async()=>{
  const body={kind:"SHEETS",periodStart:"2026-10-20",status:"COMPLETED",sourceChecks};
  assert.equal((await POST(request(body))).status,401);assert.equal(writes,0);
  session=true;assert.equal((await POST(request(body))).status,200);assert.equal(stored.status,"COMPLETED");
  assert.equal((await POST(request({...body,status:"RUNNING"}))).status,200);assert.equal(stored.status,"COMPLETED");
});
test("a GA4 receipt cannot claim success until the full report contains Codex's checked summary",async()=>{
  session=true;const body={kind:"GA4",periodStart:"2026-10-13",status:"COMPLETED"};
  assert.equal((await POST(request(body))).status,409);
  const evidence={complete:true,totals:{current:{newUsers:10,newRegistrations:2},previous:{newUsers:8,newRegistrations:1}},channels:[{name:"Direct",newUsers:{current:10,previous:8},registrations:{current:2,previous:1}}],sources:["https://analytics.google.com/analytics/web/"]};
  report={analysis:evidence,newUsers:10,newRegistrations:2};assert.equal((await POST(request(body))).status,409);
  evidence.codexSummary={preparedAt:"2026-10-20T00:00:00Z",findings:[{title:"渠道变化",evidence:"直接访问新用户8→10，注册1→2。",action:"继续观察，未证明技术故障。",level:"finding"}]};
  assert.equal(weeklyEvidenceSchema.safeParse(evidence).success,true);assert.equal((await POST(request(body))).status,200);
  assert.equal(weeklyEvidenceSchema.safeParse({...evidence,codexSummary:{...evidence.codexSummary,findings:[]}}).success,false);
});
test("new weekly GA4 completion requires both pillar counts; a missing prior baseline is allowed",async()=>{
  session=true;
  const body={kind:"GA4",periodStart:"2026-10-20",status:"COMPLETED"};
  report={newUsers:10,newRegistrations:2,analysis:{complete:true,totals:{current:{newUsers:10,newRegistrations:2},previous:{newUsers:8,newRegistrations:1}},channels:[{name:"Direct",newUsers:{current:10,previous:8},registrations:{current:2,previous:1}}],sources:["https://analytics.google.com/analytics/web/"],codexSummary:{preparedAt:"2026-10-20T00:00:00Z",findings:[{title:"核对完成",evidence:"来源一致。",action:"保存。",level:"finding"}]}}};
  assert.equal((await POST(request(body))).status,409);assert.equal(writes,0);
  report.analysis.pageVisitors={metric:"totalUsers",eventName:"page_view",ruleVersion:1,sourceUrl:"https://analytics.google.com/analytics/web/",groups:[{key:"models",users:{current:20,previous:null}},{key:"prompts",users:{current:null,previous:null}}]};
  assert.equal((await POST(request(body))).status,409);assert.equal(writes,0);
  report.analysis.pageVisitors.groups[1].users.current=0;
  assert.equal((await POST(request(body))).status,200);assert.equal(stored.status,"COMPLETED");
});
