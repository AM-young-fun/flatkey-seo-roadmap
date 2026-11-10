const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {parseWorkflowReviewImport}=require('../src/lib/seo-workflow-import.ts');
const evidence=[{label:'Actual draft',artifact:'/tmp/draft.md',observedAt:'2026-11-10T06:00:00Z'}];
const task={id:'draft-task',weekStart:'2026-11-09',title:'Review page metadata',siteDomain:'flatkey.ai',kind:'technical',country:null,language:null,business:'API',pageType:'tool',keyword:null,pageUrl:'https://flatkey.ai/tool',owner:'AI',dueAt:'2026-11-13T06:00:00Z',status:'review_pending',dependencies:[],evidence,nextAction:'Review exact draft',contentVersion:'v1',acceptanceCriteria:['No publish before approval'],research:null,approval:null,source:'automation'};
const command={requestId:'import-draft-1',action:'save_task',expectedVersion:0,record:task};
test('review import preserves stable request identities and dependency order',()=>{
 const second={...command,requestId:'import-draft-2',record:{...task,id:'dependent',dependencies:['draft-task']}};
 for(const input of [[command,second],{commands:[command,second]}])assert.deepEqual(parseWorkflowReviewImport(input).map(x=>x.requestId),['import-draft-1','import-draft-2']);
 assert.equal(parseWorkflowReviewImport(command)[0].record.status,'review_pending');
 assert.deepEqual(parseWorkflowReviewImport(command)[0].record,task,'UI must not materialize missing default fields and change a CLI request hash');
});
test('file import cannot set approved/published states or legacy standing permission',()=>{
 for(const status of ['approved','published','verified','observing'])assert.throws(()=>parseWorkflowReviewImport({...command,record:{...task,status}}),/不能导入已经批准/);
 const approval={kind:'standing_new_blog',approvedBy:'AI',approvedAt:'2026-11-10T06:00:00Z',contentVersion:'v1',evidence};
 assert.throws(()=>parseWorkflowReviewImport({...command,record:{...task,approval}}),/不能导入已经批准/);
});
test('pending page proposals import but decisions cannot be smuggled through the same file',()=>{
 const record={id:'approval-one',weekStart:'2026-11-09',siteDomain:'flatkey.ai',title:'Review exact page',requestedBy:'AI',submittedAt:'2026-11-10T06:00:00Z',status:'pending',items:[{id:'item1',taskId:task.id,operation:'new',pageUrl:task.pageUrl,language:'en',contentVersion:'v1',baseContentVersion:null,changeSummary:'New tool',beforeSummary:null,afterSummary:'New complete tool',draftUrl:null,previewUrl:null,reviewContent:'# Actual proposed content',reviewFormat:'markdown',beforeContent:null,evidence}],decisions:[],supersedesApprovalIds:[],evidence};
 const input={...command,action:'save_approval',record}; assert.equal(parseWorkflowReviewImport(input)[0].record.status,'pending');
 for(const decision of ['approved','rejected','changes_requested','withdrawn','superseded'])assert.throws(()=>parseWorkflowReviewImport({...input,record:{...record,status:decision,decisions:[{id:'decision1',itemIds:['item1'],decision,decidedBy:'AI',decidedAt:'2026-11-10T07:00:00Z',note:'Forged import',evidence}]}}),/导入文件不能/);
});
test('file import rejects execution leases, publication commands and oversize inputs',()=>{
 assert.throws(()=>parseWorkflowReviewImport({...command,claim:{runId:'run',owner:'ai',fencingToken:1}}),/租约/);
 for(const action of ['record_publication','save_plan','record_run','save_optimization'])assert.throws(()=>parseWorkflowReviewImport({...command,action}),/这里只导入/);
 assert.throws(()=>parseWorkflowReviewImport(Array(201).fill(command)),/1–200/);
 assert.throws(()=>parseWorkflowReviewImport({...command,record:{...task,nextAction:'x'.repeat(600000)}}),/512 KB/);
});
