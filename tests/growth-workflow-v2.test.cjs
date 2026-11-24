const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const lib=require('../src/lib/growth-strategy.ts');
const {emptyGrowthStrategy,prepareGrowthStrategyMutation,growthWorkspaceIdentity,evaluateGrowthGoals,growthReportDirections,growthReportLines,growthBaselineIdentityReview,growthStrategyStoredSchema,GROWTH_FINAL_TRAFFIC_PERIOD}=lib;
const now=new Date('2026-11-24T02:00:00Z'),period={start:'2026-11-12',end:'2026-11-18'};
const target=(id,extra={})=>({id,keywordId:id,site:'flatkey.ai',topicId:'topic',keyword:'model requirements '+id,country:'US',language:'en',wordLanguage:'en',languageStatus:'match',membership:'formal',pageState:'published',publishedUrls:['https://flatkey.ai/blog/'+id],plannedUrls:[],rank:6,rankUrl:'https://flatkey.ai/blog/'+id,rankSource:'serp',checkedAt:'2026-11-23T03:00:00Z',rankEligible:true,observationEligible:true,taskIds:[],...extra});
const pending=(id,extra={})=>target(id,{country:null,language:null,languageStatus:'unknown',rank:null,rankSource:null,rankEligible:false,observationEligible:false,...extra});
const workspace=(targets,opportunities=[])=>({targets,opportunities,topics:[{site:'flatkey.ai',topicId:'topic'}]});
const mutate=(state,command,ws,actor='human',at=now)=>prepareGrowthStrategyMutation(state,{requestId:'workflow-v2-request',expectedVersion:state.version,...command},actor,ws,[],[],at);
const freeze=ws=>mutate(emptyGrowthStrategy(),{action:'freeze_baseline',targetIds:ws.targets.map(x=>x.id),sourceVersion:growthWorkspaceIdentity(ws),reason:'reviewed exact stable list including pending identities'},ws);
const supplement=(state,ws,mappings,actor='human',at=now)=>mutate(state,{action:'resolve_baseline_identities',sourceVersion:growthWorkspaceIdentity(ws),mappings,reason:'human reviewed explicit original word native-language and primary-market supplement'},ws,actor,at);

test('stable reviewed list freezes all formal IDs with pending identities and unbuilt pages still N, without approving country or inventing R',()=>{
 const ws=workspace([target('known'),pending('pending',{pageState:'planned',publishedUrls:[],plannedUrls:['https://flatkey.ai/blog/pending']})]);const before=JSON.stringify(ws),state=freeze(ws),g=evaluateGrowthGoals(state,ws,[],period,now);
 assert.equal(state.baseline.targets.length,2);assert.equal(state.baseline.targets[1].country,null);assert.equal(state.identityRevisions.length,0);assert.equal(g.baselineCount,2);assert.equal(g.rankedCount,1);assert.equal(g.identityPendingCount,1);assert.equal(g.identityCompleteCount,1);assert.equal(JSON.stringify(ws),before);
 assert.throws(()=>freeze({...ws,topics:[]}),/尚未核定/);assert.deepEqual(g.trafficScope.sites,['flatkey.ai']);
});
test('human identity supplement appends a revision against original stable ID, joins exact saved evidence and never rewrites N or old snapshots',()=>{
 const base=pending('stable'),hit=target('query-us',{keywordId:'stable',keyword:base.keyword,membership:'opportunity',topicId:null});const ws=workspace([base],[hit]),state=freeze(ws),original=JSON.stringify(state.baseline),oldGoal=evaluateGrowthGoals(state,ws,[],period,now);
 assert.equal(oldGoal.rankedCount,0);const next=supplement(state,ws,[{targetId:'stable',country:'US',language:'en'}]);const g=evaluateGrowthGoals(next,ws,[],period,now);
 assert.equal(JSON.stringify(next.baseline),original);assert.equal(next.identityRevisions[0].mappings[0].targetId,'stable');assert.equal(state.identityRevisions.length,0);assert.equal(g.baselineCount,1);assert.equal(g.rankedCount,1);assert.equal(g.latestRankAt,hit.checkedAt);assert.equal(g.identityPendingCount,0);assert.equal(oldGoal.rankedCount,0);
 assert.equal(growthBaselineIdentityReview(next,ws,now)[0].confirmed,true);
});
test('a market-dependent current ID cannot duplicate an original pending goal in a new batch',()=>{
 const old=pending('original'),initial=workspace([old]),state=freeze(initial),moved=target('assigned-us',{keywordId:'original',keyword:old.keyword});const ws=workspace([moved]);
 assert.equal(evaluateGrowthGoals(state,ws,[],period,now).rankedCount,0);const next=supplement(state,ws,[{targetId:'original',country:'US',language:'en'}]);assert.equal(evaluateGrowthGoals(next,ws,[],period,now).rankedCount,1);
 assert.throws(()=>mutate(next,{action:'admit_batch',batchId:'fake-growth',targetIds:['assigned-us'],deadline:'2027-02-24',reason:'same original target with a supplemented ID'},ws),/不能重复计入/);assert.equal(next.baseline.targets[0].id,'original');
});
test('collector self-approval, stale manifests, unresolved neutral words and overwriting confirmed countries fail closed',()=>{
 const ws=workspace([pending('p')]),state=freeze(ws),m=[{targetId:'p',country:'US',language:'en'}];assert.throws(()=>supplement(state,ws,m,'collector'),/已登录用户/);
 assert.throws(()=>mutate(state,{action:'resolve_baseline_identities',sourceVersion:'stale',mappings:m,reason:'stale source'},ws),/身份已变化/);
 assert.throws(()=>supplement(state,workspace([pending('p',{wordLanguage:null})]),m),/原词语种/);
 assert.throws(()=>supplement(state,ws,[{targetId:'new-word',country:'US',language:'en'}]),/原冻结目标/);
 const known=workspace([target('cn',{country:'CN',language:'zh-CN',wordLanguage:'zh-CN'})]),frozen=freeze(known);assert.throws(()=>supplement(frozen,known,[{targetId:'cn',country:'SG',language:'zh-CN'}]),/已核身份/);
});
test('a new SG Chinese identity never imports the prior CN ranking, and wrong-ID or other-site evidence never fills the original target',()=>{
 const p=pending('zh',{keyword:'模型接口价格',wordLanguage:'zh-CN'}),cn=target('cn-hit',{keywordId:'zh',keyword:p.keyword,country:'CN',language:'zh-CN',wordLanguage:'zh-CN'}),ws=workspace([p],[cn]),state=supplement(freeze(ws),ws,[{targetId:'zh',country:'SG',language:'zh-CN'}]);assert.equal(evaluateGrowthGoals(state,ws,[],period,now).rankedCount,0);
 for(const bad of [{keywordId:'different'},{site:'modelfit.cc'},{checkedAt:'2026-10-01T00:00:00Z'},{rankSource:'database'},{languageStatus:'unknown'},{checkedAt:'2026-11-25T00:00:00Z'}]){
  const hit=target('sg-hit',{keywordId:'zh',keyword:p.keyword,country:'SG',language:'zh-CN',wordLanguage:'zh-CN',...bad});assert.equal(evaluateGrowthGoals(state,workspace([p],[hit]),[],period,now).rankedCount,0);
 }
 const sg={...cn,id:'sg-hit',country:'SG'};assert.equal(evaluateGrowthGoals(state,workspace([p],[sg]),[],period,now).rankedCount,1);
});
test('supplementing a scope collision cannot shrink two original members into one apparent new rank',()=>{
 const a=pending('a'),b=target('b',{keyword:a.keyword}),ws=workspace([a,b]),state=freeze(ws);assert.throws(()=>supplement(state,ws,[{targetId:'a',country:'US',language:'en'}]),/与原目标重复/);assert.equal(state.baseline.targets.length,2);
});
test('six evidenced top50 of a fixed ten-member N can achieve final goals even while four identities remain pending',()=>{
 const base=workspace(Array.from({length:10},(_,i)=>i<6?target('t'+i):pending('t'+i,{wordLanguage:null}))),state=freeze(base),historical=workspace(base.targets.map(t=>({...t,checkedAt:'2027-02-04T00:00:00Z'}))),traffic=[{site:'flatkey.ai',...GROWTH_FINAL_TRAFFIC_PERIOD,timezone:'America/Los_Angeles',sessions:3000,complete:true,observedAt:'2027-02-05T12:00:00Z',reason:'exact complete original window'},{site:'rougecue.org',...GROWTH_FINAL_TRAFFIC_PERIOD,timezone:'unknown',sessions:null,complete:false,reason:'deferred'}];
 const result=evaluateGrowthGoals(state,historical,[],period,new Date('2027-02-06T00:00:00Z'),{workspace:historical,traffic});assert.equal(result.baselineCount,10);assert.equal(result.identityPendingCount,4);assert.equal(result.rankingComplete,false);assert.equal(result.coverage,.6);assert.equal(result.quality,1);assert.equal(result.finalAcceptance.status,'achieved');assert.equal(result.weeklySessions,3000);
 assert.throws(()=>supplement(state,historical,[{targetId:'t6',country:'US',language:'en'}],'human',new Date('2027-02-06T00:00:00Z')),/本季已截止/);
});
const card=()=>({id:'new-opportunity',title:'New topic without historical traffic',experimentId:'exp',proposedAction:'Research existing page and verified demand',updatedAt:'2026-11-23T08:00:00Z',expiresAt:'2026-12-20T00:00:00Z',scope:[{site:'flatkey.ai',topicId:'topic',country:'US',language:'en',kinds:['research'],maxTasks:1,validUntil:'2026-12-20T00:00:00Z'}],taskIds:[],decision:null,drivers:[]});
test('valid scoped pending and decided opportunity cards survive reports without fabricated historical drivers; numeric drivers still use exact LA period',()=>{
 const state=emptyGrowthStrategy(),c=card();state.directions=[c];const ws=workspace([target('a')]);let out=growthReportDirections(state,ws,period,now);assert.equal(out.length,1);assert.deepEqual(out[0].drivers,[]);assert.equal(out[0].decision,'待用户判断方向');
 c.decision={decision:'hold'};c.drivers=[{window:{start:'2026-11-05',end:'2026-11-11',timezone:'America/Los_Angeles'}},{window:{...period,timezone:'Asia/Shanghai'}}];out=growthReportDirections(state,ws,period,now);assert.equal(out.length,1);assert.equal(out[0].drivers.length,0);assert.match(out[0].decision,/继续观察/);
 assert.equal(growthReportDirections(state,{...ws,topics:[]},period,now).length,0);c.expiresAt='2026-11-20T00:00:00Z';assert.equal(growthReportDirections(state,ws,period,now).length,0);
});
test('new snapshot is explicitly Flatkey-only while old snapshots retain four-site label and serialized state stays unchanged',()=>{
 const ws=workspace([target('a')]),goals=evaluateGrowthGoals(freeze(ws),ws,[],period,now),current={goals,directions:[]};assert.match(growthReportLines(current)[0],/Flatkey 单站/);
 const old=structuredClone(current);delete old.goals.trafficScope;delete old.goals.identityPendingCount;delete old.goals.identityCompleteCount;const before=JSON.stringify(old);assert.match(growthReportLines(old)[0],/四站完整周/);assert.equal(JSON.stringify(old),before);
 const legacy=emptyGrowthStrategy();delete legacy.identityRevisions;assert.deepEqual(growthStrategyStoredSchema.parse(legacy).identityRevisions,[]);
});
test('current-period historic drivers remain attribution after an execution scope expires; no-driver expired cards do not',()=>{
 const state=emptyGrowthStrategy(),c=card();c.expiresAt='2026-11-20T00:00:00Z';c.drivers=[{window:{...period,timezone:'America/Los_Angeles'}}];state.directions=[c];const result=growthReportDirections(state,workspace([target('a')]),period,now);assert.equal(result.length,1);assert.equal(result[0].kind,'attribution');assert.equal(result[0].drivers.length,1);assert.match(result[0].decision,/已失效/);
});
