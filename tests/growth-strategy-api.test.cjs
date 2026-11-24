const assert=require('node:assert/strict'),{test,beforeEach,afterEach}=require('node:test'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module'),ts=require('typescript');
const originalLoad=Module._load;let session=false,sourceReads=0;
const target={id:'a',keywordId:'a',site:'flatkey.ai',topicId:'topic-a',topicName:'GPU',keyword:'gpu pricing',country:'US',language:'en',membership:'formal',pageState:'planned',publishedUrls:[],plannedUrls:['https://flatkey.ai/compute'],languageStatus:'match',rank:null,rankSource:null,checkedAt:null,rankEligible:false,observationEligible:false,taskIds:[]};
const workspace={version:'growth-v1.5',targets:[target],topics:[{topicId:'topic-a',site:'flatkey.ai'}]};
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
const {growthWorkspaceIdentity}=require('../src/lib/growth-strategy.ts');
const saved=Object.fromEntries(['NODE_ENV','SEO_WORKFLOW_PREVIEW_DIR','DATABASE_URL','SEO_PREVIEW_UPSTREAM_TOKEN'].map(key=>[key,process.env[key]]));let directory;
beforeEach(async()=>{session=false;sourceReads=0;directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'growth-strategy-api-'));process.env.NODE_ENV='development';process.env.SEO_PREVIEW_UPSTREAM_TOKEN='test-preview';process.env.SEO_WORKFLOW_PREVIEW_DIR=directory;delete process.env.DATABASE_URL;});
afterEach(async()=>{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fs.promises.rm(directory,{recursive:true,force:true});});
const url='http://localhost:3104/api/seo/growth/strategy';
const freeze=(extra={})=>({requestId:'freeze-request-01',expectedVersion:0,action:'freeze_baseline',targetIds:['a'],sourceVersion:growthWorkspaceIdentity(workspace),reason:'Human reviewed exact full cohort',...extra});
const post=(body,headers={origin:'http://localhost:3104'},targetUrl=url)=>POST(new Request(targetUrl,{method:'POST',headers,body:JSON.stringify(body)}));
test('strategy API rejects missing login, foreign origins and collector self-approval before source reads',async()=>{
  assert.equal((await GET(new Request('https://production.test/api/seo/growth/strategy'))).status,401);
  assert.equal((await post(freeze(),{},'https://production.test/api/seo/growth/strategy')).status,401);
  assert.equal((await post(freeze(),{origin:'https://evil.test'})).status,403);
  assert.equal((await post(freeze(),{authorization:'Bearer test-workflow-secret'},'https://production.test/api/seo/growth/strategy')).status,403);
  assert.equal(sourceReads,0);
});
test('real preview freeze persists the exact list, replays one request, rejects stale writes and changed idempotency content',async()=>{
  const first=await post(freeze());assert.equal(first.status,200);const saved=await first.json();assert.equal(saved.state.baseline.targets[0].keyword,'gpu pricing');assert.equal(saved.state.version,1);
  const replay=await post(freeze());assert.equal(replay.status,200);assert.equal((await replay.json()).replay,true);
  assert.equal((await post(freeze({reason:'different content'}))).status,409);
  assert.equal((await post(freeze({requestId:'new-stale-request'}))).status,409);
  const result=await GET(new Request(url));assert.equal(result.status,200);const view=await result.json();assert.equal(view.state.baseline.targets.length,1);assert.equal(view.snapshot.goals.baselineCount,1);assert.equal(view.snapshot.goals.weeklySessions,null);assert.equal(view.snapshot.goals.knownSessions,null);
  const disk=JSON.parse(await fs.promises.readFile(path.join(directory,'growth-strategy.json'),'utf8'));assert.equal(disk.events.length,1);assert.equal(disk.state.version,1);
});
test('human-only stable identity supplements persist append-only against an unresolved frozen member with CAS and exact source validation',async()=>{
 const previous={...target};Object.assign(target,{country:null,language:null,languageStatus:'unknown',wordLanguage:'en'});
 try{
  const first=await post(freeze());assert.equal(first.status,200);const original=(await first.json()).state.baseline;
  const command={requestId:'human-identity-supplement',expectedVersion:1,action:'resolve_baseline_identities',sourceVersion:growthWorkspaceIdentity(workspace),mappings:[{targetId:'a',country:'US',language:'en'}],reason:'User reviewed exact stable ID, explicit word language and new primary country'};
  const before=sourceReads;assert.equal((await post(command,{authorization:'Bearer test-workflow-secret'},'https://production.test/api/seo/growth/strategy')).status,403);assert.equal(sourceReads,before);
  const result=await post(command);assert.equal(result.status,200);const data=await result.json();assert.deepEqual(data.state.baseline,original);assert.equal(data.state.identityRevisions.length,1);assert.equal(data.state.identityRevisions[0].mappings[0].targetId,'a');
  assert.equal((await(await post(command)).json()).replay,true);assert.equal((await post({...command,requestId:'stale-identity-supplement'})).status,409);
  const view=await(await GET(new Request(url))).json();assert.equal(view.snapshot.goals.baselineCount,1);assert.equal(view.identityReview[0].country,'US');assert.equal(view.identityReview[0].confirmed,true);assert.equal(view.snapshot.goals.rankedCount,0);
 }finally{for(const k of Object.keys(target))if(!(k in previous))delete target[k];Object.assign(target,previous);}
});
