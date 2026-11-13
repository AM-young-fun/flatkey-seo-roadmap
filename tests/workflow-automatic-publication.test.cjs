const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { automaticPageRoute, automaticTaskPolicy, workflowPublicationSchema, approvalItemNeedsHuman } = require("../src/lib/seo-workflow.ts");
const { prepareWorkflowMutation, workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
const now = new Date("2026-11-12T05:00:00Z"), before="2026-11-12T03:00:00Z", publishedAt="2026-11-12T04:00:00Z", evidence=[{label:"Fixture exact version",artifact:"fixture.json",observedAt:before}];
const task = (patch={})=>({id:"blog-task",weekStart:"2026-11-09",title:"GPU rental",siteDomain:"flatkey.ai",kind:"blog",pageType:"blog",pageUrl:"https://flatkey.ai/blog/gpu-rental",country:"US",language:"en",keyword:"gpu rental",business:"GPU",owner:"AI",dueAt:publishedAt,status:"drafting",dependencies:[],contentVersion:"v2",evidence,nextAction:"Publish",acceptanceCriteria:["Exact CMS version"],research:{volume:20,kd:5,businessValue:3,exceptionReason:null,intent:"rental",observedAt:before,evidence},source:"automation",...patch});
const save=(record,all=[],action="save_task",version=0)=>{const r=prepareWorkflowMutation({requestId:"fixture-write",action,expectedVersion:version,record},all,"collector",now);return {kind:r.kind,record:r.record};};
const plan={kind:"plan",record:{id:"weekly",weekStart:"2026-11-09",status:"reviewed",taskIds:["blog-task"]}};
const pub=(patch={})=>({id:"pub",taskId:"blog-task",approvalId:null,approvalItemId:null,publicationPolicy:"auto_blog",automaticWrite:{operation:"create",sourceId:"cms-id",baseContentVersion:null,contentVersion:"v2",publishedAt,verifiedAt:"2026-11-12T04:00:02Z",receipt:"cms-receipt.json"},weekStart:"2026-11-09",runId:"BLOG:fixture",siteDomain:"flatkey.ai",pageUrl:"https://flatkey.ai/blog/gpu-rental",country:"US",language:"en",keyword:"gpu rental",contentVersion:"v2",title:"GPU rental",kind:"source_blog",sourcePublicationId:null,publishedAt,verifiedAt:null,status:"published",liveCheck:null,evidence,failureReason:null,...patch});
const baseline=()=>({kind:"optimization",record:{id:"opt",taskId:"blog-task",pageUrl:"https://flatkey.ai/blog/gpu-rental",baseline:{capturedAt:before}}});

test("automatic route/task policy rejects functional pages and host/path impersonation",()=>{
 assert.equal(automaticPageRoute("https://flatkey.ai/pt/blog/gpu-rental","flatkey.ai"),"blog");
 for(const url of ["https://flatkey.ai/gpu","https://flatkey.ai/blog","https://flatkey.ai/blog/x?x=1","https://flatkey.ai//blog/x","https://flatkey.ai/blog/%2e%2e","https://www.flatkey.ai/blog/x","https://flatkey.ai.evil/blog/x","https://evil@flatkey.ai/blog/x","http://flatkey.ai/blog/x","https://flatkey.ai/blog/x/"]) assert.equal(automaticPageRoute(url,"flatkey.ai"),null,url);
 for(const patch of [{kind:"landing"},{kind:"technical"},{pageType:"tool"},{channel:"product"},{pageUrl:"https://flatkey.ai/pricing"}]) assert.equal(automaticTaskPolicy(task(patch)),null);
 assert.equal(automaticTaskPolicy(task({kind:"optimization"})),"auto_blog");
});
test("new source and linked translation can publish without a human approval, from an automatically scheduled plan",()=>{
 const t=save(task());assert.throws(()=>save(pub(),[t],"record_publication"),/本周最新计划已排期/);
 const draft = {...plan.record,status:"draft",title:"Weekly candidates",owner:"AI",preparedAt:before,reviewedAt:null,reviewedBy:null,targets:{cadence:"focused",landing:3,apiBlogs:0,gpuBlogs:20,optimizedPages:14,blogLanguages:{en:5,ja:5,"pt-BR":5,"es-ES":5}},gaps:Object.entries({landing:3,gpuBlogs:19,optimizedPages:14,blogEn:4,blogJa:5,blogPt:5,blogEs:5}).map(([category,count])=>({category,count,reason:"Awaiting qualified candidates"})),evidence,notes:""};
 const pending=save(draft,[t],"save_plan");
 assert.throws(()=>save(pub(),[t,pending],"record_publication"),/本周最新计划已排期/);
 assert.throws(()=>save({...draft,status:"scheduled",gaps:[]},[t],"save_plan"),/缺/);
 const scheduled=save({...draft,status:"scheduled"},[t],"save_plan");
 const source=save(pub(),[t,scheduled],"record_publication"); assert.equal(source.record.approvalId,null);
 const translation=pub({id:"translation",kind:"translation",sourcePublicationId:"pub",country:null,language:"ja",keyword:null,pageUrl:"https://flatkey.ai/ja/blog/gpu-rental",contentVersion:"ja2",automaticWrite:{...pub().automaticWrite,sourceId:"cms-ja",contentVersion:"ja2"}});
 assert.equal(save(translation,[t,plan,source],"record_publication").record.kind,"translation");
 assert.throws(()=>save({...translation,sourcePublicationId:"missing"},[t,plan],"record_publication"),/源文/);
});
test("existing blog optimization requires base version and pre-publish baseline, never counts as new",()=>{
 const t=save(task({kind:"optimization"}));
 const old={kind:"publication",record:{...pub(),id:"old",contentVersion:"v1",publishedAt:before,status:"verified"}};
 const update=pub({kind:"optimization",automaticWrite:{...pub().automaticWrite,operation:"update",baseContentVersion:"v1"}});
 assert.throws(()=>save(update,[t,plan,old],"record_publication"),/真实基线/);
 assert.equal(save(update,[t,plan,old,baseline()],"record_publication").record.kind,"optimization");
 assert.throws(()=>save({...update,automaticWrite:{...update.automaticWrite,baseContentVersion:"stale"}},[t,plan,old,baseline()],"record_publication"),/最新版本/);
 assert.equal(workflowPublicationSchema.safeParse({...update,kind:"source_blog"}).success,false);
 assert.equal(workflowPublicationSchema.safeParse({...update,automaticWrite:{...update.automaticWrite,baseContentVersion:null}}).success,false);
});
test("non-blog optimization still cannot bypass approval by selecting automatic policy",()=>{
 const url="https://flatkey.ai/gpu",t=save(task({kind:"optimization",pageType:"pricing",pageUrl:url}));
 assert.throws(()=>save(pub({kind:"optimization",pageUrl:url}),[t,plan,baseline()],"record_publication"),/真实博客|真实页面/);
 const manual=pub({kind:"optimization",pageUrl:url});delete manual.publicationPolicy;delete manual.automaticWrite;
 assert.equal(workflowPublicationSchema.safeParse(manual).success,false);
 assert.throws(()=>save({...manual,approvalId:"absent",approvalItemId:"absent"},[t],"record_publication"),/审批单/);
});
test("legacy pending blog tickets stay immutable history but disappear from actionable counts",()=>{
 const blog=save(task({status:"review_pending"})),landing=save(task({id:"landing-task",kind:"landing",pageType:"landing",pageUrl:"https://flatkey.ai/gpu",status:"review_pending"}));
 const a={kind:"approval",record:{id:"ticket",weekStart:"2026-11-09",siteDomain:"flatkey.ai",status:"pending",items:[{id:"blog-item",taskId:"blog-task",pageUrl:blog.record.pageUrl,language:"en"},{id:"landing-item",taskId:"landing-task",pageUrl:landing.record.pageUrl,language:"en"}],decisions:[],supersedesApprovalIds:[]}};
 const beforeJSON=JSON.stringify(a),view=workflowSnapshot([blog,landing,a],{week:"2026-11-09"},"database",now);
 assert.equal(view.summary.pendingApprovalItems,0);assert.equal(view.summary.pendingApprovals,0);assert.equal(view.summary.reviewPending,1);assert.equal(JSON.stringify(a),beforeJSON);
 assert.equal(approvalItemNeedsHuman(a.record.items[0],[blog.record,landing.record]),false);
});

test("explicit human target does not need an additional weekly approval; collector cannot forge it",()=>{
 const record=task({source:"human"});assert.throws(()=>save(record),/人工来源/);
 const prepared=prepareWorkflowMutation({requestId:"human-target",action:"save_task",expectedVersion:0,record},[],"human",now);
 const human={kind:prepared.kind,record:prepared.record};
 assert.equal(save(pub(),[human],"record_publication").record.publicationPolicy,"auto_blog");
});
