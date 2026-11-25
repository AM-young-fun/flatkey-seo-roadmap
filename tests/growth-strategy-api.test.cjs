const assert=require('node:assert/strict'),{test,beforeEach,afterEach}=require('node:test'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module'),ts=require('typescript');
const originalLoad=Module._load;let session=false,sourceReads=0;
const target={id:'a',keywordId:'a',site:'flatkey.ai',topicId:'topic-a',topicName:'GPU',keyword:'gpu pricing',country:'US',language:'en',membership:'formal',pageState:'planned',publishedUrls:[],plannedUrls:['https://flatkey.ai/compute'],languageStatus:'match',rank:null,rankSource:null,checkedAt:null,rankEligible:false,observationEligible:false,taskIds:[]};
const workspace={version:'growth-v1.5',targets:[target,...Array.from({length:1599},(_,i)=>({...target,id:`word-${i}`,keywordId:`keyword-${i}`,keyword:`gpu research topic ${i}`}))],topics:[{topicId:'topic-a',site:'flatkey.ai'}]};
const workflow={tasks:[],publications:[]};
Module._load=function(name,parent,...args){
  if(name==='server-only')return {};
  if(name==='next/headers')return {cookies:async()=>({get:()=>undefined})};
  if(name==='./auth')return {AUTH_COOKIE_NAME:'auth',isAuthEnabled:()=>true,isValidAuthToken:async()=>session};
  if(name==='@/lib/prisma')return {prisma:{}};
  if(name==='./import-credential'||name==='@/lib/import-credential')return {getRankingImportSecret:()=> 'test-workflow-secret'};
  if(name==='./growth-workspace'&&parent.filename.endsWith('/services/growth-strategy.ts'))return {loadGrowthWorkspace:async()=>{sourceReads++;return workspace;}};
  if(name==='./seo-workflow'&&parent.filename.endsWith('/services/growth-strategy.ts'))return {loadWorkflowSnapshot:async()=>workflow};
  if(name.startsWith('@/'))return originalLoad.call(this,path.resolve(__dirname,'../src',name.slice(2))+'.ts',parent,...args);
  return originalLoad.call(this,name,parent,...args);
};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {GET,POST}=require('../src/app/api/seo/growth/strategy/route.ts');
const {growthWorkspaceIdentity,growthHash}=require('../src/lib/growth-strategy.ts');
const saved=Object.fromEntries(['NODE_ENV','SEO_WORKFLOW_PREVIEW_DIR','DATABASE_URL','SEO_PREVIEW_UPSTREAM_TOKEN'].map(key=>[key,process.env[key]]));let directory;
beforeEach(async()=>{session=false;sourceReads=0;directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'growth-strategy-api-'));process.env.NODE_ENV='development';process.env.SEO_PREVIEW_UPSTREAM_TOKEN='test-preview';process.env.SEO_WORKFLOW_PREVIEW_DIR=directory;delete process.env.DATABASE_URL;});
afterEach(async()=>{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fs.promises.rm(directory,{recursive:true,force:true});});
const url='http://localhost:3104/api/seo/growth/strategy';
const freeze=(extra={})=>({requestId:'freeze-request-01',expectedVersion:0,action:'freeze_baseline',targetIds:['a'],sourceVersion:growthWorkspaceIdentity(workspace),reason:'Human reviewed exact full cohort',...extra});
const post=(body,headers={origin:'http://localhost:3104'},targetUrl=url)=>POST(new Request(targetUrl,{method:'POST',headers,body:JSON.stringify(body)}));

const quarterPlan=()=>({version:'quarter-planning-v2',targetUnit:'normalized_original_word',sourceVersion:growthWorkspaceIdentity(workspace),title:'Quarter source and allocation review',targetIds:workspace.targets.map(target=>target.id),artifact:{reference:'/saved/quarter-review.json',sha256:'a'.repeat(64)},executionStart:'2026-11-25',executionEnd:'2027-02-05',workstreams:['gpu','api'].map(bucket=>({id:bucket,title:bucket,bucket,topicIds:['topic-a'],taskIds:[],rationale:'Original saved topic and business need form this direction',verification:'Validate original native SERP and page intent before execution',evidenceReferences:['saved-topic-page-research.json']})),researchBudget:{total:100,counts:{US:35,JP:25,BR:20,SG:15,other:5}},deliveryBudget:{total:100,counts:{gpu:70,api:25,other:5}},reservedOriginalTaskIds:[],limitations:['Research budgets do not approve paid queries or claim native verification']});
async function prepareQuarter(){const plan=quarterPlan();const response=await post({action:'save_quarter_plan',requestId:'save-quarter-draft-api',expectedVersion:0,plan});assert.equal(response.status,200);return {plan,command:{action:'approve_quarter_plan',requestId:'approve-quarter-api',expectedVersion:1,hash:growthHash(plan),sourceVersion:growthWorkspaceIdentity(workspace),reason:'User reviewed exact directions, market budgets, work capacity and limitations'}};}
test('strategy API rejects missing login, foreign origins and collector self-approval before source reads',async()=>{
  assert.equal((await GET(new Request('https://production.test/api/seo/growth/strategy'))).status,401);
  assert.equal((await GET(new Request('https://production.test/api/seo/growth/strategy?view=overview'))).status,401);
  assert.equal((await post(freeze(),{},'https://production.test/api/seo/growth/strategy')).status,401);
  assert.equal((await post(freeze(),{origin:'https://evil.test'})).status,403);
  assert.equal((await post(freeze(),{authorization:'Bearer test-workflow-secret'},'https://production.test/api/seo/growth/strategy')).status,403);
  assert.equal(sourceReads,0);
});
test('real preview freeze persists the exact list, replays one request, rejects stale writes and changed idempotency content',async()=>{
  const {command}=await prepareQuarter();const first=await post(command);assert.equal(first.status,200);const saved=await first.json();assert.equal(saved.state.baseline.targets[0].keyword,'gpu pricing');assert.equal(saved.state.version,2);
  const replay=await post(command);assert.equal(replay.status,200);assert.equal((await replay.json()).replay,true);
  assert.equal((await post({...command,reason:'different content'})).status,409);
  assert.equal((await post({...command,requestId:'new-stale-request'})).status,409);
  const result=await GET(new Request(url));assert.equal(result.status,200);const view=await result.json();assert.equal(view.state.baseline.targets.length,1600);assert.equal(view.snapshot.goals.baselineCount,1600);assert.equal(view.snapshot.goals.weeklySessions,null);assert.equal(view.snapshot.goals.knownSessions,null);
  const overviewResponse = await GET(new Request(`${url}?view=overview`));
  assert.equal(overviewResponse.status, 200);
  assert.equal(overviewResponse.headers.get('Cache-Control'), result.headers.get('Cache-Control'));
  const overview = await overviewResponse.json();
  assert.deepEqual(Object.keys(overview), ['snapshot']);
  assert.equal(overview.snapshot.strategyVersion, view.snapshot.strategyVersion);
  assert.equal(overview.snapshot.goals.baselineCount, view.snapshot.goals.baselineCount);
  assert.equal(overview.snapshot.goals.trafficWindowKind, 'rolling7day-v1');
  assert.equal(overview.snapshot.goals.weeklySessions, view.snapshot.goals.weeklySessions);
  const disk=JSON.parse(await fs.promises.readFile(path.join(directory,'growth-strategy.json'),'utf8'));assert.equal(disk.events.length,2);assert.equal(disk.state.version,2);
});
test('human-only stable identity supplements persist append-only against an unresolved frozen member with CAS and exact source validation',async()=>{
 const previous={...target};Object.assign(target,{country:null,language:null,languageStatus:'unknown',wordLanguage:'en'});
 try{
  const legacy=require('../src/lib/growth-strategy.ts').emptyGrowthStrategy();legacy.version=2;legacy.updatedAt=new Date().toISOString();legacy.baseline={frozenAt:legacy.updatedAt,actor:'human',sourceVersion:growthWorkspaceIdentity(workspace),targets:workspace.targets.map(row=>({id:row.id,keywordId:row.keywordId,site:row.site,topicId:row.topicId,keyword:row.keyword,country:row.country,language:row.language,publishedUrls:row.publishedUrls,plannedUrls:row.plannedUrls,pageState:row.pageState,languageStatus:row.languageStatus})),reason:'Historical already approved cohort retains unresolved identities'};await fs.promises.writeFile(path.join(directory,'growth-strategy.json'),JSON.stringify({state:legacy,events:[]}));const original=structuredClone(legacy.baseline);
  const command={requestId:'human-identity-supplement',expectedVersion:2,action:'resolve_baseline_identities',sourceVersion:growthWorkspaceIdentity(workspace),mappings:[{targetId:'a',country:'US',language:'en'}],reason:'User reviewed exact stable ID, explicit word language and new primary country'};
  const before=sourceReads;assert.equal((await post(command,{authorization:'Bearer test-workflow-secret'},'https://production.test/api/seo/growth/strategy')).status,403);assert.equal(sourceReads,before);
  const result=await post(command);assert.equal(result.status,200);const data=await result.json();assert.deepEqual(data.state.baseline,original);assert.equal(data.state.identityRevisions.length,1);assert.equal(data.state.identityRevisions[0].mappings[0].targetId,'a');
  assert.equal((await(await post(command)).json()).replay,true);assert.equal((await post({...command,requestId:'stale-identity-supplement'})).status,409);
  const view=await(await GET(new Request(url))).json();assert.equal(view.snapshot.goals.baselineCount,1600);assert.equal(view.identityReview[0].country,'US');assert.equal(view.identityReview[0].confirmed,true);assert.equal(view.snapshot.goals.rankedCount,0);
 }finally{for(const k of Object.keys(target))if(!(k in previous))delete target[k];Object.assign(target,previous);}
});
