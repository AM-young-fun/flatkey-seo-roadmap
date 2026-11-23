const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const { prepareWorkflowMutation, checkWorkflowApproval, workflowSnapshot } = require('../src/lib/seo-workflow-state.ts');
const { workflowApprovalSchema, workflowApprovalStatus, workflowClusterRollbackCandidates, workflowReleaseCandidates } = require('../src/lib/seo-workflow.ts');
const time = new Date('2026-11-10T08:00:00Z'), evidence=[{label:'Visible draft and review',url:'https://flatkey.ai/preview',observedAt:'2026-11-10T06:00:00Z'}];
const task={id:'review-task',weekStart:'2026-11-09',siteDomain:'flatkey.ai',title:'模型接入页面优化',brief:require('./fixtures/chinese-task-brief.cjs')(evidence),kind:'blog',country:'US',language:'en',business:'API',pageType:'tutorial',keyword:'model api',pageUrl:'https://flatkey.ai/blog/review',owner:'AI',dueAt:'2026-11-10T09:00:00Z',status:'review_pending',dependencies:[],evidence,nextAction:'核对准确稿件版本',contentVersion:'v1',acceptanceCriteria:['核对精确稿件版本'],research:{volume:20,kd:10,businessValue:3,exceptionReason:null,intent:'API integration',observedAt:'2026-11-10T06:00:00Z',evidence},approval:null,source:'automation'};
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
test('ordinary CMS blogs cannot enter page review but a code-backed blog page can',()=>{
 const cms=mutate({...task,pageType:'blog',status:'drafting'},[],'save_task');
 assert.throws(()=>mutate(approval({items:[item()]}),[cms],'save_approval','collector'),/不需要提交页面审批/);
 const codeSource={repository:'example/website',branch:'seo/blog-layout',commitSha:'a'.repeat(40)};
 const previewUrl='https://staging-website.flatkey.ai/blog/review';
 const code=mutate({...task,pageType:'blog',codeSource,contentVersion:codeSource.commitSha,artifactUrl:previewUrl},[],'save_task');
 const submitted=mutate(approval({items:[item({codeSource,contentVersion:codeSource.commitSha,previewUrl})]}),[code],'save_approval','collector');
 assert.equal(submitted.record.status,'pending');
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
  const incomplete=approval({items:[item(patch)]});
  assert.throws(()=>mutate(incomplete,[taskRow],'save_approval','collector'),/送审前须补齐/);
  const pending={kind:'approval',record:{...incomplete,version:1,recordedAt:time.toISOString(),submittedRecordedAt:time.toISOString()}};
  assert.throws(()=>decide(pending,[taskRow,pending]),/批准前须补齐/);
  const legacy={...pending,record:{...pending.record,status:'approved',decisions:[{...decision(),recordedAt:time.toISOString()}]}};
  assert.throws(()=>checkWorkflowApproval(check(),[taskRow,legacy],time),/发布前须补齐/);
 }
});

test('an unreviewable legacy ticket can be replaced by the same unchanged version once material is complete',()=>{
 const { taskRow, pending } = setup();
 const original = pending.record.items[0];
 const legacy = { ...pending, record: { ...pending.record, items: [{ ...original, previewUrl: null }] } };
 const completed = approval({ id: 'recovery', supersedesApprovalIds: [pending.record.id], items: [original] });
 const replacement = mutate(completed, [taskRow, legacy], 'save_approval', 'collector');
 assert.equal(replacement.record.status, 'pending');
 assert.throws(()=>mutate({ ...completed, items: [{ ...original, reviewContent: 'Changed content' }] }, [taskRow, legacy], 'save_approval', 'collector'), /新版本/);
 assert.throws(()=>mutate(completed, [taskRow, pending], 'save_approval', 'collector'), /新版本/);
});

test('cluster review follows a verified production receipt and rejection queues only the exact current release',()=>{
 const branch={repository:'solvea-plg/rackrate',branch:'codex/provider-review',commitSha:'a'.repeat(40)};
 const page='https://rackrate.org/providers/flatkey';
 const change={...task,id:'cluster-task',siteDomain:'rackrate.org',business:'CLUSTER',kind:'technical',pageType:'technical',pageUrl:page,codeSource:branch,contentVersion:branch.commitSha,status:'drafting'};
 const taskRow=mutate(change,[],'save_task','collector');
 const live=publication({id:'cluster-pub',siteDomain:change.siteDomain,taskId:change.id,pageUrl:page,contentVersion:branch.commitSha,kind:'optimization',
   approvalId:null,approvalItemId:null,publicationPolicy:'cluster_post_review',clusterRelease:{codeSource:branch,mergeSha:'b'.repeat(40),deploymentUrl:'https://github.com/solvea-plg/rackrate/actions/runs/12'},
   status:'verified',verifiedAt:time.toISOString(),liveCheck:{checkedAt:time.toISOString(),httpStatus:200,canonicalUrl:page,language:'en',contentVersion:branch.commitSha,contentMatched:true,linksChecked:true,sourceReceipt:'production deploy 12',evidence}});
 const ticket=approval({id:'cluster-ticket',siteDomain:change.siteDomain,submittedAt:time.toISOString(),items:[item({id:'item-en',taskId:change.id,pageUrl:page,operation:'update',baseContentVersion:'old',beforeSummary:'Old page',codeSource:branch,contentVersion:branch.commitSha,previewUrl:null,previewContentVersion:null,postPublicationId:live.id})]});
 assert.throws(()=>mutate(ticket,[taskRow],'save_approval','collector'),/真实生产发布回执/);
 const liveRow=mutate(live,[taskRow],'record_publication','collector');
 const post=mutate(ticket,[taskRow,liveRow],'save_approval','collector');
 const rows=[taskRow,liveRow,post];
 const accepted=decide(post,rows);
 const toSnapshot=approval=>({tasks:[taskRow.record],publications:[liveRow.record],approvals:[approval.record],runs:[]});
 assert.deepEqual(workflowReleaseCandidates(toSnapshot(accepted)),[]);
 assert.deepEqual(workflowClusterRollbackCandidates(toSnapshot(accepted)),[]);
 const declined=decide(post,rows,[decision({decision:'rejected'})]);
 const snapshot=toSnapshot(declined);
 assert.equal(workflowClusterRollbackCandidates(snapshot)[0].release.mergeSha,'b'.repeat(40));
 assert.deepEqual(workflowClusterRollbackCandidates({...snapshot,publications:[...snapshot.publications,{...liveRow.record,id:'newer',publishedAt:'2026-11-10T08:01:00Z'}]}),[]);
 assert.deepEqual(workflowClusterRollbackCandidates({...snapshot,runs:[{id:'cluster-rollback:cluster-pub',status:'completed'}]}),[]);
 assert.throws(()=>mutate({...live,siteDomain:'flatkey.ai',pageUrl:task.pageUrl},[],'record_publication','collector'),/集群站先验收/);
 const clusterWork = review => [
   {...taskRow,record:{...taskRow.record,weekStart:"2026-11-16",source:"human",status:"verified"}},
   liveRow, review,
 ];
 const nextWeek = new Date("2026-11-23T02:15:00Z");
 const legacyWork = review => [taskRow, liveRow, review];
 const legacyReview = workflowSnapshot(legacyWork(post),{operational:true},"database",nextWeek);
 assert.deepEqual(legacyReview.tasks.map(t=>t.id),[change.id]);
 assert.equal(legacyReview.tasks[0].weekStart,'2026-11-09','retain original week instead of rescheduling');
 assert.deepEqual(legacyReview.workWeek.activeApprovalItems[post.record.id],["item-en"]);
 assert.equal(legacyReview.summary.pendingApprovalItems,1);
 assert.deepEqual(workflowSnapshot(legacyWork(accepted),{operational:true},"database",nextWeek).tasks,[]);
 for (const patch of [{status:'published'},{contentVersion:'other'},{taskId:'other'},{pageUrl:'https://rackrate.org/compare'},{language:'ja'},{id:'other'},{publicationPolicy:undefined}]) {
   const invalid=[taskRow,{...liveRow,record:{...liveRow.record,...patch}},post];
   assert.deepEqual(workflowSnapshot(invalid,{operational:true},"database",nextWeek).tasks,[],JSON.stringify(patch));
 }
 assert.deepEqual(workflowSnapshot([taskRow,post],{operational:true},"database",nextWeek).tasks,[]);
 for (const patch of [{contentVersion:'other'},{pageUrl:'https://rackrate.org/compare'},{language:'ja'},{siteDomain:'mochichatbot.com',pageUrl:'https://mochichatbot.com/'}]) {
   assert.deepEqual(workflowSnapshot([{...taskRow,record:{...taskRow.record,...patch}},liveRow,post],{operational:true},"database",nextWeek).tasks,[],JSON.stringify(patch));
 }
 assert.deepEqual(workflowSnapshot([{...taskRow,record:{...taskRow.record,deletedAt:time.toISOString()}},liveRow,post],{operational:true},"database",nextWeek).tasks,[]);
 const pendingReview = workflowSnapshot(clusterWork(post),{operational:true},"database",nextWeek);
 assert.deepEqual(pendingReview.workWeek.overdueTaskIds,[change.id]);
 assert.deepEqual(pendingReview.workWeek.activeApprovalItems[post.record.id],["item-en"]);
 const pendingRollback = workflowSnapshot(clusterWork(declined),{operational:true},"database",nextWeek);
 assert.deepEqual(pendingRollback.workWeek.pendingRollbackTaskIds,[change.id]);
 assert.deepEqual(workflowSnapshot(clusterWork(accepted),{operational:true},"database",nextWeek).tasks,[]);
 const rollbackReceipt = {kind:"run",record:{id:"cluster-rollback:cluster-pub",status:"completed"}};
 assert.deepEqual(workflowSnapshot([...clusterWork(declined),rollbackReceipt],{operational:true},"database",nextWeek).tasks,[]);
});

test("business work window carries original tasks and approvals across the Monday storage boundary", () => {
  const prior = "2026-11-09", first = "2026-11-16", next = "2026-11-23";
  const before = new Date("2026-11-22T15:59:59Z"), after = new Date("2026-11-22T16:00:00Z");
  const version = "a".repeat(40);
  const codeSource = { repository: "solvea-plg/flatkey", branch: "codex/carried-page", commitSha: version };
  const planned = (id, weekStart, patch = {}) => ({
    kind: "task",
    record: { ...task, id, weekStart, dueAt: weekStart + "T10:15:00+08:00", status: "ready",
      dependencies: [], version: 1, ...patch },
  });
  const old = planned("pre-cutover", prior);
  const done = planned("done", first, { status: "verified" });
  const carry = planned("carry", first, { kind: "landing", pageType: "landing", status: "review_pending",
    codeSource, artifactUrl: item().previewUrl, contentVersion: version, dependencies: [done.record.id], version: 4 });
  const fresh = planned("fresh", next);
  const candidate = planned("unscheduled", first);
  const plan = (weekStart, taskIds) => ({ kind: "plan", record: {
    id: "plan-" + weekStart, weekStart, taskIds, status: "scheduled", version: 1, updatedAt: weekStart + "T01:00:00Z",
  }});
  const cite = approval({
    weekStart: first, status: "approved", version: 3,
    items: [item({ id: "carried-item", taskId: "carry", codeSource, contentVersion: version })],
    decisions: [decision({ itemIds: ["carried-item"] })],
  });
  const rows = [old, done, carry, fresh, candidate, { kind: "approval", record: cite },
    plan(prior, [old.record.id]), plan(first, [done.record.id, carry.record.id]), plan(next, [fresh.record.id])];
  const sunday = workflowSnapshot(rows, { operational: true }, "database", before);
  assert.deepEqual(sunday.tasks.map(t => t.id), ["carry", "fresh"]);
  assert.deepEqual(workflowSnapshot(rows, { operational: true, workList: true }, "database", before).tasks.map(t => t.id), ["carry", "done", "fresh"]);
  assert.deepEqual(workflowSnapshot(rows, { operational: true, workList: true }, "database", after).tasks.map(t => t.id), ["carry", "done", "fresh"]);
  assert.deepEqual(sunday.workWeek.overdueTaskIds, ["carry"]);
  const monday = workflowSnapshot(rows, { operational: true }, "database", after);
  assert.equal(monday.weekStart, next);
  assert.deepEqual(monday.tasks.map(t => t.id), ["carry", "fresh"]);
  assert.deepEqual(monday.workWeek.overdueTaskIds, ["carry"]);
  assert.deepEqual(monday.workWeek.dependencyStatuses, { done: "verified" });
  assert.deepEqual(monday.workWeek.activeApprovalItems[cite.id], ["carried-item"]);
  assert.deepEqual(monday.tasks[0], carry.record);
  assert.deepEqual(monday.approvals[0], cite);
  assert.equal(workflowReleaseCandidates(monday)[0].codeSource.commitSha, version);
  const changed = rows.map(row => row === carry ? { ...row, record: {
    ...carry.record, branchObservation: { headSha: "b".repeat(40), observedAt: after.toISOString() },
  } } : row);
  const changedSnapshot = workflowSnapshot(changed, { operational: true }, "database", after);
  assert.deepEqual(changedSnapshot.workWeek.activeApprovalItems[cite.id], []);
  assert.deepEqual(workflowReleaseCandidates(changedSnapshot), []);
  const superseding = { kind: "approval", record: {
    ...cite, id: "inactive-replacement", status: "pending", decisions: [], supersedesApprovalIds: [cite.id],
    items: [{ ...cite.items[0], taskId: done.record.id, contentVersion: "replacement" }],
  } };
  assert.deepEqual(workflowReleaseCandidates(workflowSnapshot([...rows, superseding], { operational: true }, "database", after)), []);
  const shipped = { kind: "publication", record: publication({
    taskId: carry.record.id, weekStart: first, status: "verified", contentVersion: version,
  }) };
  assert.deepEqual(workflowSnapshot([...rows, shipped], { operational: true }, "database", after).tasks.map(t => t.id), ["fresh"]);
  assert.ok(workflowSnapshot(rows, { allHistory: true }, "database", after).tasks.some(t => t.id === old.record.id));
});

test("a future approved task visible in the business window cannot release before its exact due time", () => {
  const version = "c".repeat(40), dueAt = "2026-11-23T10:15:00+08:00";
  const codeSource = { repository: "solvea-plg/flatkey", branch: "codex/future-page", commitSha: version };
  const page = { ...task, weekStart: "2026-11-23", dueAt, codeSource, status: "approved",
    artifactUrl: item().previewUrl, contentVersion: version };
  const approved = approval({ weekStart: page.weekStart, status: "approved", items: [item({ codeSource, contentVersion: version })],
    decisions: [decision()] });
  const rows = [{ kind: "task", record: page }, { kind: "approval", record: approved },
    { kind: "plan", record: { id: "future-plan", weekStart: page.weekStart, status: "scheduled",
      version: 1, updatedAt: "2026-11-19T07:00:00Z", taskIds: [page.id] } }];
  for (const at of ["2026-11-20T02:15:00Z", "2026-11-23T02:14:59Z"]) {
    const snapshot = workflowSnapshot(rows, { operational: true }, "database", new Date(at));
    assert.deepEqual(snapshot.tasks.map(row => row.id), [page.id], "future work remains visible for planning");
    assert.deepEqual(workflowReleaseCandidates(snapshot), [], "visibility never authorizes early release");
  }
  const due = workflowSnapshot(rows, { operational: true }, "database", new Date(dueAt));
  assert.deepEqual(workflowReleaseCandidates(due).map(row => row.taskId), [page.id]);
});
