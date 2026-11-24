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
