const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(n,p,...a){return resolve.call(this,n.startsWith('@/')?path.join(root,'src',n.slice(2)):n,p,...a)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {quarterContentProblems,quarterContentMutationTasks}=require('../src/lib/seo-quarter-content.ts');
const {emptyGrowthStrategy}=require('../src/lib/growth-strategy.ts');
const task={id:'new-source',siteDomain:'flatkey.ai',topicId:'gpu-rental',keywordId:'k0',keyword:'GPU rental 0',country:'US',language:'en',kind:'blog',dueAt:'2026-11-25T06:00:00Z',status:'ready',pageUrl:'https://flatkey.ai/blog/rental',contentVersion:'v1'};
const row=(kind,record)=>({kind,record});
function state(){const targets=Array.from({length:1600},(_,i)=>({id:'t'+i,keywordId:'k'+i,keyword:'GPU rental '+i,site:'flatkey.ai',topicId:'gpu-rental',country:'US',language:'en'}));return {...emptyGrowthStrategy(),baseline:{targets},quarterPlanning:{revision:1,hash:'approved',approval:{hash:'approved'},plan:{version:'quarter-planning-v2',targetIds:targets.map(t=>t.id)}}};}
test('new routine production requires the exact approved frozen quarter, not the formal pool or a draft plan',()=>{
 assert.match(quarterContentProblems([task],emptyGrowthStrategy(),[])[0],/1600词尚未核定/);
 const draft=state();draft.quarterPlanning.approval=null;assert.equal(quarterContentProblems([task],draft,[]).length,1);
 assert.deepEqual(quarterContentProblems([task],state(),[]),[]);
});
test('the full original word identity prevents a matching topic or different market from entering routine production',()=>{
 for(const patch of [{country:'JP'},{language:'ja'},{keyword:'another phrase'},{keywordId:'other-id'},{siteDomain:'modelfit.cc'},{topicId:'other-topic'}])assert.equal(quarterContentProblems([{...task,...patch}],state(),[]).length,1);
 const invalid=state();invalid.baseline.targets[1].keyword=invalid.baseline.targets[0].keyword;assert.equal(quarterContentProblems([task],invalid,[]).length,1);
});
test('original committed tasks remain resumable before freeze while pending additions cannot self-grandfather',()=>{
 const original=row('task',task),scheduled=row('plan',{id:'original-plan',status:'scheduled',taskIds:[task.id]});
 assert.deepEqual(quarterContentProblems([task],emptyGrowthStrategy(),[original,scheduled]),[]);
 assert.equal(quarterContentProblems([{...task,keyword:'changed'}],emptyGrowthStrategy(),[original,scheduled]).length,1);
 const draft=row('plan',{id:'original-plan',status:'draft',taskIds:[task.id,'not-committed'],committedTaskIds:[task.id]});
 assert.deepEqual(quarterContentProblems([task],emptyGrowthStrategy(),[original,draft]),[]);
 const fresh={...task,id:'not-committed'};assert.equal(quarterContentProblems([fresh],emptyGrowthStrategy(),[original,row('task',fresh),draft]).length,1);
});
test('only new routine content is gated; original maintenance and separately authorized hotspots retain their own checks',()=>{
 for(const patch of [{kind:'research'},{kind:'optimization',workClass:'content_refresh'},{kind:'technical'},{capacityClass:'authorized_hotspot_extra'}])assert.deepEqual(quarterContentMutationTasks('task',{...task,...patch},[]),[]);
 assert.deepEqual(quarterContentMutationTasks('task',{...task,status:'researching'},[]),[]);
 assert.equal(quarterContentMutationTasks('plan',{id:'p',status:'scheduled',taskIds:[task.id]},[row('task',task)]).length,1);
 assert.deepEqual(quarterContentMutationTasks('plan',{id:'p',status:'draft',taskIds:[task.id]},[row('task',task)]),[]);
});

test('an exact human-approved quarter may explicitly reserve an old authorized task without admitting a replacement',()=>{
 const approved=state();approved.quarterPlanning.plan.reservedOriginalTaskIds=[task.id];
 const original={...task,keyword:'original retained keyword',keywordId:'retained'};
 assert.deepEqual(quarterContentProblems([original],approved,[row('task',original)]),[]);
 assert.equal(quarterContentProblems([{...original,id:'replacement'}],approved,[row('task',original)]).length,1);
 const unapproved=state();unapproved.quarterPlanning.plan.reservedOriginalTaskIds=[task.id];unapproved.quarterPlanning.approval=null;
 assert.equal(quarterContentProblems([original],unapproved,[row('task',original)]).length,1);
});


test('a fully researched word can fill one fixed workday slot without waiting for the rest of the quarter',()=>{
 const approved=state();
 approved.baseline.targets=approved.baseline.targets.slice(0,1000);
 approved.baseline.planHash=approved.quarterPlanning.hash;
 approved.quarterPlanning.plan={version:'quarter-planning-v3',targetIds:approved.baseline.targets.map(t=>t.id),
  executionStart:'2026-11-27',executionEnd:'2027-02-05',calendar:approved.baseline.targets.map(target=>({
   targetId:target.id,researchDate:'2026-11-27',stage:'research_only',ahrefs:{keyword:target.keyword,country:'US',volume:20}}))};
 const first={...task,dueAt:'2026-12-02T06:00:00Z',workflowContract:'growth-v1.5',
  research:{intent:'GPU rental'},researchReview:{keyword:task.keyword,country:task.country,language:task.language,evidence:[{}]}};
 assert.deepEqual(quarterContentProblems([first],approved,[]),[]);
 for(const patch of [{researchReview:undefined},{dueAt:'2026-11-26T06:00:00Z'},{dueAt:'2026-11-28T06:00:00Z'},
  {dueAt:'2027-02-08T06:00:00Z'},{keywordId:'other'},{status:'researching'}]){
  assert.equal(quarterContentProblems([{...first,...patch}],approved,[]).length,1);
 }
 assert.equal(quarterContentProblems([first],approved,[row('task',{...first,id:'already-scheduled'})]).length,1);
 const {quarterCalendarDisplay}=require('../src/lib/growth-quarter-display.ts');
 const projected=quarterCalendarDisplay(approved,approved.baseline.targets.map(target=>({...target,topicName:'GPU rental'})),[first]);
 assert.equal(projected.total,1000);
 assert.equal(projected.rows[0].deliveryDate,'2026-12-02');
 assert.equal(projected.rows[1].deliveryDate,null);
 assert.equal(projected.deliveryPending,999);
});
