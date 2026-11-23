const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const{emptyGrowthStrategy,prepareGrowthStrategyMutation,growthWorkspaceIdentity,evaluateGrowthGoals,GROWTH_FINAL_TRAFFIC_PERIOD,GROWTH_DEADLINE_CUTOFF}=require('../src/lib/growth-strategy.ts');
const target=(id,checkedAt,extra={})=>({id,keywordId:id,site:'flatkey.ai',topicId:'topic',keyword:'gpu '+id,country:'US',language:'en',membership:'formal',pageState:'published',publishedUrls:['https://flatkey.ai/blog/'+id],plannedUrls:[],rank:20,rankSource:'serp',checkedAt,languageStatus:'match',captureState:'ranked',rankEligible:true,observationEligible:true,...extra});
const workspace=targets=>({targets,topics:[{topicId:'topic',site:'flatkey.ai'}]});
const baselineWorkspace=workspace(Array.from({length:10},(_,i)=>target('t'+i,'2026-11-22T12:00:00Z')));
const frozen=()=>prepareGrowthStrategyMutation(emptyGrowthStrategy(),{requestId:'freeze-deadline-test',expectedVersion:0,action:'freeze_baseline',targetIds:baselineWorkspace.targets.map(t=>t.id),sourceVersion:growthWorkspaceIdentity(baselineWorkspace),reason:'Original approved full quarter list'},'human',baselineWorkspace,[],[],new Date('2026-11-23T12:00:00Z'));
const traffic=(period,total=4000)=>['flatkey.ai','rackrate.org','modelfit.cc','rougecue.org'].map(site=>({site,...period,timezone:'America/Los_Angeles',sessions:total/4,complete:true,observedAt:'2027-02-11T12:00:00Z',reason:'Exact verified window'}));
test('a February 7 ranking and a favorable February 4–10 traffic week cannot repair the closed quarter',()=>{
  const now=new Date('2027-02-11T12:00:00Z'),current=workspace(Array.from({length:10},(_,i)=>target('t'+i,'2027-02-07T12:00:00Z'))),period={start:'2027-02-04',end:'2027-02-10'};
  const result=evaluateGrowthGoals(frozen(),current,traffic(period),period,now);
  assert.equal(result.evaluationMode,'final');assert.equal(result.rankingAsOf,GROWTH_DEADLINE_CUTOFF);assert.equal(result.rankedCount,0);assert.equal(result.rankingComplete,false);assert.equal(result.weeklySessions,null);assert.equal(result.finalAcceptance.status,'incomplete');assert.equal(result.finalAcceptance.achieved,null);
  assert.deepEqual(result.trafficPeriod,{...GROWTH_FINAL_TRAFFIC_PERIOD,timezone:'America/Los_Angeles'});assert.equal(result.rolling.weeklySessions,4000);assert.equal(result.cohorts.find(x=>x.kind==='platform').rankedCount,10);
});
test('final acceptance reuses cutoff projection and fixed LA week; ranking freshness is relative to cutoff, while platform remains live',()=>{
  const current=workspace(Array.from({length:10},(_,i)=>target('t'+i,'2027-02-28T12:00:00Z'))),historical=workspace(Array.from({length:10},(_,i)=>target('t'+i,'2027-02-04T12:00:00Z',i<6?{}:{rank:null,rankEligible:false,captureState:'outside100'}))),period={start:'2027-02-18',end:'2027-02-24'};
  const result=evaluateGrowthGoals(frozen(),current,traffic(period),period,new Date('2027-03-01T12:00:00Z'),{workspace:historical,traffic:traffic(GROWTH_FINAL_TRAFFIC_PERIOD,3200)});
  assert.equal(result.rankedCount,6);assert.equal(result.top50Count,6);assert.equal(result.rankingComplete,true);assert.equal(result.coverage,.6);assert.equal(result.quality,1);assert.equal(result.weeklySessions,3200);assert.equal(result.finalAcceptance.status,'achieved');assert.equal(result.finalAcceptance.achieved,true);assert.equal(result.latestRankAt,'2027-02-04T12:00:00Z');assert.equal(result.cohorts.find(x=>x.kind==='platform').rankedCount,10);
  const wrongWeek=evaluateGrowthGoals(frozen(),current,traffic(period),period,new Date('2027-03-01T12:00:00Z'),{workspace:historical,traffic:traffic(period,5000)});assert.equal(wrongWeek.weeklySessions,null);assert.equal(wrongWeek.finalAcceptance.achieved,null);
});
test('a post-deadline baseline cannot retroactively set a convenient quarter denominator',()=>{
  assert.throws(()=>prepareGrowthStrategyMutation(emptyGrowthStrategy(),{requestId:'late-quarter-freeze',expectedVersion:0,action:'freeze_baseline',targetIds:baselineWorkspace.targets.map(t=>t.id),sourceVersion:growthWorkspaceIdentity(baselineWorkspace),reason:'Late approval'},'human',baselineWorkspace,[],[],new Date('2027-02-06T00:00:00Z')),/不能事后冻结/);
});
