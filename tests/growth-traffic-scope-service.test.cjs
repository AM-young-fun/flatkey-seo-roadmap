const{test,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const original=Module._load,queries=[];let archived=[],weekly=[],finalWorkspace=null,dashboardState=null;
const prisma={seoAnalyticsDay:{findMany:async input=>(queries.push(['days',input]),archived)},weeklyTraffic:{findMany:async input=>(queries.push(['weekly',input]),weekly)},seoSite:{findMany:async input=>(queries.push(['sites',input]),[{domain:'flatkey.ai',ga4PropertyId:'541304395'}])},seoWorkflowRecord:{findUnique:async()=>({payload:dashboardState})}};
const loadWorkspace = async () => {
  if (finalWorkspace) return finalWorkspace;
  throw Error('not called');
};
Module._load=function(name,parent,...args){
  if(name==='server-only')return{};
  if(name==='@/lib/prisma')return{prisma};
  if(name==='./growth-workspace'&&parent.filename.endsWith('/services/growth-strategy.ts'))return{
    loadGrowthWorkspace:loadWorkspace,
    loadGrowthDashboardWorkspace:loadWorkspace,
    loadGrowthDashboardHistory:async()=>({tasks:[],publications:[]}),
  };
  if(name==='./seo-workflow'&&parent.filename.endsWith('/services/growth-strategy.ts'))return{loadWorkflowSnapshot:async()=>{throw Error('not called');}};
  if(name.startsWith('@/'))return original.call(this,path.resolve(__dirname,'../src',name.slice(2))+'.ts',parent,...args);
  return original.call(this,name,parent,...args);
};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const{loadGrowthTraffic,loadGrowthReportSnapshot,loadGrowthStrategyDashboard}=require('../src/lib/services/growth-strategy.ts'),{emptyGrowthStrategy}=require('../src/lib/growth-strategy.ts'),{growthExactTrafficSchema,growthTrafficHasCompleteHostScope}=require('../src/lib/growth-exact-traffic.ts');
const {buildGrowthWorkspace}=require('../src/lib/growth-workspace.ts'),{reportDayStart}=require('../src/lib/seo-report-time.cjs'),{shiftDay}=require('../src/lib/seo-date-range.ts');
const period={start:'2026-11-12',end:'2026-11-18'},now=new Date('2026-11-24T02:00:00Z');
const exact=()=>growthExactTrafficSchema.parse({id:'exact-fk-week',site:'flatkey.ai',propertyId:'541304395',...period,timezone:'America/Los_Angeles',sourceTimezone:'America/Los_Angeles',metadata:{timeZone:'America/Los_Angeles',propertyId:'541304395',observedAt:'2026-11-19T10:00:00Z',reference:'saved:real-property-metadata'},source:'google-api',observedAt:'2026-11-19T10:00:00Z',reference:'saved:exact-original-whole-week',scope:'session-organic-search',channelDimension:'sessionDefaultChannelGroup',channelValue:'Organic Search',hostScope:'production-hosts-v1',hostnames:['flatkey.ai','www.flatkey.ai','console.flatkey.ai'],complete:true,sessions:700,intervalStart:'2026-11-12T08:00:00Z',intervalEnd:'2026-11-19T08:00:00Z',method:'native_days',days:Array.from({length:7},(_,i)=>({date:'2026-11-'+String(i+12),sessions:100,complete:true}))});
beforeEach(()=>{queries.length=0;weekly=[];finalWorkspace=null;dashboardState=null;archived=Array.from({length:7},(_,i)=>({payload:{kind:'ga4-site',date:'2026-11-'+String(i+12),observedAt:'2026-11-19T10:00:00Z',source:'google-api',complete:true,property:'541304395',scope:'session-organic-search',hostScope:'production-hosts-v1',sessions:100,registrations:1}}));});
test('seven legacy daily buckets cannot invent source metadata or a complete 3000-goal week',async()=>{
 const rows=await loadGrowthTraffic(period,now);assert.equal(rows.length,1);assert.equal(rows[0].site,'flatkey.ai');assert.equal(rows[0].complete,false);assert.equal(rows[0].sessions,null);assert.equal(rows[0].timezone,'unknown');assert.match(rows[0].reason,/metadata/);
 assert.deepEqual(queries.find(x=>x[0]==='sites')[1].where.domain.in,['flatkey.ai']);assert.deepEqual(queries.find(x=>x[0]==='weekly')[1].where.siteDomain.in,['flatkey.ai']);assert.equal(queries.find(x=>x[0]==='days')[1].where.kind,'ga4-site');
});
test('one exact Flatkey package is sufficient, with all other sites absent or deferred and no extra source request',async()=>{
 const state=emptyGrowthStrategy();state.trafficEvidence=[exact()];const rows=await loadGrowthTraffic(period,now,state);assert.equal(rows.length,1);assert.equal(rows[0].complete,true);assert.equal(rows[0].sessions,700);assert.equal(rows[0].timezone,'America/Los_Angeles');assert.match(rows[0].reason,/541304395/);
});
test('narrow website-only historical evidence stays stored but does not impersonate website plus console',async()=>{
 const state=emptyGrowthStrategy();state.trafficEvidence=[{...exact(),hostnames:['flatkey.ai']}];assert.equal(growthTrafficHasCompleteHostScope(state.trafficEvidence[0]),false);const before=JSON.stringify(state);assert.equal((await loadGrowthTraffic(period,now,state))[0].complete,false);assert.equal(JSON.stringify(state),before);
});
test('property mismatches and a neighboring week never fill the fixed goal source window',async()=>{
 for(const extra of [{propertyId:'999'},{start:'2026-11-05',end:'2026-11-11'},{observedAt:'2026-11-25T00:00:00Z'}]){const state=emptyGrowthStrategy();state.trafficEvidence=[{...exact(),...extra}];assert.equal((await loadGrowthTraffic(period,now,state))[0].sessions,null);}
});
const scalar=(start,end,sessions,observedAt='2026-11-24T16:45:00Z')=>growthExactTrafficSchema.parse({...exact(),id:'scalar-'+end,start,end,method:'whole_interval_scalar',sessions,observedAt,metadata:{...exact().metadata,observedAt},intervalStart:reportDayStart(start),intervalEnd:reportDayStart(shiftDay(end,1)),days:undefined,wholeIntervalScalar:{version:'ga4-whole-interval-v1',queryHash:'a'.repeat(64),observedAt,reference:'saved:actual-whole-interval-scalar'}});
test('daily rolling7 requires its own whole-interval scalar; old fixed weeks and daily sums never substitute',async()=>{
 const clock=new Date('2026-11-25T07:59:59Z'),state=emptyGrowthStrategy(),workspace=buildGrowthWorkspace({generatedAt:clock.toISOString(),topics:[],memberships:[],tasks:[],publications:[],inventory:[],ranks:[]}),workflow={tasks:[],publications:[]};
 state.trafficEvidence=[{...exact(),sessions:1421,days:exact().days.map(day=>({...day,sessions:203}))},scalar('2026-11-17','2026-11-23',1558),scalar('2026-11-16','2026-11-22',1485)];
 const before=JSON.stringify(state),fixed=await loadGrowthReportSnapshot('2026-11-25',false,clock,{state,workspace,workflow});
 assert.equal(fixed.goals.weeklySessions,1421);assert.equal(fixed.goals.trafficWindowKind,'fixed-week');assert.deepEqual(fixed.period,{...period,timezone:'America/Los_Angeles'});
 let daily=await loadGrowthReportSnapshot('2026-11-25',false,clock,{state,workspace,workflow,trafficObservation:'rolling7day-v1'});
 assert.equal(daily.goals.weeklySessions,1558);assert.equal(daily.goals.trafficGap,1442);assert.equal(daily.goals.dailyTrafficObservation.difference,73);assert.equal(daily.goals.dailyTrafficObservation.previousSessions,1485);assert.equal(daily.goals.trafficWindowKind,'rolling7day-v1');assert.equal(daily.goals.trafficPeriod.end,'2026-11-23');assert.equal(JSON.stringify(state),before);
 state.trafficEvidence=state.trafficEvidence.slice(0,1);daily=await loadGrowthReportSnapshot('2026-11-25',false,clock,{state,workspace,workflow,trafficObservation:'rolling7day-v1'});
 assert.equal(daily.goals.weeklySessions,null);assert.equal(daily.goals.dailyTrafficObservation.difference,null);assert.match(daily.goals.traffic[0].reason,/不回退旧固定周/);
});
test('rolling observation never replaces the fixed quarter acceptance window after the deadline',async()=>{
 const clock=new Date('2027-02-07T01:00:00Z'),state=emptyGrowthStrategy(),workspace=buildGrowthWorkspace({generatedAt:clock.toISOString(),topics:[],memberships:[],tasks:[],publications:[],inventory:[],ranks:[]}),workflow={tasks:[],publications:[]};
 finalWorkspace=workspace;state.trafficEvidence=[scalar('2027-01-30','2027-02-05',4000,'2027-02-06T20:00:00Z'),scalar('2027-01-28','2027-02-03',2000,'2027-02-06T20:00:00Z')];
 const daily=await loadGrowthReportSnapshot('2027-02-07',false,clock,{state,workspace,workflow,trafficObservation:'rolling7day-v1'});
 assert.equal(daily.goals.weeklySessions,2000);assert.equal(daily.goals.trafficPeriod.start,'2027-01-28');assert.equal(daily.goals.trafficPeriod.end,'2027-02-03');assert.equal(daily.goals.trafficWindowKind,'quarter-acceptance');assert.equal(daily.goals.rolling.weeklySessions,4000);
});
test('the dashboard displays the latest verified scalar after two missing windows without changing report values', async () => {
  const clock = new Date('2026-11-27T09:00:00Z');
  finalWorkspace = buildGrowthWorkspace({generatedAt:clock.toISOString(),topics:[],memberships:[],tasks:[],publications:[],inventory:[],ranks:[]});
  dashboardState = emptyGrowthStrategy();
  dashboardState.trafficEvidence = [
    exact(),
    scalar('2026-11-17','2026-11-23',1557,'2026-11-27T08:30:00Z'),
    scalar('2026-11-18','2026-11-24',1603,'2026-11-25T14:17:00Z'),
    {...scalar('2026-11-18','2026-11-24',0,'2026-11-26T09:00:00Z'),id:'scalar-revised-nov24'},
    scalar('2026-11-19','2026-11-25',999,'2026-11-28T09:00:00Z'),
  ];
  const dash = await loadGrowthStrategyDashboard(false, clock);
  assert.deepEqual(dash.lastVerifiedRollingTraffic, {start:'2026-11-18',end:'2026-11-24',sessions:0});
  assert.equal(dash.snapshot.goals.weeklySessions, null);
  const observation = dash.snapshot.goals.dailyTrafficObservation;
  assert.equal(observation.period.end, '2026-11-26');
  assert.equal(observation.previousPeriod.end, '2026-11-25');
  assert.equal(observation.previousSessions, null);
  assert.equal(observation.difference, null);

  const report = await loadGrowthReportSnapshot('2026-11-27', false, clock, {
    state:dashboardState, workspace:finalWorkspace, workflow:{tasks:[],publications:[]}, trafficObservation:'rolling7day-v1',
  });
  assert.deepEqual(report, dash.snapshot);

  dashboardState.trafficEvidence.push({...scalar('2026-11-19','2026-11-25',1700,'2026-11-26T14:00:00Z'),id:'scalar-verified-nov25'});
  const previousReady = await loadGrowthStrategyDashboard(false, clock);
  assert.equal(previousReady.lastVerifiedRollingTraffic, undefined);
  assert.equal(previousReady.snapshot.goals.dailyTrafficObservation.previousSessions, 1700);

  dashboardState.trafficEvidence = [exact()];
  assert.equal((await loadGrowthStrategyDashboard(false, clock)).lastVerifiedRollingTraffic, undefined);
});
