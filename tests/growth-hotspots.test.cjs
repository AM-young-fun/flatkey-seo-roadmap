const assert = require("node:assert/strict"), {test}=require("node:test"), fs=require("node:fs"), path=require("node:path"), Module=require("node:module"), ts=require("typescript");
const root=path.resolve(__dirname,".."), original=Module._load;
Module._load=function(name,parent,...rest){return original.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest)};
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {buildGrowthHotspotView,activeGrowthHotspot}=require("../src/lib/growth-hotspots.ts");
const now=new Date("2026-11-24T07:00:00Z");
const evidence=role=>({label:`seo-hotspot-v1;event=gpu-launch;at=2026-11-23T00:00:00Z;basis=event;role=${role};verified=1`,url:role==="official"?"https://vendor.example/launch":"https://users.example/discussion",observedAt:"2026-11-23T01:00:00Z"});
const review=()=>({keyword:"gpu new model",country:"US",language:"en",reviewedAt:"2026-11-24T01:00:00Z",serpResults:Array.from({length:10},(_,i)=>`https://search.example/${i}`),openedResults:Array.from({length:5},(_,i)=>`https://search.example/${i}`),evidence:[evidence("official")],quality:Object.fromEntries(["intent","keywordsAndAlt","experience","links","behavior","algorithmAndManual","eeat"].map(key=>[key,"完整研究证据与对应处置说明，原词原市场核验通过"]))});
const task=(id,patch={})=>({id,title:id,siteDomain:"flatkey.ai",topicId:"gpu",country:"US",language:"en",keyword:"gpu new model",directionId:"direction",kind:"research",source:"automation",dueAt:"2026-11-25T08:00:00Z",status:"ready",dependencies:[],evidence:[evidence("official"),evidence("demand")],researchReview:review(),research:null,pageUrl:null,...patch});
const scope=()=>({site:"flatkey.ai",topicId:"gpu",country:"US",language:"en",kinds:["blog","research"],maxTasks:1,validUntil:"2026-11-29T00:00:00Z"});
const direction=()=>({id:"direction",title:"GPU新事件方向",revision:2,updatedAt:"2026-11-24T02:00:00Z",expiresAt:"2026-11-29T00:00:00Z",scope:[scope()],taskIds:["research"],decision:{actor:"human",decision:"approve",revision:2,decidedAt:"2026-11-24T03:00:00Z",scope:[scope()]}});
const state=()=>({baseline:{targets:[]},directions:[direction()],observations:[]});
const workflow=tasks=>({tasks,publications:[]});
const project=(tasks,plans=[],strategy=state(),at=now)=>buildGrowthHotspotView(strategy,workflow(tasks),plans,at);

test("ordinary attribution directions and uncorroborated or same-source tags never become hotspots",()=>{
  assert.equal(project([task("ordinary",{evidence:[]})]).items.length,0);
  assert.equal(project([task("official-only",{evidence:[evidence("official")]})]).items.length,0);
  const same=task("same",{evidence:[evidence("official"),{...evidence("demand"),url:"https://www.vendor.example/launch?utm_source=x#proof"}]});
  assert.equal(activeGrowthHotspot(same,now),null);assert.equal(project([same]).items.length,0);
});
test("incomplete keyword research does not become scheduled merely because a direction was approved",()=>{
  const rows=[task("research",{researchReview:undefined})],view=project(rows,[{id:"plan",status:"scheduled",taskIds:["research"]}]);
  assert.equal(view.items[0].researchComplete,false);assert.equal(view.items[0].admission.status,"needs_research");assert.notEqual(view.items[0].stage,"scheduled");
});
test("approved current-week extras require original formal-plan membership and preserve IDs, dates and frozen N",()=>{
  const research=task("research"),blog=task("original-blog",{kind:"blog",evidence:[],dependencies:["research"],capacityClass:"authorized_hotspot_extra"});
  const tasks=[research,blog],strategy=state(),before=JSON.stringify({tasks,strategy});
  let view=project(tasks,[],strategy);assert.equal(view.items[0].admission.status,"needs_plan_append");
  view=project(tasks,[{id:"original-plan",status:"scheduled",taskIds:["ordinary-original","original-blog"]}],strategy);
  assert.deepEqual(view.businessWeek,{start:"2026-11-20",end:"2026-11-26"});assert.equal(view.items[0].stage,"scheduled");assert.equal(view.items[0].admission.status,"scheduled");
  assert.deepEqual(view.items[0].taskIds,["original-blog","research"]);assert.equal(view.items[0].tasks[0].dueAt,blog.dueAt);assert.equal(view.items[0].inQuarter,false);
  assert.equal(JSON.stringify({tasks,strategy}),before,"projection cannot mutate tasks, quota, IDs or quarter members");
});
test("an existing quarter task is reused without inventing an extra target or changing source",()=>{
  const blog=task("quarter-blog",{kind:"blog",source:"automation",evidence:[],dependencies:["research"]}),strategy=state();
  strategy.baseline.targets=[{id:"quarter-1",site:"flatkey.ai",topicId:"gpu",country:"US",language:"en",keyword:"gpu new model"}];
  const view=project([task("research"),blog],[{id:"original-plan",status:"reviewed",taskIds:[blog.id]}],strategy);
  assert.equal(view.items[0].inQuarter,true);assert.equal(view.items[0].quarterTargetId,"quarter-1");assert.equal(view.items[0].admission.status,"scheduled");assert.equal(blog.source,"automation");
});
test("new target registration and exact human direction scope remain separate gates",()=>{
  const tasks=[task("research"),task("blog",{kind:"blog",evidence:[],dependencies:["research"]})];
  assert.equal(project(tasks).items[0].admission.status,"needs_target_registration");
  const strategy=state();strategy.directions[0].decision.revision=1;
  assert.equal(project(tasks,[],strategy).items[0].admission.status,"not_approved");
  strategy.directions[0].decision.revision=2;strategy.directions[0].decision.scope[0].kinds=["research"];
  assert.equal(project(tasks,[],strategy).items[0].admission.status,"not_approved","research-only approval cannot authorize a blog");
});
test("expiry keeps the original event timestamp and source pair and never refreshes its execution eligibility",()=>{
  const view=project([task("research")],[],state(),new Date("2026-12-02T07:00:00Z")),item=view.items[0];
  assert.equal(item.stage,"expired");assert.equal(item.eventAt,"2026-11-23T00:00:00.000Z");assert.equal(item.validUntil,"2026-11-30T00:00:00.000Z");assert.equal(item.admission.status,"blocked");
  assert.equal(activeGrowthHotspot(task("research"),new Date("2026-12-02T07:00:00Z")),null);
});
test("different intent tasks are not swept into a hotspot through a shared direction",()=>{
  const tasks=[task("research"),task("unrelated",{kind:"blog",keyword:"other keyword",evidence:[],dependencies:[],capacityClass:"authorized_hotspot_extra"})];
  const view=project(tasks,[{id:"plan",status:"scheduled",taskIds:["unrelated"]}]);assert.deepEqual(view.items[0].taskIds,["research"]);assert.notEqual(view.items[0].admission.status,"scheduled");
});
