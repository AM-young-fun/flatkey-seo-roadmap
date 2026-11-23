const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { workflowTaskSchema, workflowPlanSchema } = require("../src/lib/seo-workflow.ts");
const { prepareWorkflowMutation } = require("../src/lib/seo-workflow-state.ts");
const { keywordMarketAssignmentSchema, keywordLanguageIssue } = require("../src/lib/keyword-market-policy.ts");
const now = new Date("2026-11-23T04:00:00Z");
const evidence = [{label:"真实市场研究和执行补证",url:"https://flatkey.ai/docs",observedAt:"2026-11-23T02:00:00Z"}];
const base = (patch={}) => ({id:"sg-task",weekStart:"2026-11-23",title:"简体中文原词制作",siteDomain:"flatkey.ai",kind:"blog",country:"SG",language:"zh-CN",business:"API",pageType:"blog",keyword:"模型接口价格",keywordId:"actual-keyword",topicId:"actual-topic",pageUrl:"https://flatkey.ai/zh/blog/example",owner:"AI",dueAt:"2026-11-24T05:00:00Z",status:"researching",dependencies:[],evidence,nextAction:"补齐研究",contentVersion:null,acceptanceCriteria:["原词市场一致"],research:{volume:20,kd:10,businessValue:3,exceptionReason:null,intent:"比较API费用",observedAt:evidence[0].observedAt,evidence},approval:null,source:"automation",brief:require("./fixtures/chinese-task-brief.cjs")(evidence),...patch});
const save = (record,all=[],action="save_task",expectedVersion=0,actor="collector") => prepareWorkflowMutation({requestId:"growth-request",action,expectedVersion,record},all,actor,now);
const plan = patch => ({id:"growth-plan",weekStart:"2026-11-23",title:"业务周完整排期",status:"scheduled",taskIds:[],owner:"AI",preparedAt:now.toISOString(),reviewedAt:null,reviewedBy:null,evidence,notes:"原ID保留",targets:{cadence:"growth",executionRange:{start:"2026-11-20",end:"2026-11-26"},landing:0,clusterLanding:7,apiBlogs:10,gpuBlogs:15,optimizedPages:10,blogLanguages:{en:8,ja:6,"pt-BR":5,"zh-CN":5,"es-ES":1,fr:0,de:0,ru:0,vi:0,id:0}},gaps:[...["2026-11-20","2026-11-23","2026-11-24","2026-11-25","2026-11-26"].map(date=>({category:"modelFitBlogs",date,siteDomain:"modelfit.cc",count:1,reason:"本土研究尚需补齐，保留缺口"})),{category:"apiBlogs",count:10,reason:"研究不足如实留缺口"},{category:"gpuBlogs",count:15,reason:"研究不足如实留缺口"},{category:"optimizedPages",count:10,reason:"等待真实页面问题"},{category:"clusterLanding",count:7,reason:"等待原任务补证"}],...patch});

test("Singapore Chinese is a real market and does not enable unsupported satellite languages",()=>{
 assert.equal(workflowTaskSchema.safeParse(base()).success,true);
 assert.equal(workflowTaskSchema.safeParse(base({siteDomain:"modelfit.cc",pageUrl:"https://modelfit.cc/blog/example"})).success,false);
 assert.equal(workflowTaskSchema.safeParse(base({country:"US"})).success,false);
 const assignment=keywordMarketAssignmentSchema.parse({primaryCountry:"SG",language:"zh-CN",secondaryMarkets:[],evidence:"新加坡当地简体中文查询研究及实际页面",reviewedAt:evidence[0].observedAt});
 assert.equal(keywordLanguageIssue("模型接口价格",assignment),null);
 assert.ok(keywordLanguageIssue("モデルの価格",assignment));
});
test("new growth production requires original target, real Top10/opened Top5 and quality evidence",()=>{
 const task=base({workflowContract:"growth-v1.5",status:"ready"});
 assert.throws(()=>save(task),{code:"growth_research_incomplete"});
 const urls=Array.from({length:10},(_,i)=>`https://example.org/result-${i}`);
 const review={country:"SG",language:"zh-CN",keyword:task.keyword,reviewedAt:evidence[0].observedAt,serpResults:urls,openedResults:urls.slice(0,5),duplicateTaskIds:[],duplicateCheckedAt:evidence[0].observedAt,quality:Object.fromEntries(["intent","keywordsAndAlt","experience","links","behavior","algorithmAndManual","eeat"].map(key=>[key,"已核验真实来源、具体限制与后续处理措施"])),evidence};
 assert.equal(save({...task,researchReview:review}).record.status,"ready");
 assert.throws(()=>save({...task,keywordId:null,researchReview:review}),{code:"growth_target_identity_required"});
 assert.throws(()=>save({...task,researchReview:{...review,country:"US"}}),{code:"growth_research_incomplete"});
});
test("problem identity prevents cross-week duplicate work and data-only sites cannot enter execution",()=>{
 const original=save(base({problemKey:"flatkey:sg:pricing:missing-fact"}));
 assert.throws(()=>save(base({id:"another",weekStart:"2026-11-30",dueAt:"2026-12-01T05:00:00Z",problemKey:"flatkey:sg:pricing:missing-fact"}),[{kind:"task",record:original.record}]),{code:"duplicate_problem_task"});
 assert.throws(()=>save(base({siteDomain:"jev-llm.com",country:"US",language:"en",keyword:"model pricing",pageUrl:"https://jev-llm.com/blog/example"})),{code:"task_scope_excluded"});
 assert.throws(()=>save(base({capacityClass:"authorized_hotspot_extra"})),{code:"human_extra_work_required"});
});
test("new planning uses one Friday–Thursday capacity and Chinese quota instead of old four-language literals",()=>{
 assert.equal(workflowPlanSchema.safeParse(plan()).success,true);
 assert.equal(save(plan(),[],"save_plan").record.targets.cadence,"growth");
 const targets=plan().targets;
 assert.throws(()=>save(plan({targets:{...targets,apiBlogs:20,gpuBlogs:30}}),[],"save_plan"),{code:"growth_plan_capacity"});
 assert.throws(()=>save(plan({targets:{...targets,executionRange:{start:"2026-11-23",end:"2026-11-29"}}}),[],"save_plan"),{code:"growth_plan_window"});
 const friday={record:workflowTaskSchema.parse(base({id:"original-friday",weekStart:"2026-11-16",dueAt:"2026-11-20T05:00:00Z",status:"ready"}))};
 assert.equal(save(plan({taskIds:[friday.record.id]}),[{kind:"task",record:friday.record}],"save_plan").record.taskIds[0],"original-friday");
});

test("new automatic content cannot opt out of the server growth contract",()=>{
 assert.equal(save(base()).record.workflowContract,"growth-v1.5");
 assert.throws(()=>save(base({status:"ready"})),{code:"growth_research_incomplete"});
});

test("new plans cannot select the old cadence to bypass shared business-week capacity",()=>{
 const targets={cadence:"workdays",landing:0,clusterLanding:7,apiBlogs:5,gpuBlogs:20,optimizedPages:10,blogLanguages:{en:10,ja:5,"pt-BR":5,"es-ES":5}};
 assert.throws(()=>save(plan({targets}),[],"save_plan"),{code:"growth_plan_contract_required"});
 const p=plan();assert.throws(()=>save({...p,gaps:p.gaps.filter(gap=>gap.category!=="modelFitBlogs")},[],"save_plan"),{code:"growth_plan_modelfit_gap"});
});

test("completed original tasks can append effects after direction expiry without new execution authority",()=>{
 const {isCompletedGrowthEvidenceAppend}=require("../src/lib/seo-workflow-state.ts");
 const prior=base({status:"verified",directionId:"approved-direction",experimentId:"original-experiment",contentVersion:"published-v1"});
 assert.equal(isCompletedGrowthEvidenceAppend({...prior,status:"observing",nextAction:"只读14天效果复查",evidence:[...evidence]},prior),true);
 for(const patch of [{contentVersion:"new-v2"},{directionId:undefined},{dueAt:"2026-11-25T05:00:00Z"},{status:"drafting"}]) assert.equal(isCompletedGrowthEvidenceAppend({...prior,...patch},prior),false);
});
