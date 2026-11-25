const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
const root=path.resolve(__dirname,".."),original=Module._load;let session=false,saves=0,approvals=0,hooks=0,hookFails=false,weeklyDirection=false,weeklyHooks=0;
Module._load=function(name,parent,...rest){
  if(name==="server-only")return{};if(name==="next/headers")return{cookies:async()=>({get:()=>undefined})};if(name==="./auth")return{AUTH_COOKIE_NAME:"auth",isAuthEnabled:()=>true,isValidAuthToken:async()=>session};if(name==="@/lib/prisma")return{prisma:{}};
  if(name==="./import-credential"||name==="@/lib/import-credential")return{getRankingImportSecret:()=>"test-workflow-secret"};
  if(name==="@/lib/services/growth-hotspot-admission")return{saveGrowthHotspotAdmission:async(raw,actor)=>{const{growthHotspotAdmissionSchema}=require("../src/lib/growth-hotspot-admission.ts");growthHotspotAdmissionSchema.parse(raw);assert.equal(actor,"human");saves++;return{items:[],createdTasks:0,createdPlans:0,paidRequests:0}},admitApprovedGrowthDirection:async()=>{hooks++;if(hookFails)throw Error("temporary read failure");return{status:"pending",reason:"原研究未齐"}}};
  if(name==="@/lib/services/growth-weekly-admission")return{admitApprovedWeeklyGrowthDirection:async(id,revision,actor)=>{const {WorkflowError}=require("../src/lib/seo-workflow-state.ts");if(actor!=="human")throw new WorkflowError("weekly_growth_human_required","human",403);assert.equal(id,"direction");assert.equal(revision,2);weeklyHooks++;return{status:"pending",reason:"原计划待排"}}};
  if(name==="@/lib/services/growth-strategy")return{saveGrowthStrategy:async()=>{approvals++;return{state:{version:2,directions:weeklyDirection?[{id:"direction",revision:2,weeklyGrowth:{reportId:"report"}}]:[]},stored:true}}};
  return original.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest);
};
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const admit=require("../src/app/api/seo/growth/hotspots/admit/route.ts"),strategy=require("../src/app/api/seo/growth/strategy/route.ts");
const base="https://seo.test",body={directionId:"direction",revision:2,taskIds:["original-blog"]};
const request=(path,raw=body,headers={origin:base})=>new Request(base+path,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(raw)});
test("admission route requires an actual human same-origin session before source or mutation calls",async()=>{session=false;saves=0;assert.equal((await admit.POST(request("/api/seo/growth/hotspots/admit"))).status,401);session=true;assert.equal((await admit.POST(request("/api/seo/growth/hotspots/admit",body,{origin:"https://foreign.test"}))).status,403);session=false;assert.equal((await admit.POST(request("/api/seo/growth/hotspots/admit",body,{authorization:"Bearer test-workflow-secret"}))).status,403);assert.equal(saves,0);});
test("human retries accept only original IDs and exact direction revision, without caller-supplied source or quota fields",async()=>{session=true;saves=0;const bad=await admit.POST(request("/api/seo/growth/hotspots/admit",{...body,source:"human",targets:{blogs:100}}));assert.equal(bad.status,400);assert.equal(saves,0);const good=await admit.POST(request("/api/seo/growth/hotspots/admit"));assert.equal(good.status,200);assert.equal(saves,1);assert.equal((await good.json()).paidRequests,0);});
test("direction approval success is retained when its non-atomic hotspot append is pending or fails",async()=>{session=true;approvals=0;hooks=0;hookFails=true;const approved=await strategy.POST(request("/api/seo/growth/strategy",{action:"decide_direction",directionId:"direction",revision:2,decision:"approve"}));assert.equal(approved.status,200);const result=await approved.json();assert.equal(result.state.version,2);assert.equal(result.hotspotAdmission.status,"pending");assert.match(result.hotspotAdmission.reason,/批准已保存/);assert.equal(approvals,1);assert.equal(hooks,1);hookFails=false;await strategy.POST(request("/api/seo/growth/strategy",{action:"decide_direction",directionId:"direction",revision:2,decision:"hold"}));assert.equal(hooks,1,"hold/reject never trigger admission");});

test("an approved weekly direction uses only weekly admission, and an exact retry does not make another direction decision", async () => {
  session = true; weeklyDirection = true; weeklyHooks = 0; hooks = 0; approvals = 0;
  const route = "/api/seo/growth/strategy";
  const approved = await strategy.POST(request(route, { action: "decide_direction", directionId: "direction", revision: 2, decision: "approve" }));
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).weeklyGrowthAdmission.status, "pending");
  const retry = { action: "retry_weekly_growth", directionId: "direction", revision: 2 };
  assert.equal((await strategy.POST(request(route, { ...retry, taskIds: ["invented"] }))).status, 400);
  assert.equal((await strategy.POST(request(route, retry))).status, 200);
  session = false;
  assert.equal((await strategy.POST(request(route, retry, { authorization: "Bearer test-workflow-secret" }))).status, 403);
  assert.equal(approvals, 1);
  assert.equal(hooks, 0);
  assert.equal(weeklyHooks, 2);
  weeklyDirection = false;
});
