const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
const root=path.resolve(__dirname,".."),old=Module._load;
Module._load=function(name,parent,...rest){if(name==="server-only")return{};if(name==="@/lib/prisma")return{prisma:{}};if(parent?.filename.endsWith("/services/growth-hotspot-admission.ts")&&["./growth-strategy","./growth-workspace","./seo-workflow"].includes(name))return{};return old.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest)};
require.extensions[".ts"]=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {prepareHotspotAdmission,hotspotLeaseConflict,hotspotTaskMutation,hotspotPlanMutation}=require("../src/lib/growth-hotspot-admission.ts");
const {runGrowthHotspotAdmission}=require("../src/lib/services/growth-hotspot-admission.ts");
const {prepareWorkflowMutation}=require("../src/lib/seo-workflow-state.ts");
const now=new Date("2026-11-24T07:00:00Z"),stamp="2026-11-24T01:00:00Z",event="2026-11-23T00:00:00Z";
const proof=role=>({label:`seo-hotspot-v1;event=gpu-launch;at=${event};basis=event;role=${role};verified=1`,url:`https://${role}.example/event`,observedAt:stamp});
const evidence=[proof("official"),proof("demand")];
const review=()=>({keyword:"gpu rental opportunity",country:"US",language:"en",reviewedAt:stamp,duplicateCheckedAt:stamp,duplicateTaskIds:[],serpResults:Array.from({length:10},(_,i)=>`https://search.example/${i}`),openedResults:Array.from({length:5},(_,i)=>`https://search.example/${i}`),quality:Object.fromEntries(["intent","keywordsAndAlt","experience","links","behavior","algorithmAndManual","eeat"].map(key=>[key,"原词原市场逐页分析、真实质量证据与具体执行说明"])),evidence});
const task=(id,patch={})=>({id,weekStart:"2026-11-23",title:id,siteDomain:"flatkey.ai",channel:"website",kind:"blog",country:"US",language:"en",business:"GPU",pageType:"blog",keyword:"gpu rental opportunity",keywordId:"kw",pageUrl:null,workflowContract:"growth-v1.5",topicId:"gpu",directionId:"direction",experimentId:"experiment",owner:"AI",dueAt:"2026-11-25T06:00:00Z",status:"ready",dependencies:[],evidence,nextAction:"保留原交付日与研究结论",contentVersion:null,artifactUrl:null,acceptanceCriteria:["真实页面验收"],researchReview:review(),research:{volume:20,kd:10,businessValue:3,exceptionReason:null,intent:"GPU rental",observedAt:stamp,evidence},approval:null,source:"automation",sourceRowId:"original-source",fallbackReason:null,failureReason:null,version:3,updatedAt:stamp,recordedAt:stamp,...patch});
const dates=["2026-11-20","2026-11-23","2026-11-24","2026-11-25","2026-11-26"];
const plan=()=>({id:"original-plan",weekStart:"2026-11-23",title:"原计划",status:"scheduled",taskIds:["ordinary"],committedTaskIds:["ordinary"],owner:"AI",preparedAt:stamp,reviewedAt:null,reviewedBy:null,targets:{cadence:"growth",executionRange:{start:"2026-11-20",end:"2026-11-26"},landing:0,clusterLanding:7,apiBlogs:10,gpuBlogs:15,optimizedPages:10,maintenanceVersion:"seo-maintenance-v1",contentRefreshPages:10,blogLanguages:{en:8,ja:6,"pt-BR":5,"zh-CN":5,"es-ES":1,fr:0,de:0,ru:0,vi:0,id:0}},gaps:[...dates.flatMap(date=>[{category:"modelFitBlogs",date,siteDomain:"modelfit.cc",count:1,reason:"独立需求证据待补"},{category:"contentRefreshPages",date,count:2,reason:"原文候选待核"}]),...[ ["apiBlogs",10],["gpuBlogs",15],["optimizedPages",10],["clusterLanding",7] ].map(([category,count])=>({category,count,reason:"原计划真实缺口"}))],evidence,notes:"原计划记录不改",version:5,recordedAt:stamp,updatedAt:stamp});
function fixture(){const scope={site:"flatkey.ai",topicId:"gpu",country:"US",language:"en",kinds:["blog","research"],maxTasks:20,validUntil:"2026-11-29T00:00:00Z"};const direction={id:"direction",revision:2,title:"GPU事件方向",updatedAt:stamp,expiresAt:"2026-11-29T00:00:00Z",experimentId:"experiment",scope:[scope],taskIds:["research","blog"],decision:{actor:"human",decision:"approve",revision:2,decidedAt:stamp,scope:[scope]}};return{strategy:{baseline:{targets:[]},directions:[direction],observations:[]},workspace:{targets:[{id:"target",keywordId:"kw",keyword:"gpu rental opportunity",site:"flatkey.ai",topicId:"gpu",country:"US",language:"en",membership:"formal",languageStatus:"match",sourceActive:true}],topics:[{id:"gpu",topicId:"gpu",site:"flatkey.ai",name:"GPU"}]},workflow:{tasks:[task("research",{kind:"research",status:"verified"}),task("blog",{dependencies:["research"]}),task("ordinary",{kind:"research",keyword:"other term",keywordId:"other",topicId:"other",evidence:[]})],publications:[],runs:[]},plans:[plan()],leases:[]};}
const command={directionId:"direction",revision:2,taskIds:["blog"]};
test("the extra cap counts real scheduled pages across plans, and preserves old entries", () => {
  const { hotspotCapacityProblem } = require("../src/lib/growth-hotspot-admission.ts");
  const extra = (id, date) => task(id, { dueAt: date + "T06:00:00Z", capacityClass: "authorized_hotspot_extra" });
  const pages = [extra("one", "2026-11-23"), extra("two", "2026-11-24"), extra("three", "2026-11-25"), extra("same", "2026-11-23")];
  assert.match(hotspotCapacityProblem(pages, new Set(["one", "two", "three"]), new Set(["three"])), /两页上限/);
  assert.match(hotspotCapacityProblem(pages, new Set(["one", "same"]), new Set(["same"])), /当日额外交付/);
  assert.equal(hotspotCapacityProblem(pages, new Set(["one", "two", "three"]), new Set()), null);
  assert.equal(hotspotCapacityProblem(pages, new Set(["one", "two"]), new Set(["two"])), null);
});
function store(context,options={}){const writes=[],events=new Map();return{writes,read:async()=>structuredClone(context),save:async(request,actor)=>{assert.equal(actor,"human");if(options.failPlan&&request.action==="save_plan")throw new Error("network");if(options.beforeSave)options.beforeSave(request,context);if(events.has(request.requestId))return{record:events.get(request.requestId)};const rows=[...context.workflow.tasks.map(record=>({kind:"task",record})),...context.plans.map(record=>({kind:"plan",record}))];const prepared=prepareWorkflowMutation(request,rows,actor,now);const list=prepared.kind==="task"?context.workflow.tasks:context.plans;const index=list.findIndex(row=>row.id===prepared.record.id);assert.ok(index>=0,"must update existing original only");list[index]=prepared.record;writes.push(request);events.set(request.requestId,prepared.record);if(options.unknownAfterTask&&request.action==="save_task")throw new Error("committed then timeout");return{record:prepared.record};}};}
function legacyFullEnglishPlan(){
  const context=fixture(),days=["2026-11-23","2026-11-24","2026-11-25","2026-11-26","2026-11-27"];
  const original=Array.from({length:10},(_,i)=>{const keyword=`original planned topic ${i}`;return task(`original-en-${i}`,{keyword,keywordId:`original-kw-${i}`,dueAt:`${days[Math.floor(i/2)]}T06:00:00Z`,directionId:undefined,experimentId:undefined,researchReview:{...review(),keyword}})});
  context.workflow.tasks=[...context.workflow.tasks.filter(task=>task.id!=="ordinary"),...original];
  const extra=context.workflow.tasks.find(task=>task.id==="blog");
  extra.title="热点博客原任务";
  extra.brief={reason:"官方新增产品事件说明本地用户存在新的购买比较需求，需要用真实来源解释产品差异与限制",problem:"当前原页面缺少新增产品的选择边界及真实需求说明",plan:"沿原任务补充官方事实和当地搜索需求并按完整研究结果制作源文",evidence,actions:[{target:"原博客页面",change:"补充已核验产品变化与对用户选型的具体影响",verify:"核验对应事实链接和当前版本页面内容是否一致"}]};
  const previous=context.plans[0];
  previous.targets={cadence:"workdays",landing:0,clusterLanding:7,apiBlogs:10,gpuBlogs:15,optimizedPages:10,blogLanguages:{en:10,ja:5,"pt-BR":5,"es-ES":5}};
  previous.taskIds=original.map(task=>task.id);previous.committedTaskIds=[...previous.taskIds];
  previous.gaps=Object.entries({apiBlogs:10,gpuBlogs:5,optimizedPages:10,clusterLanding:7,blogJa:5,blogPt:5,blogEs:5}).map(([category,count])=>({category,count,reason:"原计划尚无合格研究，保留原真实缺口"}));
  return context;
}
test("legacy full ten-English plan appends a qualified extra through normal CAS without changing ordinary targets, gaps, source or dates",async()=>{
  const context=legacyFullEnglishPlan(),before=structuredClone(context),db=store(context);
  const result=await runGrowthHotspotAdmission(command,"human",db,now);
  assert.equal(result.items[0].status,"scheduled");
  assert.deepEqual(db.writes.map(row=>row.action),["save_task","save_plan"]);
  assert.deepEqual(context.plans[0].taskIds,[...before.plans[0].taskIds,"blog"]);
  for(const key of ["targets","gaps","weekStart","dueAt"])assert.deepEqual(context.plans[0][key],before.plans[0][key]);
  for(const original of before.workflow.tasks){const actual=context.workflow.tasks.find(task=>task.id===original.id);for(const key of ["id","source","sourceRowId","dueAt","weekStart","keyword","keywordId","country","language","topicId"])assert.deepEqual(actual[key],original[key]);}
  assert.equal(context.workflow.tasks.find(task=>task.id==="blog").capacityClass,"authorized_hotspot_extra");
  const regular=legacyFullEnglishPlan(),routine=regular.workflow.tasks.find(task=>task.id==="blog");
  const rows=[...regular.workflow.tasks.map(record=>({kind:"task",record})),{kind:"plan",record:regular.plans[0]}];
  assert.throws(()=>prepareWorkflowMutation(hotspotPlanMutation(regular.plans[0],routine.id,command),rows,"human",now),{code:"plan_weekly_language_quota"},"A routine task still consumes the original full English quota");
});
test("legacy extra quota exception retains human, research, scope and workday qualification gates",async()=>{
  const unauthorized=legacyFullEnglishPlan(),rows=unauthorized.workflow.tasks.map(record=>({kind:"task",record}));
  assert.throws(()=>prepareWorkflowMutation(hotspotTaskMutation(unauthorized.workflow.tasks.find(task=>task.id==="blog"),command),rows,"collector",now),{code:"human_extra_work_required"});
  const incomplete=legacyFullEnglishPlan(),incompleteTask=incomplete.workflow.tasks.find(task=>task.id==="blog");
  incompleteTask.researchReview.openedResults=incompleteTask.researchReview.serpResults.slice(5);
  assert.throws(()=>prepareWorkflowMutation(hotspotTaskMutation(incompleteTask,command),incomplete.workflow.tasks.map(record=>({kind:"task",record})),"human",now),{code:"growth_research_incomplete"});
  for(const [change,code] of [[task=>{task.dueAt="2026-11-22T06:00:00Z"},"plan_content_nonworkday"],[task=>{task.siteDomain="jev-llm.com"},"plan_monitor_only_site"],[task=>{delete task.brief},"plan_task_brief_incomplete"]]){
    const context=legacyFullEnglishPlan(),extra=context.workflow.tasks.find(task=>task.id==="blog");
    extra.capacityClass="authorized_hotspot_extra";change(extra);
    const all=[...context.workflow.tasks.map(record=>({kind:"task",record})),{kind:"plan",record:context.plans[0]}];
    assert.throws(()=>prepareWorkflowMutation(hotspotPlanMutation(context.plans[0],extra.id,command),all,"human",now),{code});
  }
  for(const change of [c=>{c.strategy.directions[0].decision.decision="hold"},c=>{c.workflow.tasks.find(task=>task.id==="blog").researchReview.openedResults=[]},c=>{c.workflow.tasks.find(task=>task.id==="blog").dueAt="2026-11-22T06:00:00Z"},c=>{c.workflow.tasks.find(task=>task.id==="blog").siteDomain="rougecue.org"}]){
    const context=legacyFullEnglishPlan();change(context);const before=structuredClone(context),db=store(context);
    const result=await runGrowthHotspotAdmission(command,"human",db,now);
    assert.equal(result.items[0].status,"pending");assert.equal(db.writes.length,0);assert.deepEqual(context,before);
  }
});
test("human admission updates only capacity then appends to original plan through normal CAS, preserving original source/targets/dates",async()=>{const context=fixture(),before=structuredClone(context),db=store(context);const result=await runGrowthHotspotAdmission(command,"human",db,now);assert.equal(result.items[0].status,"scheduled");assert.deepEqual(db.writes.map(row=>row.action),["save_task","save_plan"]);const actual=context.workflow.tasks.find(row=>row.id==="blog");for(const key of ["id","source","dueAt","weekStart","keyword","keywordId","country","language","topicId","contentVersion","dependencies"])assert.deepEqual(actual[key],before.workflow.tasks[1][key]);assert.equal(actual.capacityClass,"authorized_hotspot_extra");assert.deepEqual(context.plans[0].targets,before.plans[0].targets);assert.deepEqual(context.plans[0].taskIds,["ordinary","blog"]);assert.deepEqual(context.strategy.baseline,before.strategy.baseline);assert.equal(result.createdTasks,0);assert.equal(result.createdPlans,0);assert.equal(result.paidRequests,0);const again=await runGrowthHotspotAdmission(command,"human",db,now);assert.equal(again.items[0].status,"reused");assert.equal(db.writes.length,2);});
test("plan failure persists pending original task registration; retry completes only missing plan step",async()=>{const context=fixture(),first=store(context,{failPlan:true});const result=await runGrowthHotspotAdmission(command,"human",first,now);assert.equal(result.items[0].status,"pending");assert.equal(result.items[0].taskRegistered,true);assert.equal(context.workflow.tasks[1].capacityClass,"authorized_hotspot_extra");assert.deepEqual(context.plans[0].taskIds,["ordinary"]);const retry=store(context),done=await runGrowthHotspotAdmission(command,"human",retry,now);assert.equal(done.items[0].status,"scheduled");assert.deepEqual(retry.writes.map(row=>row.action),["save_plan"]);});
test("unknown task response is read back before proceeding and never causes a second registration",async()=>{const context=fixture(),db=store(context,{unknownAfterTask:true});const result=await runGrowthHotspotAdmission(command,"human",db,now);assert.equal(result.items[0].status,"scheduled");assert.equal(db.writes.filter(row=>row.action==="save_task").length,1);});
test("collector cannot impersonate a human or touch sources, and strict input cannot smuggle source/targets",async()=>{let reads=0;const db={read:async()=>{reads++;return fixture()},save:async()=>{throw Error("no")}};await assert.rejects(runGrowthHotspotAdmission(command,"collector",db,now),{code:"human_hotspot_admission_required"});assert.equal(reads,0);await assert.rejects(runGrowthHotspotAdmission({...command,source:"human"},"human",db,now));assert.equal(reads,0);});
test("research/native market/TopicMap/exact revision gates leave original records untouched",async()=>{for(const change of [c=>{c.workflow.tasks[1].researchReview.openedResults=c.workflow.tasks[1].researchReview.openedResults.slice(0,4)},c=>{c.workspace.targets[0].languageStatus="mismatch"},c=>{c.workspace.topics=[]},c=>{c.strategy.directions[0].decision.revision=1},c=>{c.workflow.tasks[1].language="ru"}]){const context=fixture();change(context);const before=JSON.stringify(context),db=store(context),result=await runGrowthHotspotAdmission(command,"human",db,now);assert.equal(result.items[0].status,"pending");assert.equal(db.writes.length,0);assert.equal(JSON.stringify(context),before);}});
test("running original/unknown leases block new admission; unrelated known runs and existing planned task are preserved",async()=>{const context=fixture();context.workflow.runs=[{id:"run",status:"running",taskIds:["blog"]}];assert.match(prepareHotspotAdmission(context,command,"blog",now).reason,/运行/);context.workflow.runs=[];context.leases=[{runId:"unknown",status:"running",leaseUntil:"2026-11-24T08:00:00Z"}];assert.match(prepareHotspotAdmission(context,command,"blog",now).reason,/租约/);assert.equal(hotspotLeaseConflict(["blog"],[{id:"other",status:"running",taskIds:["unrelated"]}],[{runId:"other",status:"running",leaseUntil:"2026-11-24T08:00:00Z"}],now),null);context.plans[0].taskIds.push("blog");const db=store(context);assert.equal((await runGrowthHotspotAdmission(command,"human",db,now)).items[0].status,"reused");assert.equal(db.writes.length,0);});
test("ambiguous/missing plans, a different business week and duplicate intent do not create or reschedule",()=>{const context=fixture();context.plans=[];assert.match(prepareHotspotAdmission(context,command,"blog",now).reason,/尚无/);context.plans=[plan(),{...plan(),id:"second-plan"}];assert.match(prepareHotspotAdmission(context,command,"blog",now).reason,/多个/);context.plans=[plan()];context.workflow.tasks[1].dueAt="2026-11-27T06:00:00Z";assert.match(prepareHotspotAdmission(context,command,"blog",now).reason,/不擅挪下周/);context.workflow.tasks[1].dueAt="2026-11-25T06:00:00Z";context.workflow.tasks.push(task("other-blog",{weekStart:"2026-11-16",dueAt:"2026-11-20T06:00:00Z"}));assert.match(prepareHotspotAdmission(context,command,"blog",now).reason,/同意图/);});
test("mutation operation IDs bind exact versions, preserving CAS rather than overwriting concurrent edits",()=>{const context=fixture(),taskRequest=hotspotTaskMutation(context.workflow.tasks[1],command),planRequest=hotspotPlanMutation(context.plans[0],"blog",command);assert.equal(taskRequest.expectedVersion,3);assert.equal(planRequest.expectedVersion,5);assert.equal(taskRequest.record.source,"automation");assert.equal(taskRequest.requestId,hotspotTaskMutation(context.workflow.tasks[1],command).requestId);assert.notEqual(taskRequest.requestId,hotspotTaskMutation({...context.workflow.tasks[1],version:4},command).requestId);const dbRows=context.workflow.tasks.map(record=>({kind:"task",record}));context.workflow.tasks[1].version++;assert.throws(()=>prepareWorkflowMutation(taskRequest,dbRows,"human",now),{code:"version_conflict"});});

test("hotspot delivery checks the event timestamp in addition to the business-week date",()=>{
  const context=fixture(), blog=context.workflow.tasks.find(row=>row.id==="blog");
  const event="2026-11-19T02:30:00Z";
  for(const item of context.workflow.tasks.filter(row=>["blog","research"].includes(row.id))){
    item.evidence=item.evidence.map(row=>({...row,label:row.label.replace("2026-11-23T00:00:00Z",event)}));
    item.research.evidence=item.evidence;
  }
  blog.dueAt="2026-11-26T02:30:00.001Z";
  assert.match(prepareHotspotAdmission(context,command,"blog",now).reason,/7 天内/);
  blog.dueAt="2026-11-26T02:30:00.000Z";
  assert.equal(prepareHotspotAdmission(context,command,"blog",now).status,"admit");
  blog.dueAt="2026-11-18T23:30:00Z";
  assert.equal(prepareHotspotAdmission(context,command,"blog",now).status,"pending");
});

test("weekly growth binds real weekly report, exact country/page and the following Friday–Thursday workweek", () => {
  const { weeklyGrowthTaskProblem } = require("../src/lib/growth-weekly-admission.ts");
  const context = fixture(), direction = context.strategy.directions[0];
  const reportId = "digest:weekly", reportHash = "c".repeat(64), pageUrl = "https://flatkey.ai/blog/gpu-rental";
  const clock = new Date("2026-11-26T09:00:00Z");
  const driver = { url: pageUrl, topicId: "gpu", country: "US", source: "GSC", metric: "clicks", previous: 15, current: 25,
    window: { start: "2026-11-19", end: "2026-11-25", previousStart: "2026-11-12", previousEnd: "2026-11-18", timezone: "America/Los_Angeles" } };
  const report = { id: reportId, hash: reportHash, kind: "weekly", date: "2026-11-26", generatedAt: "2026-11-26T08:30:00Z", growthSnapshot: { directions: [{ drivers: [driver] }] } };
  const scope = { ...direction.scope[0], kinds: ["optimization"], validUntil: "2026-12-04T00:00:00Z" };
  Object.assign(direction, { weeklyGrowth: { reportId, reportHash }, scope: [scope], expiresAt: scope.validUntil,
    drivers: [driver], taskIds: ["boost"], evidence: [{ source: "demand", observedAt: stamp }], decision: { ...direction.decision, scope: [scope] } });
  const boost = task("boost", { kind: "optimization", pageUrl, dueAt: "2026-11-30T06:00:00Z", capacityClass: "authorized_weekly_growth_extra", weeklyGrowthRevision: 2 });
  const check = (patch = {}, source = report) => weeklyGrowthTaskProblem(context.strategy, { ...boost, ...patch }, source, clock);
  assert.equal(check(), null);
  assert.match(check({ pageUrl: "https://flatkey.ai/blog/other" }), /未与周报/);
  assert.match(check({ weeklyGrowthRevision: 3 }), /确切/);
  assert.match(check({ dueAt: "2026-12-04T06:00:00Z" }), /周报后/);
  assert.match(check({ dueAt: "2026-11-28T06:00:00Z" }), /工作日/);
  assert.match(check({}, { ...report, kind: "daily" }), /真实已保存周报/);
  assert.match(check({}, { ...report, growthSnapshot: { directions: [{ drivers: [{ ...driver, current: 50 }] }] } }), /同一周报/);
  direction.evidence = [];
  assert.match(check(), /持续性证据/);
});

test("daily extra capacity is shared and weekly growth reserves two deliveries for one topic", () => {
  const { seoExtraCapacityProblem } = require("../src/lib/seo-extra-capacity.ts");
  const extras = [
    task("hot", { capacityClass: "authorized_hotspot_extra", dueAt: "2026-11-27T06:00:00Z" }),
    task("boost0", { capacityClass: "authorized_weekly_growth_extra", kind: "optimization", dueAt: "2026-11-27T07:00:00Z" }),
    task("boost1", { capacityClass: "authorized_weekly_growth_extra", kind: "optimization", dueAt: "2026-11-30T07:00:00Z" }),
    task("boost2", { capacityClass: "authorized_weekly_growth_extra", kind: "optimization", dueAt: "2026-12-01T07:00:00Z" }),
    task("boost3", { capacityClass: "authorized_weekly_growth_extra", kind: "optimization", dueAt: "2026-12-02T07:00:00Z", topicId: "different" }),
  ];
  const check = ids => seoExtraCapacityProblem(extras, new Set(ids), new Set(ids.slice(-1)));
  assert.match(check(["hot", "boost0"]), /当日额外/);
  assert.equal(check(["hot", "boost1", "boost2"]), null);
  assert.match(check(["boost0", "boost1", "boost2"]), /两项/);
  assert.match(check(["boost1", "boost3"]), /一个上涨加推话题/);
});
