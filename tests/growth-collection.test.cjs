const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText,f);
const {buildGrowthWorkspace}=require('../src/lib/growth-workspace.ts');
const {buildGrowthCollectionManifest,buildGrowthCollectionRequest,approveGrowthCollection,assertGrowthCollectionApproval,assertGrowthCollectionManifest,collectionHash}=require('../src/lib/growth-collection.ts');
const now=new Date('2026-11-23T10:00:00Z'),url='https://flatkey.ai/blog/pricing';
const member=(patch={})=>({site:'flatkey.ai',keywordId:'k',keyword:'gpu pricing',active:true,keywordActive:true,topicId:'t',pool:'FORMAL',origin:'PLANNED',targetUrls:[url],marketAssignment:{primaryCountry:'US',language:'en',evidence:'Original country and language approval'},...patch});
const workspace=(patch={})=>buildGrowthWorkspace({generatedAt:now.toISOString(),topics:[{id:'t',text:'GPU opportunity',active:true,sites:['flatkey.ai','modelfit.cc']}],memberships:[member()],tasks:[],publications:[],inventory:[{url,lastSeen:now.toISOString()}],ranks:[],sources:[{name:'全部已存SERP',available:true,reason:null}],...patch});
const prepare=(ws=workspace())=>buildGrowthCollectionManifest(ws,'2026-11-17',{revision:2,connectionVersion:3},now);
const state=(manifest=prepare())=>({id:'2026-11-17',version:1,manifest,approval:null,runId:null});
const command=(s)=>({action:'approve',requestId:'approval-001',expectedVersion:s.version,periodKey:s.id,manifestHash:s.manifest.hash,maxCostMicros:s.manifest.maxCostMicros,reason:'已审确切清单与费用'});
test('manifest binds original target/market/page identities, reuses exact receipts, and never pulls unbuilt/research/data-only targets',()=>{
 const ws=workspace({memberships:[member(),member({keyword:'best gpu',targetUrls:['https://flatkey.ai/blog/planned']}),member({keyword:'gpu rental',pool:'RESEARCH'}),member({site:'rougecue.org'})]});
 const m=prepare(ws);assert.equal(m.targets.length,1);assert.equal(m.queries.length,1);assert.equal(m.maxCostMicros,6000);assert.equal(m.held.length,1);assertGrowthCollectionManifest(m);assert.equal(m.periodKey,'2026-11-17');
 const checked=workspace({ranks:[{site:'flatkey.ai',keyword:'gpu pricing',country:'US',language:'en',rank:null,url:null,source:'serp',checkedAt:now.toISOString(),exact:true,complete:true}]});
 const reused=prepare(checked);assert.equal(reused.reused.length,1);assert.equal(reused.queries.length,0);assert.equal(reused.maxCostMicros,0);
});
test('identical cross-site original word queries are frozen once with both independent site targets',()=>{
 const other='https://modelfit.cc/blog/pricing',m=prepare(workspace({memberships:[member(),member({site:'modelfit.cc',keywordId:'m',targetUrls:[other]})],inventory:[{url,lastSeen:now.toISOString()},{url:other,lastSeen:now.toISOString()}]}));
 assert.equal(m.targets.length,2);assert.equal(m.queries.length,1);assert.equal(m.queries[0].targetIds.length,2);assert.equal(m.maxCostMicros,6000);
});
test('reuse is confined to the actual anchored capture period while keeping original receipt scope and run identity',()=>{
 const receipt={site:'flatkey.ai',keyword:'gpu pricing',country:'US',language:'en',rank:10,url,source:'serp',checkedAt:now.toISOString(),exact:true,complete:true,period:{id:'original-diagnostic-run',periodKey:'2026-11-23-approved-diagnostic',scope:'APPROVED_KEYWORD_REVIEW',label:'原诊断回执',cohortHash:'original-cohort',originalTargetCount:1499,originalQueryCount:1499}};
 const current=prepare(workspace({ranks:[receipt]}));assert.equal(current.reused.length,1);assert.equal(current.queries.length,0);assert.equal(current.reused[0].checkedAt,now.toISOString());assert.equal(current.reused[0].originalScope,'APPROVED_KEYWORD_REVIEW');assert.equal(current.reused[0].originalPeriodKey,'2026-11-23-approved-diagnostic');assert.equal(current.reused[0].originalRunId,'original-diagnostic-run');
 const later=new Date('2026-12-04T10:00:00Z'),recentOldWorkspace=workspace({generatedAt:later.toISOString(),ranks:[receipt]});assert.equal(recentOldWorkspace.targets[0].observationEligible,true,'old receipt is still fresh within 14 days');
 const next=buildGrowthCollectionManifest(recentOldWorkspace,'2026-12-01',{revision:2,connectionVersion:3},later);assert.equal(next.reused.length,0);assert.equal(next.queries.length,1,'fresh previous-period results cannot stand in for the new capture period');
 const lateOld=prepare(workspace({ranks:[{...receipt,period:{...receipt.period,periodKey:'2026-11-03',scope:'SCHEDULED'}}]}));assert.equal(lateOld.reused.length,1,'actual captured timestamp is in this period');assert.equal(lateOld.reused[0].originalPeriodKey,'2026-11-03','late original run remains identified as the old run, never relabeled');
 const {serpPeriodFromKey}=require('../src/lib/serp-periods.ts'),boundary=serpPeriodFromKey('2026-12-01').dueAt;
 const boundaryWorkspace=workspace({generatedAt:boundary,ranks:[{...receipt,checkedAt:boundary}]});
 assert.equal(buildGrowthCollectionManifest(boundaryWorkspace,'2026-11-17',{revision:2,connectionVersion:3},new Date(boundary)).reused.length,0,'next dueAt is an exclusive upper bound');
});
test('collector cannot approve, and changing any exact hash/cap/version rejects human confirmation',()=>{
 const s=state();assert.throws(()=>approveGrowthCollection(s,command(s),'collector',now),/同源页面/);
 for(const patch of [{expectedVersion:2},{manifestHash:'0'.repeat(64)},{maxCostMicros:6001},{maxCostMicros:0}])assert.throws(()=>approveGrowthCollection(s,{...command(s),...patch},'human',now),/确切清单/);
 const approved=approveGrowthCollection(s,command(s),'human',now);assert.equal(approved.version,2);assertGrowthCollectionApproval(approved,now);assert.equal(s.approval,null);
});
test('manifest tampering and stale approvals cannot reach the executor; changing a market cannot use a different locale',()=>{
 const approved=approveGrowthCollection(state(),command(state()),'human',now);assert.throws(()=>assertGrowthCollectionApproval(approved,new Date(now.getTime()+25*3600000)),/过期/);
 const altered=structuredClone(approved);altered.manifest.queries[0].country='JP';assert.throws(()=>assertGrowthCollectionManifest(altered.manifest),/清单或费用/);
 const {hash,...content}=altered.manifest;altered.manifest.hash=collectionHash(content);assert.throws(()=>assertGrowthCollectionApproval(altered,now),/国家|原词|语言|批准/);
});
test('Singapore Chinese gets its explicit provider country/language/domain and never US/four-country fallback',()=>{
 const ws=workspace({memberships:[member({keyword:'模型价格',marketAssignment:{primaryCountry:'SG',language:'zh-CN',evidence:'Overseas simplified Chinese Singapore'}})]});
 const m=prepare(ws),request=buildGrowthCollectionRequest(m.queries[0],'task-sg');assert.equal(request.location_code,2702);assert.equal(request.language_code,'zh-CN');assert.equal(request.se_domain,'google.com.sg');assert.equal(request.depth,100);assert.equal(request.max_crawl_pages,10);
 assert.throws(()=>buildGrowthCollectionRequest({...m.queries[0],country:'US'},'task-us'),/国家|语言/);
 const held=prepare(workspace({memberships:[member({keyword:'модель цена',marketAssignment:{primaryCountry:'RU',language:'ru',evidence:'Planning evidence only'}})]}));assert.equal(held.queries.length,0);assert.equal(held.held.length,1);
});
test('explicit-market result parser verifies actual Singapore response and refuses US/English metadata without fallback',()=>{
 const {normalizeSerpAtExplicitMarket}=require('../src/lib/dataforseo-serp.ts'),keyword='模型价格',providerTaskId='fixture-sg-provider';
 const raw={status_code:20000,tasks:[{id:providerTaskId,status_code:20000,data:{keyword,device:'desktop',depth:100,location_code:2702,language_code:'zh-CN',se_domain:'google.com.sg'},result:[{keyword,type:'organic',location_code:2702,language_code:'zh-CN',se_domain:'google.com.sg',datetime:new Date(Date.now()-60000).toISOString(),items:[{type:'organic',rank_group:1,rank_absolute:1,url:'https://flatkey.ai/zh/blog/pricing'}]}]}]};
 const expected={providerTaskId,keyword,config:{device:'desktop',depth:100,locationCode:2702,languageCode:'zh-CN'},searchDomain:'google.com.sg'};
 const normalized=normalizeSerpAtExplicitMarket(raw,expected);assert.equal(normalized.locationCode,2702);assert.equal(normalized.languageCode,'zh-CN');assert.equal(normalized.organicResults[0].rankGroup,1);assert.equal(normalized.completeDepth,false);
 const wrong=structuredClone(raw);wrong.tasks[0].result[0].location_code=2840;wrong.tasks[0].result[0].language_code='en';assert.throws(()=>normalizeSerpAtExplicitMarket(wrong,expected),/SCOPE_MISMATCH/);
});

test('prepare/approve/reserve write exact JSON+normal task ledgers with CAS/idempotency and no provider traffic or switch edits',async()=>{
 const records=new Map(),events=new Map(),runs=new Map(),tasks=[],calls=[];
 const config={id:'default',revision:2,paidEnabled:false,maxRunCostMicros:50000,maxMonthCostMicros:100000},connection={connectionVersion:3,encryptedCredentials:'fixture-cipher'};
 const db={
  $executeRaw:async()=>1,
  seoWorkflowRecord:{findUnique:async({where})=>records.get(where.key)||null,create:async({data})=>{records.set(data.key,structuredClone(data));return data},updateMany:async({where,data})=>{const old=records.get(where.key);if(!old||old.version!==where.version)return{count:0};records.set(where.key,{...old,...structuredClone(data)});return{count:1}}},
  seoWorkflowEvent:{findUnique:async({where})=>events.get(where.requestId)||null,create:async({data})=>{events.set(data.requestId,structuredClone(data));return data}},
  serpMonitorConfig:{findUnique:async()=>structuredClone(config)},dataForSeoConnection:{findUnique:async()=>structuredClone(connection)},
  serpMonitorRun:{aggregate:async()=>({_sum:{reservedCostMicros:0}}),findFirst:async()=>null,findUnique:async({where})=>where.id?runs.get(where.id)||null:[...runs.values()].find(r=>r.periodKey===where.periodKey_scope.periodKey&&r.scope===where.periodKey_scope.scope)||null,create:async({data})=>{runs.set(data.id,structuredClone(data));return data}},
  serpMonitorTask:{createMany:async({data})=>{tasks.push(...structuredClone(data));return{count:data.length}}},
 };
 db.$transaction=async fn=>fn(db);
 const load=Module._load;Module._load=function(name,parent,isMain){if(name==='server-only')return{};if(name==='@/lib/prisma')return{prisma:db};if(name==='./growth-workspace'&&parent.filename.endsWith('/services/growth-collection.ts'))return{loadGrowthWorkspace:async()=>workspace()};if(name==='@/lib/dataforseo-credentials')return{decryptDataForSeoCredentials:()=>{calls.push('decrypt');return{apiLogin:'fixture',apiPassword:'fixture'}}};return load.call(this,name,parent,isMain)};
 const priorFetch=global.fetch;global.fetch=async()=>{throw Error('Unexpected provider/network request')};
 try{
  const {saveGrowthCollection}=require('../src/lib/services/growth-collection.ts');
  const a=await saveGrowthCollection({action:'prepare',requestId:'prepare-001',expectedVersion:0,periodKey:'2026-11-17'},'collector',now);assert.equal(a.state.version,1);assert.equal(runs.size,0);assert.equal(tasks.length,0);
  const b=await saveGrowthCollection(command(a.state),'human',now);assert.equal(b.state.approval.actor,'human');assert.equal(runs.size,0);
  const reserve={action:'reserve',requestId:'reserve-001',expectedVersion:2,periodKey:'2026-11-17',manifestHash:b.state.manifest.hash};
  const c=await saveGrowthCollection(reserve,'collector',now);assert.equal(runs.size,1);assert.equal(tasks.length,1);assert.equal(c.paidRequests,0);assert.equal(config.paidEnabled,false);assert.equal(config.revision,2);assert.equal(tasks[0].state,'PLANNED');assert.equal(tasks[0].region,'US');assert.equal(tasks[0].requestJson.location_code,2840);
  const replay=await saveGrowthCollection(reserve,'collector',now);assert.equal(replay.replay,true);assert.equal(runs.size,1);assert.equal(tasks.length,1);
  await assert.rejects(saveGrowthCollection({...reserve,manifestHash:'0'.repeat(64)},'collector',now),/同一操作编号/);
  assert.equal(c.state.runId,[...runs.keys()][0]);assert.equal(events.size,3);
 }finally{global.fetch=priorFetch;Module._load=load;}
});

test('API requires genuine same-origin human cookie to approve; bearer collectors and cross-origin cookie requests cannot self-approve',async()=>{
 let cookie=false,collector=false,saves=0;
 const load=Module._load;Module._load=function(name,parent,isMain){
  if(name==='server-only')return{};
  if(name==='next/headers')return{cookies:async()=>({get:()=>({value:cookie?'session':undefined})})};
  if(name==='@/lib/auth')return{AUTH_COOKIE_NAME:'auth',isAuthEnabled:()=>true,isValidAuthToken:async token=>token==='session'};
  if(name==='@/lib/seo-analytics-access')return{privateAnalyticsHeaders:{'Cache-Control':'private, no-store'},authorizeAnalyticsRead:async()=>cookie};
  if(name==='@/lib/services/ranking-coverage-access')return{authorizeSavedRankingCoverage:async()=>collector};
  if(name==='@/lib/ranking-import')return{readImportJson:async request=>request.json()};
  if(name==='@/lib/services/growth-collection')return{loadGrowthCollection:async()=>({}),saveGrowthCollection:async()=>{saves++;return{state:state(),paidRequests:0}}};
  if(name==='@/lib/services/serp-monitor')return{resumeGrowthCollectionRun:async()=>{throw Error('approve must not execute')}};
  return load.call(this,name,parent,isMain);
 };
 try{
  const route=require('../src/app/api/seo/growth/collection/route.ts'),body=command(state());
  const request=origin=>new Request('https://seo.example/api/seo/growth/collection',{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)});
  collector=true;assert.equal((await route.POST(request())).status,403);assert.equal(saves,0);
  cookie=true;collector=false;assert.equal((await route.POST(request('https://other.example'))).status,403);assert.equal(saves,0);
  assert.equal((await route.POST(request('https://seo.example'))).status,200);assert.equal(saves,1);
 }finally{Module._load=load;}
});
