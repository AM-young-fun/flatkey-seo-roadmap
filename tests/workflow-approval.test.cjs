const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const { prepareWorkflowMutation, checkWorkflowApproval, workflowSnapshot } = require('../src/lib/seo-workflow-state.ts');
const { workflowApprovalSchema, workflowApprovalStatus } = require('../src/lib/seo-workflow.ts');
const time = new Date('2026-11-10T08:00:00Z'), evidence=[{label:'Visible draft and review',url:'https://flatkey.ai/preview',observedAt:'2026-11-10T06:00:00Z'}];
const task={id:'review-task',weekStart:'2026-11-09',siteDomain:'flatkey.ai',title:'Review model API page',kind:'blog',country:'US',language:'en',business:'API',pageType:'blog',keyword:'model api',pageUrl:'https://flatkey.ai/blog/review',owner:'AI',dueAt:'2026-11-10T09:00:00Z',status:'review_pending',dependencies:[],evidence,nextAction:'Review exact draft',contentVersion:'v1',acceptanceCriteria:['Reviewed exact version'],research:{volume:20,kd:10,businessValue:3,exceptionReason:null,intent:'API integration',observedAt:'2026-11-10T06:00:00Z',evidence},approval:null,source:'automation'};
const item=(patch={})=>({id:'item-en',taskId:task.id,operation:'new',pageUrl:task.pageUrl,language:'en',contentVersion:'v1',baseContentVersion:null,changeSummary:'Create exact page and title/meta',beforeSummary:null,afterSummary:'Full new draft',draftUrl:null,previewUrl:"https://staging-website.flatkey.ai/review",previewContentVersion:patch.contentVersion??"v1",reviewContent:'# Full reviewer-visible draft\nVerified API instructions.',reviewFormat:'markdown',beforeContent:null,evidence:[...evidence,{label:"Desktop screenshot",url:"https://staging-website.flatkey.ai/review.jpg",observedAt:"2026-11-10T06:00:00Z"},{label:"Mobile screenshot",url:"https://staging-website.flatkey.ai/mobile.jpg",observedAt:"2026-11-10T06:00:00Z"}],...patch});
const approval=(patch={})=>({id:'approval-main',weekStart:'2026-11-09',siteDomain:'flatkey.ai',title:'Review two language pages',requestedBy:'AI',submittedAt:'2026-11-10T07:00:00Z',status:'pending',items:[item(),item({id:'item-ja',language:'ja',pageUrl:'https://flatkey.ai/ja/blog/review',contentVersion:'v1-ja'})],decisions:[],supersedesApprovalIds:[],evidence,...patch});
const decision=(patch={})=>({id:'decision-1',itemIds:['item-en'],decision:'approved',decidedBy:'负责人',decidedAt:'2026-11-10T08:00:00Z',note:'Read exact text and version',evidence,...patch});
const inputRecord = record => { const raw=Object.fromEntries(Object.entries(record).filter(([key])=>!["version","recordedAt","updatedAt","submittedRecordedAt"].includes(key))); if(raw.decisions)raw.decisions=raw.decisions.map(decision=>Object.fromEntries(Object.entries(decision).filter(([key])=>key!=="recordedAt")));return raw; };
function mutate(record,all,action='save_approval',actor='human',expectedVersion=0,at=time){const result=prepareWorkflowMutation({requestId:'request-'+Math.random().toString(36).slice(2),action,expectedVersion,record},all,actor,at);return {kind:result.kind,record:result.record};}
function setup(){const taskRow=mutate(task,[],'save_task');const pending=mutate(approval(),[taskRow],'save_approval','collector');return {taskRow,pending,all:[taskRow,pending]};}
function decide(pending,all,decisions=[decision()],actor='human'){const raw={...inputRecord(pending.record),decisions};raw.status=workflowApprovalStatus(decisions,raw.items);return mutate(raw,all,'save_approval',actor,pending.record.version);}
const check=(patch={})=>({approvalId:'approval-main',itemId:'item-en',taskId:task.id,pageUrl:task.pageUrl,language:'en',contentVersion:'v1',...patch});
const publication=(patch={})=>({id:'pub-en',taskId:task.id,approvalId:'approval-main',approvalItemId:'item-en',weekStart:'2026-11-09',runId:'run-blog',siteDomain:'flatkey.ai',pageUrl:task.pageUrl,country:'US',language:'en',keyword:'model api',contentVersion:'v1',title:'Model API',kind:'source_blog',sourcePublicationId:null,publishedAt:'2026-11-10T08:00:00Z',verifiedAt:null,status:'published',liveCheck:null,evidence,failureReason:null,...patch});

test('collector can submit visible drafts but cannot decide or forge old standing permission',()=>{
 const {all,pending}=setup();assert.throws(()=>decide(pending,all,[decision()],'collector'),/负责人登录/);
 assert.throws(()=>checkWorkflowApproval(check(),all,time),/尚未批准/);
 const legacy={...all[0],record:{...all[0].record,status:'approved',approval:{kind:'standing_new_blog',approvedBy:'old-standing',approvedAt:'2026-11-09T00:00:00Z',contentVersion:'v1',evidence}}};
 assert.throws(()=>mutate(publication(),[legacy],'record_publication','collector'),/缺少已提交/);
 assert.equal(workflowApprovalSchema.safeParse(approval({items:[item({reviewContent:null,previewUrl:null})]})).success,false,'local artifact evidence is not a remotely reviewable draft');
});
test('decisions apply to exact selected language page and task/version, never the whole batch implicitly',()=>{
 const {all,pending,taskRow}=setup(),approved=decide(pending,all),rows=[taskRow,approved];
 assert.equal(approved.record.status,'partially_reviewed');assert.equal(checkWorkflowApproval(check(),rows,time).allowed,true);
 assert.throws(()=>checkWorkflowApproval(check({itemId:'item-ja',pageUrl:'https://flatkey.ai/ja/blog/review',language:'ja',contentVersion:'v1-ja'}),rows,time),/尚未批准/);
 for(const patch of [{contentVersion:'v2'},{pageUrl:'https://flatkey.ai/blog/else'},{language:'pt-BR'},{taskId:'another'}])assert.throws(()=>checkWorkflowApproval(check(patch),rows,time),/不匹配/);
 const snapshot=workflowSnapshot(rows,{week:'2026-11-16'},'database',time);assert.equal(snapshot.approvals.length,1);assert.equal(snapshot.summary.pendingApprovalItems,1);
});
test('submitted content and stored decisions are immutable; optimistic versions reject stale review',()=>{
 const {all,pending,taskRow}=setup();
 assert.throws(()=>mutate({...inputRecord(pending.record),items:[item({reviewContent:'Changed draft'}),item({id:'item-ja',language:'ja',pageUrl:'https://flatkey.ai/ja/blog/review',contentVersion:'v1-ja'})]},all,'save_approval','collector',1),/不可改写/);
 const approved=decide(pending,all),rows=[taskRow,approved];
 assert.throws(()=>mutate({...inputRecord(approved.record),decisions:[decision({note:'Rewrite human decision'})]},rows,'save_approval','human',2),/只能追加/);
 assert.throws(()=>decide(pending,rows),/其他任务/);
 assert.equal(approved.record.decisions[0].recordedAt,time.toISOString());
});
test('reject or request changes requires a new version; superseding a draft invalidates earlier permission immediately',()=>{
 const {all,pending,taskRow}=setup(),approved=decide(pending,all),rows=[taskRow,approved];
 const taskV2={...taskRow,record:{...taskRow.record,contentVersion:'v2'}};
 const revised=approval({id:'approval-v2',items:[item({contentVersion:'v2',reviewContent:'New exact draft'})],supersedesApprovalIds:['approval-main']});
 const next=mutate(revised,[taskV2,approved],'save_approval','collector');
 assert.throws(()=>checkWorkflowApproval(check(),[taskV2,approved,next],time),/被新稿替换/);
 const declined=decide(next,[taskV2,approved,next],[decision({id:'reject-v2',decision:'changes_requested'})]);
 assert.throws(()=>checkWorkflowApproval(check(),[taskV2,approved,declined],time),/被新稿替换/,'rejection cannot resurrect old permission');
 assert.throws(()=>decide(declined,[taskV2,approved,declined],[...inputRecord(declined.record).decisions,decision({id:'approve-after-change'})]),/新建稿件版本/);
 assert.throws(()=>mutate(approval({id:'duplicate-v1'}),rows,'save_approval','collector'),/该页面语言版本已有审批/);
 assert.throws(()=>mutate({...revised,supersedesApprovalIds:[]},[taskV2,approved],'save_approval','collector'),/明确替换/);
});
test('withdrawal blocks new publication but does not erase an already accepted historical receipt',()=>{
 const {all,pending,taskRow}=setup(),approved=decide(pending,all),rows=[taskRow,approved];
 const published=mutate(publication(),rows,'record_publication','collector');
 const withdrawn=decide(approved,rows,[...inputRecord(approved.record).decisions,decision({id:'withdraw',decision:'withdrawn'})]);
 assert.throws(()=>mutate(publication({id:'another'}),[taskRow,withdrawn],'record_publication','collector'),/撤回/);
 const verified={...publication(),status:'verified',verifiedAt:'2026-11-10T08:00:00Z',liveCheck:{checkedAt:'2026-11-10T08:00:00Z',httpStatus:200,canonicalUrl:task.pageUrl,language:'en',contentVersion:'v1',contentMatched:true,linksChecked:true,sourceReceipt:'live-proof',evidence}};
 assert.equal(mutate(verified,[taskRow,withdrawn,published],'record_publication','collector',1).record.status,'verified');
 assert.throws(()=>mutate(publication({publishedAt:'2026-11-10T07:59:59Z'}),rows,'record_publication','collector'),/不能早于/);
});
test('task version changes and stale update baselines invalidate publication preflight',()=>{
 const {all,pending,taskRow}=setup(),approved=decide(pending,all);
 assert.throws(()=>checkWorkflowApproval(check(),[{...taskRow,record:{...taskRow.record,contentVersion:'changed'}},approved],time),/任务不一致/);
 const existing={kind:'publication',record:{...publication({id:'old-pub',contentVersion:'v0'}),version:1,recordedAt:time.toISOString(),updatedAt:time.toISOString()}};
 assert.throws(()=>checkWorkflowApproval(check(),[taskRow,approved,existing],time),/改前版本/);
});

test('all ten existing blog locales require individual approval without fabricating keyword markets',()=>{
 const taskRow=mutate(task,[],'save_task');
 const locales=['en','zh','ja','ko','de','fr','es','pt','ru','vi'];
 const items=locales.map(locale=>item({id:'locale-'+locale,language:locale,pageUrl:locale==='en'?task.pageUrl:'https://flatkey.ai/'+locale+'/blog/review',contentVersion:locale==='en'?'v1':'v1-'+locale}));
 const pending=mutate(approval({items}),[taskRow],'save_approval','collector');
 const approved=decide(pending,[taskRow,pending],[decision({itemIds:items.map(item=>item.id)})]);
 const rows=[taskRow,approved];
 for(const locale of locales){const item=items.find(item=>item.language===locale);const receipt=publication({id:'pub-'+locale,approvalItemId:item.id,pageUrl:item.pageUrl,language:locale,contentVersion:item.contentVersion,country:locale==='en'?'US':null,keyword:locale==='en'?'model api':null,kind:locale==='en'?'source_blog':'translation',sourcePublicationId:locale==='en'?null:'pub-en'});rows.push(mutate(receipt,rows,'record_publication','collector'));}
 assert.equal(rows.filter(row=>row.kind==='publication').length,10);
 assert.equal(rows.filter(row=>row.kind==='publication'&&row.record.country===null).length,9);
 const wrong=publication({id:'unapproved-locale',approvalItemId:'locale-zh',language:'zh',country:'US',keyword:'model api'});
 assert.throws(()=>mutate(wrong,rows,'record_publication','collector'),/国家与语言不一致/);
});
test('technical metadata/canonical changes also require concrete per-page approval without invented search markets',()=>{
 const technical={...task,id:'technical-task',kind:'technical',pageType:'technical',country:null,language:null,keyword:null,contentVersion:'technical-v2',research:null};
 const taskRow=mutate(technical,[],'save_task');
 const exact=item({taskId:technical.id,operation:'update',baseContentVersion:'technical-v1',contentVersion:'technical-v2',beforeSummary:'Incorrect canonical',afterSummary:'Self-referential canonical',reviewFormat:'diff',reviewContent:'- canonical old\n+ canonical correct'});
 const pending=mutate(approval({items:[exact]}),[taskRow],'save_approval','collector');
 assert.throws(()=>mutate(publication({taskId:technical.id,kind:'optimization',country:null,keyword:null,contentVersion:'technical-v2'}),[taskRow,pending],'record_publication','collector'),/尚未批准/);
 const approved=decide(pending,[taskRow,pending]);
 assert.equal(mutate(publication({taskId:technical.id,kind:'optimization',country:null,keyword:null,contentVersion:'technical-v2'}),[taskRow,approved],'record_publication','collector').record.status,'published');
});


test('new localized tool pages keep their actual locale and count as landing pages instead of optimizations',()=>{
 const technical={...task,id:'localized-tool',kind:'technical',pageType:'tool',country:null,language:null,keyword:null,contentVersion:'tool-fr-v1',research:null,pageUrl:'https://flatkey.ai/fr/tools/calculator'};
 const taskRow=mutate(technical,[],'save_task');
 const exact=item({taskId:technical.id,pageUrl:technical.pageUrl,language:'fr',contentVersion:technical.contentVersion,operation:'new',baseContentVersion:null});
 const pending=mutate(approval({items:[exact]}),[taskRow],'save_approval','collector'),approved=decide(pending,[taskRow,pending]);
 const value=publication({taskId:technical.id,kind:'landing',pageUrl:technical.pageUrl,language:'fr',country:null,keyword:null,contentVersion:technical.contentVersion});
 const receipt=mutate(value,[taskRow,approved],'record_publication','collector');assert.equal(receipt.record.kind,'landing');
 assert.throws(()=>mutate({...value,kind:'optimization'},[taskRow,approved],'record_publication','collector'),/新增交付/);
});

test('missing staging URL or screenshot blocks both approval and old approved publication preflight',()=>{
 for(const patch of [{previewUrl:null},{previewUrl:task.pageUrl},{evidence}]) {
  const taskRow=mutate(task,[],'save_task');
  const pending=mutate(approval({items:[item(patch)]}),[taskRow],'save_approval','collector');
  assert.throws(()=>decide(pending,[taskRow,pending]),/批准前须补齐/);
  const legacy={...pending,record:{...pending.record,status:'approved',decisions:[{...decision(),recordedAt:time.toISOString()}]}};
  assert.throws(()=>checkWorkflowApproval(check(),[taskRow,legacy],time),/发布前须补齐/);
 }
});
