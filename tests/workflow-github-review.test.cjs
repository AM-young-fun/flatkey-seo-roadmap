const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {githubReviewBelongsToSite,pageBelongsToSite,workflowTaskSchema,workflowApprovalSchema,workflowPublicationSchema}=require('../src/lib/seo-workflow.ts');
const {prepareWorkflowMutation}=require('../src/lib/seo-workflow-state.ts');
const evidence=[{label:'Versioned diff',artifact:'/tmp/fixture-review.diff',observedAt:'2026-11-11T09:00:00Z'}];
const url='https://github.com/flatkey-ai/awesome-images';
const task={id:'github-fixture',weekStart:'2026-11-09',siteDomain:'flatkey.ai',channel:'github',title:'GitHub prompt attribution',kind:'technical',country:null,language:null,business:'API',pageType:'other',keyword:null,pageUrl:url,owner:'AI',dueAt:'2026-11-13T09:00:00Z',status:'drafting',dependencies:[],evidence,nextAction:'Review exact repository diff',contentVersion:'v2',acceptanceCriteria:['Exact version approved'],research:null,approval:null,source:'automation'};
const item={id:'github-item',taskId:task.id,operation:'update',pageUrl:url,language:'en',contentVersion:'v2',baseContentVersion:'v1',changeSummary:'Repository UTM attribution',beforeSummary:'Missing repository campaign',afterSummary:'Repository campaign added',draftUrl:null,previewUrl:null,reviewContent:'- old link\n+ new attributed link',reviewFormat:'diff',beforeContent:null,evidence};
const approval={id:'github-approval',weekStart:'2026-11-09',siteDomain:'flatkey.ai',channel:'github',title:'GitHub review draft',requestedBy:'AI',submittedAt:null,status:'draft',items:[item],decisions:[],supersedesApprovalIds:[],evidence};
test('only exact GitHub owned repository path boundaries are accepted for review',()=>{
 for(const valid of [url,url+'/',url+'/blob/main/README.md','https://github.com/flatkey-ai/awesome-seedance-prompts'])assert.equal(githubReviewBelongsToSite(valid,'flatkey.ai'),true);
 for(const bad of ['http://github.com/flatkey-ai/awesome-images','https://user@github.com/flatkey-ai/awesome-images','https://github.com.evil.test/flatkey-ai/awesome-images','https://www.github.com/flatkey-ai/awesome-images','https://github.com/flatkey-ai/awesome-images-evil','https://github.com/flatkey-ai/awesome-images2/README.md','https://github.com/other/awesome-images','https://github.com/flatkey-ai/awesome-images/../../other/repo','https://github.com/flatkey-ai/awesome-images%2fevil',url+'?redirect=outside',url+'#readme',url.replace('github.com','github.com:444')])assert.equal(githubReviewBelongsToSite(bad,'flatkey.ai'),false,bad);
 assert.equal(githubReviewBelongsToSite(url,'modelfit.cc'),false);
 for(const suffix of ['/%2e%2e%2fother-repo','/%252e%252e%252fother-repo','/%5c..%5cother-repo'])assert.equal(githubReviewBelongsToSite(url+suffix,'flatkey.ai'),false);
});
test('explicit GitHub task/approval draft saves through real workflow validators without broadening website ownership',()=>{
 assert.equal(workflowTaskSchema.parse(task).channel,'github');assert.equal(workflowApprovalSchema.parse(approval).channel,'github');
 assert.equal(workflowTaskSchema.safeParse({...task,channel:'website'}).success,false);
 assert.equal(workflowApprovalSchema.safeParse({...approval,channel:'website'}).success,false);
 const t=prepareWorkflowMutation({requestId:'g-task',action:'save_task',expectedVersion:0,record:task},[],'collector',new Date('2026-11-11T09:00:00Z'));
 const a=prepareWorkflowMutation({requestId:'g-approval',action:'save_approval',expectedVersion:0,record:approval},[{kind:'task',record:t.record}],'collector',new Date('2026-11-11T09:00:00Z'));
 assert.equal(a.record.status,'draft');assert.equal(pageBelongsToSite(url,'flatkey.ai'),false);
});
test('GitHub cannot become a blog/landing production record or satisfy a five-site publication',()=>{
 assert.equal(workflowTaskSchema.safeParse({...task,kind:'blog',pageType:'blog',country:'US',language:'en',keyword:'image prompts'}).success,false);
 const publication={id:'bad-pub',taskId:task.id,approvalId:approval.id,approvalItemId:item.id,weekStart:task.weekStart,runId:'run',siteDomain:'flatkey.ai',pageUrl:url,country:null,language:'en',keyword:null,contentVersion:'v2',title:'GitHub README',kind:'source_blog',sourcePublicationId:null,publishedAt:'2026-11-11T09:00:00Z',verifiedAt:null,status:'published',liveCheck:null,evidence,failureReason:null};
 assert.equal(workflowPublicationSchema.safeParse(publication).success,false);
 assert.equal(workflowTaskSchema.safeParse({...task,pageUrl:'https://flatkey.ai/',channel:'github'}).success,false);
});
test('page review preparation retains explicit GitHub channel and stays draft without evidence',()=>{
 const {buildPageReview}=require('../scripts/seo-prepare-page-review.cjs');
 const prepared=buildPageReview({task:{...task,version:0},language:'en',contentFile:'/tmp/github-diff.md',operation:'update',baseContentVersion:'base-sha',changeSummary:'Add repo campaign',beforeSummary:'No repo UTM',afterSummary:'Repo-specific UTM'},'# Exact repository change',null,new Date('2026-11-11T09:00:00Z'));
 assert.equal(prepared.commands[1].record.channel,'github');assert.equal(prepared.commands[1].record.status,'draft');assert.equal(prepared.readiness.ready,false);
});
