const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { automaticPageRoute, automaticTaskPolicy, workflowPublicationSchema, approvalItemNeedsHuman } = require("../src/lib/seo-workflow.ts");
const { prepareWorkflowMutation, workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
const now = new Date("2026-11-12T05:00:00Z"), before="2026-11-12T03:00:00Z", publishedAt="2026-11-12T04:00:00Z", evidence=[{label:"Fixture exact version",artifact:"fixture.json",observedAt:before}];
const task = (patch={})=>({id:"blog-task",weekStart:"2026-11-09",title:"算力租赁说明",brief:require("./fixtures/chinese-task-brief.cjs")(evidence),siteDomain:"flatkey.ai",kind:"blog",pageType:"blog",pageUrl:"https://flatkey.ai/blog/gpu-rental",country:"US",language:"en",keyword:"gpu rental",business:"GPU",owner:"AI",dueAt:publishedAt,status:"drafting",dependencies:[],contentVersion:"v2",evidence,nextAction:"按原稿版本执行发布",acceptanceCriteria:["核对精确稿件版本"],research:{volume:20,kd:5,businessValue:3,exceptionReason:null,intent:"rental",observedAt:before,evidence},source:"automation",...patch});
const save=(record,all=[],action="save_task",version=0)=>{const r=prepareWorkflowMutation({requestId:"fixture-write",action,expectedVersion:version,record},all,"collector",now);return {kind:r.kind,record:r.record};};
const plan={kind:"plan",record:{id:"weekly",weekStart:"2026-11-09",status:"reviewed",taskIds:["blog-task"]}};
const pub=(patch={})=>({id:"pub",taskId:"blog-task",approvalId:null,approvalItemId:null,publicationPolicy:"auto_blog",automaticWrite:{operation:"create",sourceId:"cms-id",baseContentVersion:null,contentVersion:"v2",publishedAt,verifiedAt:"2026-11-12T04:00:02Z",receipt:"cms-receipt.json"},weekStart:"2026-11-09",runId:"BLOG:fixture",siteDomain:"flatkey.ai",pageUrl:"https://flatkey.ai/blog/gpu-rental",country:"US",language:"en",keyword:"gpu rental",contentVersion:"v2",title:"GPU rental",kind:"source_blog",sourcePublicationId:null,publishedAt,verifiedAt:null,status:"published",liveCheck:null,evidence,failureReason:null,...patch});
const baseline=()=>({kind:"optimization",record:{id:"opt",taskId:"blog-task",pageUrl:"https://flatkey.ai/blog/gpu-rental",baseline:{capturedAt:before}}});

for(const domain of ["flatkey.ai","modelfit.cc"])test(`first-delivery correction on ${domain} preserves its task and source receipt`,()=>{
 const page=`https://${domain}/blog/gpu-rental`;
 const makeTask=patch=>task({...patch,siteDomain:domain,pageUrl:page});
 const makePub=patch=>pub({...patch,siteDomain:domain,pageUrl:page});
 const sourceTask=save(makeTask({contentVersion:"v1"}));
 const source=save(makePub({id:"source",contentVersion:"v1",automaticWrite:{...pub().automaticWrite,contentVersion:"v1"}}),[sourceTask,plan],"record_publication");
 const live=save(makeTask({contentVersion:"v1",status:"published"}),[sourceTask,plan,source],"save_task",sourceTask.record.version);
 const update=makePub({id:"correction",kind:"optimization",automaticWrite:{...pub().automaticWrite,operation:"update",baseContentVersion:"v1"}});
 // The accepted, exact CMS source receipt is the pre-correction baseline;
 // a just-published page must not fabricate an analytics/optimization task.
 const rows=[live,plan,source];
 assert.throws(()=>save(update,[live,plan],"record_publication"));
 const correction=save(update,rows,"record_publication");
 const current=save(makeTask({contentVersion:"v2",status:"published"}),[...rows,correction],"save_task",live.record.version);
 assert.equal(current.record.id,"blog-task");assert.equal(current.record.kind,"blog");
 assert.equal(source.record.contentVersion,"v1");assert.equal(source.record.kind,"source_blog");
 assert.equal(correction.record.kind,"optimization");
 assert.equal([...rows,correction].filter(r=>r.kind==="publication"&&r.record.kind==="source_blog").length,1);
 // A previously accepted correction remains writable while verification is
 // pending, even after the task has adopted the new content version.
 assert.equal(save({...update,evidence:[...evidence,{label:"Latest exact CMS version",artifact:"new.json",observedAt:before}]},[current,plan,source,correction],"record_publication",correction.record.version).record.contentVersion,"v2");
 const checked={...update,status:"verified",verifiedAt:now.toISOString(),liveCheck:{checkedAt:now.toISOString(),httpStatus:200,canonicalUrl:page,language:"en",contentVersion:"v2",contentMatched:true,linksChecked:true,sourceReceipt:"actual-cms-revision",evidence}};
 const verified=save(checked,[current,plan,source,correction],"record_publication",correction.record.version);
 const completed=save(makeTask({contentVersion:"v2",status:"verified"}),[current,plan,source,verified],"save_task",current.record.version);
 assert.equal(completed.record.status,"verified");
 const summary=workflowSnapshot([completed,source,verified],{week:"2026-11-09"},"database",now).summary;
 assert.equal(summary.verifiedSourceBlogs,1);assert.equal(summary.optimizedPages,0);
 assert.equal(source.record.status,"published");
 for(const patch of [{sourceId:"other-cms"},{baseContentVersion:"stale"}])assert.throws(()=>save({...update,automaticWrite:{...update.automaticWrite,...patch}},rows,"record_publication"));
 assert.throws(()=>save(update,[{...live,record:{...live.record,status:"verified"}},plan,source],"record_publication"));
 assert.throws(()=>save(update,[live,plan,{...source,record:{...source.record,status:"verified"}}],"record_publication"));
 assert.throws(()=>save(update,[{...live,record:{...live.record,keyword:"other intent"}},plan,source],"record_publication"));
});

test("an unverified first-delivery translation can record its exact CMS correction without changing the source",()=>{
 const t=save(task({contentVersion:"v1"}));
 const source=save(pub({id:"source",contentVersion:"v1",automaticWrite:{...pub().automaticWrite,contentVersion:"v1"}}),[t,plan],"record_publication");
 const live=save(task({contentVersion:"v1",status:"published"}),[t,plan,source],"save_task",t.record.version);
 const page="https://flatkey.ai/ja/blog/gpu-rental";
 const first=pub({id:"ja-first",kind:"translation",sourcePublicationId:"source",country:null,language:"ja",keyword:null,pageUrl:page,contentVersion:"ja1",automaticWrite:{...pub().automaticWrite,sourceId:"cms-ja",contentVersion:"ja1"}});
 const translation=save(first,[live,plan,source],"record_publication");
 const update={...first,id:"ja-correction",kind:"optimization",sourcePublicationId:null,contentVersion:"ja2",automaticWrite:{...first.automaticWrite,operation:"update",baseContentVersion:"ja1",contentVersion:"ja2"}};
 const rows=[live,plan,source,translation];
 const corrected=save(update,rows,"record_publication");
 assert.equal(corrected.record.taskId,live.record.id);
 assert.equal(translation.record.sourcePublicationId,"source");
 assert.equal(live.record.contentVersion,"v1");assert.equal(source.record.contentVersion,"v1");
 assert.equal([...rows,corrected].filter(r=>r.kind==="publication"&&r.record.kind==="translation").length,1);
 for(const patch of [{sourcePublicationId:"foreign"},{language:"fr"},{pageUrl:"https://flatkey.ai/fr/blog/gpu-rental"}])assert.throws(()=>save({...update,...patch},rows,"record_publication"));
 assert.throws(()=>save(update,[{...live,record:{...live.record,status:"verified"}},plan,source,translation],"record_publication"));
 assert.throws(()=>save(update,[live,plan,source,{...translation,record:{...translation.record,status:"verified"}}],"record_publication"));
 assert.throws(()=>save(update,[live,plan,{...source,record:{...source.record,status:"failed"}},translation],"record_publication"));
 const backdated={...update,publishedAt:before,automaticWrite:{...update.automaticWrite,publishedAt:before}};
 assert.throws(()=>save(backdated,rows,"record_publication"));
});

for(const translation of [false,true])test(`mixed ISO offsets use the latest exact ${translation?"translation":"source"} baseline`,()=>{
 const t=save(task({contentVersion:"v1"}));
 const firstTime="2026-11-12T12:00:00+08:00",secondTime="2026-11-12T04:30:00Z",thirdTime="2026-11-12T04:40:00Z";
 const sourceRecord=pub({id:"source",contentVersion:"v1",publishedAt:firstTime,automaticWrite:{...pub().automaticWrite,contentVersion:"v1",publishedAt:firstTime}});
 const source=save(sourceRecord,[t,plan],"record_publication");
 const live=save(task({contentVersion:"v1",status:"published"}),[t,plan,source],"save_task",t.record.version);
 const target=translation?{country:null,language:"ja",keyword:null,pageUrl:"https://flatkey.ai/ja/blog/gpu-rental"}:{};
 const original=translation?save(pub({...target,id:"ja-first",kind:"translation",sourcePublicationId:"source",contentVersion:"ja1",publishedAt:firstTime,automaticWrite:{...pub().automaticWrite,sourceId:"cms-ja",contentVersion:"ja1",publishedAt:firstTime}}),[live,plan,source],"record_publication"):source;
 const oldVersion=translation?"ja1":"v1",secondVersion=translation?"ja2":"v2",thirdVersion=translation?"ja3":"v3";
 const initial=[live,plan,source,...(translation?[original]:[])];
 const second=pub({...target,id:"correction2",kind:"optimization",contentVersion:secondVersion,publishedAt:secondTime,automaticWrite:{...pub().automaticWrite,sourceId:translation?"cms-ja":"cms-id",operation:"update",baseContentVersion:oldVersion,contentVersion:secondVersion,publishedAt:secondTime,verifiedAt:secondTime}});
 const correction=save(second,initial,"record_publication");
 const current=translation?live:save(task({contentVersion:secondVersion,status:"published"}),[...initial,correction],"save_task",live.record.version);
 const rows=[current,plan,source,...(translation?[original]:[]),correction];
 const next={...second,id:"correction3",contentVersion:thirdVersion,publishedAt:thirdTime,automaticWrite:{...second.automaticWrite,baseContentVersion:secondVersion,contentVersion:thirdVersion,publishedAt:thirdTime,verifiedAt:thirdTime}};
 assert.equal(save(next,rows,"record_publication").record.contentVersion,thirdVersion);
 assert.throws(()=>save({...next,automaticWrite:{...next.automaticWrite,baseContentVersion:oldVersion}},rows,"record_publication"));
});

test("misclassified unverified translation keeps failed audit history and an exact original/revision chain",()=>{
 const t=save(task({contentVersion:"v1"}));
 const source=save(pub({id:"source",contentVersion:"v1",automaticWrite:{...pub().automaticWrite,contentVersion:"v1"}}),[t,plan],"record_publication");
 const live=save(task({contentVersion:"v1",status:"published"}),[t,plan,source],"save_task",t.record.version);
 const page="https://flatkey.ai/ja/blog/gpu-rental";
 const make=(patch={})=>pub({country:null,language:"ja",keyword:null,pageUrl:page,kind:"translation",sourcePublicationId:"source",contentVersion:"ja2",automaticWrite:{...pub().automaticWrite,sourceId:"cms-ja",contentVersion:"ja2"},...patch});
 const wrong=make({id:"wrong-create"});const savedWrong=save(wrong,[live,plan,source],"record_publication");
 const failed=save({...wrong,status:"failed",failureReason:"Recorded corrected hash as create; actual initial and update receipts retained",evidence},[live,plan,source,savedWrong],"record_publication",savedWrong.record.version);
 assert.equal(failed.record.contentVersion,"ja2");assert.equal(failed.record.automaticWrite.operation,"create");
 const initial=save(make({id:"actual-initial",contentVersion:"ja1",automaticWrite:{...wrong.automaticWrite,contentVersion:"ja1"}}),[live,plan,source,failed],"record_publication");
 const corrected=make({id:"actual-update",kind:"optimization",sourcePublicationId:null,automaticWrite:{...wrong.automaticWrite,operation:"update",baseContentVersion:"ja1"}});
 const rows=[live,plan,source,failed,initial];
 const update=save(corrected,rows,"record_publication");assert.equal(update.record.contentVersion,"ja2");
 assert.equal([...rows,update].filter(r=>r.kind==="publication"&&r.record.kind==="translation"&&r.record.status!=="failed").length,1);
 assert.throws(()=>save(corrected,[live,plan,source,savedWrong,initial],"record_publication"));
 for(const patch of [{taskId:"foreign"},{automaticWrite:{...failed.record.automaticWrite,sourceId:"other-cms"}},{failureReason:null},{status:"verified"},{verificationRecordedAt:before},{verifiedAt:before}])assert.throws(()=>save(corrected,[live,plan,source,{...failed,record:{...failed.record,...patch}},initial],"record_publication"));
 assert.throws(()=>save({...corrected,id:"another-update"},[...rows,update],"record_publication"));
 const checked={...corrected,status:"verified",verifiedAt:now.toISOString(),liveCheck:{checkedAt:now.toISOString(),httpStatus:200,canonicalUrl:page,language:"ja",contentVersion:"ja2",contentMatched:true,linksChecked:true,sourceReceipt:"actual-corrected-cms",evidence}};
 const verified=save(checked,[...rows,update],"record_publication",update.record.version);
 const summary=workflowSnapshot([...rows,verified],{week:"2026-11-09"},"database",now).summary;
 assert.equal(summary.verifiedTranslations,1);assert.equal(summary.optimizedPages,0);
});

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

 test("ModelFit US English CMS blog receipt preserves plan, route and version guards",()=>{
 const url="https://modelfit.cc/blog/cuda-out-of-memory";
 assert.equal(automaticPageRoute(url,"modelfit.cc"),"blog");
 for(const path of ["/calculator","/ja/blog/test","/en/blog/test","/prompts/image/test","/blog/test?x=1","//blog/test","/blog/test/"])assert.equal(automaticPageRoute("https://modelfit.cc"+path,"modelfit.cc"),null);
 assert.equal(automaticPageRoute("https://rackrate.org/blog/test","rackrate.org"),null);
 const t=save(task({siteDomain:"modelfit.cc",pageUrl:url}));
 const p=pub({siteDomain:"modelfit.cc",pageUrl:url});
 assert.throws(()=>save(p,[t],"record_publication"),/本周最新计划已排期/);
 assert.equal(save(p,[t,plan],"record_publication").record.siteDomain,"modelfit.cc");
 for(const patch of [{language:"ja"},{country:"JP"},{kind:"translation"},{pageUrl:"https://modelfit.cc/calculator"}])assert.equal(workflowPublicationSchema.safeParse({...p,...patch}).success,false);
 assert.equal(automaticTaskPolicy(task({siteDomain:"modelfit.cc",pageUrl:url,codeSource:{}})),null);
 });
