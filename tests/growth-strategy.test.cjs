const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { emptyGrowthStrategy, prepareGrowthStrategyMutation, growthWorkspaceIdentity, evaluateGrowthGoals, assertGrowthDirectionScope, growthReportLines, unavailableGrowthReportSnapshot, growthHash } = require('../src/lib/growth-strategy.ts');
const { growthExactTrafficSchema } = require('../src/lib/growth-exact-traffic.ts');
const { buildSeoDigest } = require('../src/lib/seo-digest.ts');
const { digestSnapshotId } = require('../src/lib/seo-digest-message.cjs');
const { growthPageContributionDirections } = require('../src/lib/growth-report-attribution.ts');
const now = new Date('2026-11-23T12:00:00Z'), period = { start: '2026-11-12', end: '2026-11-18' };
const target = (id, extra={}) => ({ id, keywordId:id, site:'flatkey.ai', topicId:'topic-a', topicName:'GPU', keyword:'gpu pricing '+id, country:'US', language:'en', membership:'formal', pageState:'published', publishedUrls:['https://flatkey.ai/blog/'+id], plannedUrls:[], rank:20, rankUrl:'https://flatkey.ai/blog/'+id, rankSource:'serp', checkedAt:'2026-11-22T12:00:00Z', languageStatus:'match', captureState:'ranked', rankEligible:true, observationEligible:true, monitoringEligible:true, taskIds:['task-a'], ...extra });
const workspace = (targets=[target('a'),target('b')]) => ({ version:'growth-v1.5', targets, topics:[{topicId:'topic-a',site:'flatkey.ai',name:'GPU'}] });
const run = (state, command, actor='human', ws=workspace(), publications=[]) => prepareGrowthStrategyMutation(state, { requestId:'request-0001',expectedVersion:state.version,...command }, actor, ws, publications, ['task-a'], now);
const freeze = (state=emptyGrowthStrategy(), ws=workspace()) => run(state, {action:'freeze_baseline',targetIds:ws.targets.map(t=>t.id),sourceVersion:growthWorkspaceIdentity(ws),reason:'reviewed all targets'}, 'human', ws);
const card = () => ({ id:'direction-a',title:'GPU pricing',hypothesis:'Our calculator answers a gap',rationale:'Demand evidence',counterEvidence:'Small sample',competitiveGap:'Missing calculator',ownAdvantage:'Real pricing method',proposedAction:'Refresh the original page',investment:'One original task',expiresAt:'2026-12-20T00:00:00Z',scope:[{site:'flatkey.ai',topicId:'topic-a',country:'US',language:'en',kinds:['optimization','cluster_landing'],maxTasks:1,validUntil:'2026-12-20T00:00:00Z'}],evidence:[{source:'GSC',reference:'saved:gsc-1',observedAt:'2026-11-22T12:00:00Z',supports:'Clicks grew'}],drivers:[],taskIds:['task-a'],experimentId:'experiment-a',experiment:{baseline:'Original page 14d',comparison:'Same country and page age',primaryMetric:'Organic sessions',businessGuardrail:'Registration rate',successCondition:'Improves over comparable baseline',adjustmentCondition:'No verified demand',reviewAt:'2026-12-20T00:00:00Z'} });

test('quarter baseline is a human-confirmed complete real identity list and cannot shrink around unranked targets', () => {
  const ws=workspace();
  assert.throws(()=>run(emptyGrowthStrategy(),{action:'freeze_baseline',targetIds:['a'],sourceVersion:growthWorkspaceIdentity(ws),reason:'drop missing words'}), /全部正式目标/);
  assert.throws(()=>run(emptyGrowthStrategy(),{action:'freeze_baseline',targetIds:['a','b'],sourceVersion:growthWorkspaceIdentity(ws),reason:'collector approval'},'collector'), /已登录用户/);
  const unknown=workspace([target('a',{languageStatus:'unknown'})]);
  assert.throws(()=>freeze(emptyGrowthStrategy(),unknown), /尚未核定/);
  const frozen=freeze(); assert.equal(frozen.baseline.targets.length,2); assert.equal(frozen.baseline.actor,'human');
  assert.throws(()=>freeze(frozen), /已冻结/);
});
test('new weekly batches preserve the frozen denominator and first admission; CAS rejects stale writes', () => {
  const frozen=freeze(), ws=workspace([target('a'),target('b'),target('c')]);
  const batched=run(frozen,{action:'admit_batch',batchId:'week-1',targetIds:['c'],deadline:'2027-02-23',reason:'new week'},'human',ws);
  assert.equal(batched.baseline.targets.length,2); assert.equal(batched.batches[0].targets[0].id,'c');
  assert.throws(()=>run(batched,{action:'admit_batch',batchId:'week-2',targetIds:['c'],deadline:'2027-02-23',reason:'again'},'human',ws), /重复计入/);
  assert.throws(()=>prepareGrowthStrategyMutation(batched,{requestId:'stale-write',expectedVersion:0,action:'save_direction',direction:card()},'human',ws,[],['task-a'],now), /已更新/);
});
test('collector admits routine formal weekly targets inside approved scope without impersonating human or changing quarter baseline', () => {
  const ws=workspace([target('a'),target('b'),target('c')]);
  const state=freeze();
  const command={requestId:'routine-batch-1',expectedVersion:state.version,action:'admit_batch',batchId:'routine-week',targetIds:['c'],deadline:'2027-02-23',reason:'normal approved plan'};
  assert.throws(()=>prepareGrowthStrategyMutation(state,command,'collector',ws,[],['task-a'],now), /先提交完整机会卡待审/);
  const admitted=prepareGrowthStrategyMutation(state,command,'collector',ws,[],['task-a'],now,{routineApprovedTargetIds:['c']});
  assert.equal(admitted.batches[0].actor,'collector'); assert.equal(admitted.baseline.targets.length,2);
  const cohorts=evaluateGrowthGoals(admitted,ws,[],period,now).cohorts;
  assert.deepEqual(cohorts.map(c=>[c.kind,c.targetCount]),[['quarter',2],['weekly',1],['platform',3]]);
});
test('rank targets use current exact native-language SERPs and unknown/failure cannot become a zero or achieved claim', () => {
  const frozen=freeze(), ws=workspace([target('a',{rank:12}),target('b',{rank:null,rankSource:'database',rankEligible:false,observationEligible:false,captureState:'failed'})]);
  const result=evaluateGrowthGoals(frozen,ws,[],period,now);
  assert.equal(result.baselineCount,2); assert.equal(result.rankedCount,1); assert.equal(result.top50Count,1); assert.equal(result.coverageRequired,2); assert.equal(result.rankingComplete,false);
  assert.equal(result.weeklySessions,null); assert.equal(result.knownSessions,null); assert.equal(result.trafficGap,null);
  const empty=evaluateGrowthGoals(emptyGrowthStrategy(),ws,[],period,now); assert.equal(empty.baselineCount,null); assert.equal(empty.coverage,null); assert.equal(empty.quality,null);
  assert.match(growthReportLines({goals:empty,directions:[]}).join(' '), /基线待核定/);
});
test('four-site traffic is complete only for the same exact full LA week, never three sites plus fake RougeCue zero', () => {
  const traffic=['flatkey.ai','rackrate.org','modelfit.cc'].map(site=>({site,...period,timezone:'America/Los_Angeles',sessions:1000,complete:true,observedAt:now.toISOString(),reason:'source'}));
  const partial=evaluateGrowthGoals(freeze(),workspace(),traffic,period,now); assert.equal(partial.knownSessions,3000); assert.equal(partial.weeklySessions,null); assert.equal(partial.trafficComplete,false);
  traffic.push({site:'rougecue.org',...period,timezone:'Asia/Shanghai',sessions:200,complete:true,observedAt:now.toISOString(),reason:'different day buckets'});
  assert.equal(evaluateGrowthGoals(freeze(),workspace(),traffic,period,now).weeklySessions,null);
  traffic[3].timezone='America/Los_Angeles'; assert.equal(evaluateGrowthGoals(freeze(),workspace(),traffic,period,now).weeklySessions,3200);
});
test('six current top100 and four complete outside100 receipts are a complete 60% baseline, not a collection failure', () => {
  const ws=workspace(Array.from({length:10},(_,i)=>target('t'+i,i<6?{}:{rank:null,rankEligible:false,observationEligible:true,captureState:'outside100'})));
  const goals=evaluateGrowthGoals(freeze(emptyGrowthStrategy(),ws),ws,[],period,now);
  assert.equal(goals.rankingComplete,true); assert.equal(goals.coverage,.6); assert.equal(goals.rankedCount,6); assert.equal(goals.cohorts[0].verifiedCount,10);
});
test('AI can prepare a fully evidenced direction; only a human can approve its exact revision and scope', () => {
  let state=run(emptyGrowthStrategy(),{action:'save_direction',direction:card()},'collector');
  const task={directionId:'direction-a',experimentId:'experiment-a',siteDomain:'flatkey.ai',topicId:'topic-a',country:'US',language:'en',kind:'optimization'};
  assert.throws(()=>assertGrowthDirectionScope(state,task,now), /已登录用户批准/);
  assert.throws(()=>run(state,{action:'decide_direction',directionId:'direction-a',revision:1,decision:'approve',reason:'AI approves'},'collector'), /已登录用户/);
  state=run(state,{action:'decide_direction',directionId:'direction-a',revision:1,decision:'approve',reason:'User approved'});
  assert.doesNotThrow(()=>assertGrowthDirectionScope(state,task,now));
  assert.doesNotThrow(()=>assertGrowthDirectionScope(state,{...task,kind:'landing'},now));
  assert.throws(()=>assertGrowthDirectionScope(state,{...task,language:'ja'},now), /超出已批准/);
  state=run(state,{action:'save_direction',direction:{...card(),investment:'Two tasks'}},'collector');
  assert.equal(state.directions[0].decisions.length,1); assert.equal(state.directions[0].decision,null); assert.throws(()=>assertGrowthDirectionScope(state,task,now), /已登录用户批准/);
  assert.doesNotThrow(()=>assertGrowthDirectionScope(state,{siteDomain:'flatkey.ai',kind:'blog'},now));
});
test('14-day effect observations bind a real published version and closed source window without changing delivery state', () => {
  const publication={id:'pub-a',taskId:'task-a',siteDomain:'flatkey.ai',pageUrl:'https://flatkey.ai/blog/a',contentVersion:'sha-v1',publishedAt:'2026-11-01T00:00:00Z',status:'verified',kind:'source_blog'};
  const observation={id:'pub-a-14',publicationId:'pub-a',taskId:'task-a',site:'flatkey.ai',pageUrl:publication.pageUrl,contentVersion:'sha-v1',publishedAt:publication.publishedAt,checkpoint:14,checkedAt:now.toISOString(),timezone:'America/Los_Angeles',windowStart:'2026-11-01',windowEnd:'2026-11-14',indexing:'unknown',rank:null,sessions:null,evidence:card().evidence,conclusion:'Source delayed; no invented zeros',nextAction:'Read the same original task tomorrow',comparison:{status:'new_page',publicationId:'pub-a',taskId:'task-a',contentVersion:'sha-v1',site:'flatkey.ai',pageUrl:publication.pageUrl,country:null,language:null,source:'GA4',propertyId:null,sourceTimezone:'America/Los_Angeles',scope:'page-session-organic-search',before:{start:'2026-10-17',end:'2026-10-30',coveredDates:[],sessions:null,evidence:[],limitations:['New page has no historical baseline']},after:{start:'2026-11-01',end:'2026-11-14',coveredDates:[],sessions:null,evidence:[],limitations:['Source not available']},reason:'New page without a historical baseline',limitations:['After-window source pending']}};
  const state=run(emptyGrowthStrategy(),{action:'record_observation',observation},'collector',workspace(),[publication]);
  assert.equal(state.observations[0].sessions,null); assert.equal(publication.status,'verified'); assert.deepEqual(state.observations[0].coverage,{indexing:'missing',ranking:'missing',traffic:'missing'});
  assert.throws(()=>run(state,{action:'record_observation',observation:{...observation,contentVersion:'another'}},'collector',workspace(),[publication]), /实际页面和内容版本/);
  assert.throws(()=>run(emptyGrowthStrategy(),{action:'record_observation',observation:{...observation,windowEnd:'2026-11-23'}},'collector',workspace(),[publication]), /尚未完整结束/);
  assert.throws(()=>run(emptyGrowthStrategy(),{action:'record_observation',observation:{...observation,checkpoint:56}},'collector',workspace(),[publication]), /历史56/);
  assert.throws(()=>run(emptyGrowthStrategy(),{action:'record_observation',observation:{...observation,windowStart:'2026-11-14'}},'collector',workspace(),[publication]), /连续7\/14\/28天/);
  assert.throws(()=>run(emptyGrowthStrategy(),{action:'record_observation',observation:{...observation,sessions:0}},'collector',workspace(),[publication]), /独立GA4证据/);
  assert.throws(()=>run(emptyGrowthStrategy(),{action:'record_observation',observation:{...observation,indexing:'indexed'}},'collector',workspace(),[publication]), /独立GSC证据/);
});
test('exact traffic reaggregation validates real metadata, native dateHour, UTC coverage and host scope; never relabels Shanghai day totals', () => {
  const start=Date.parse('2026-11-12T08:00:00Z'), format=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
  const hours=Array.from({length:168},(_,i)=>{const utcStart=new Date(start+i*3600000).toISOString(),parts=Object.fromEntries(format.formatToParts(new Date(utcStart)).map(p=>[p.type,p.value])); return {utcStart,sourceDateHour:parts.year+parts.month+parts.day+parts.hour,sessions:1,complete:true};});
  const row={id:'exact-rack-week',site:'rackrate.org',propertyId:'558899190',...period,timezone:'America/Los_Angeles',sourceTimezone:'Asia/Shanghai',metadata:{timeZone:'Asia/Shanghai',propertyId:'558899190',observedAt:'2026-11-19T10:00:00Z',reference:'saved:metadata'},source:'google-api',observedAt:'2026-11-19T10:00:00Z',reference:'saved:hour-rows',scope:'session-organic-search',channelDimension:'sessionDefaultChannelGroup',channelValue:'Organic Search',hostScope:'production-hosts-v1',hostnames:['rackrate.org'],complete:true,sessions:168,intervalStart:'2026-11-12T08:00:00Z',intervalEnd:'2026-11-19T08:00:00Z',method:'utc_hours',hours};
  assert.equal(growthExactTrafficSchema.parse(row).sessions,168);
  assert.equal(growthExactTrafficSchema.safeParse({...row,hours:hours.slice(1)}).success,false);
  assert.equal(growthExactTrafficSchema.safeParse({...row,hostnames:['test.rackrate.org']}).success,false);
  assert.equal(growthExactTrafficSchema.safeParse({...row,method:'native_days',hours:undefined,days:Array.from({length:7},(_,i)=>({date:new Date(Date.parse(period.start)+i*86400000).toISOString().slice(0,10),sessions:24,complete:true}))}).success,false);
  const saved=prepareGrowthStrategyMutation(emptyGrowthStrategy(),{requestId:'traffic-exact-01',expectedVersion:0,action:'record_traffic',evidence:row},'collector',workspace(),[],[],now,{siteProperties:{'rackrate.org':'558899190'}});
  assert.equal(saved.trafficEvidence[0].sourceTimezone,'Asia/Shanghai');
  assert.equal(growthHash(saved),growthHash(JSON.parse(JSON.stringify(saved,(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value))));
});
test('failed growth reads keep a fixed six-section review draft with explicit unknown goals and a snapshot-bound identity', () => {
  const growth=unavailableGrowthReportSnapshot(period,now,'source unavailable');
  const report=buildSeoDigest({date:'2026-11-19',kind:'weekly',now,notificationCompact:true,growthSnapshot:growth,observations:[],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:'missing',optimizationCoverage:'missing'});
  for(const n of ['一','二','三','四','五','六'])assert.match(report.text,new RegExp('\\*\\*'+n+'、'));
  assert.match(report.text,/基线待核定/); assert.match(report.text,/同窗口来源未齐/); assert.equal(report.growthSnapshot.sourceVersion,'unavailable');
  const payload={date:report.date,text:report.text,detailText:report.detailText,growthSnapshot:growth};
  assert.notEqual(digestSnapshotId(payload),digestSnapshotId({...payload,growthSnapshot:{...growth,strategyVersion:99}}));
});
test('attribution compares full native daily evidence, retains page URLs and original tasks, and never includes GitHub or missing page rows as zero', () => {
  const ws=workspace([target('a')]);
  const rows=Array.from({length:14},(_,i)=>({kind:'gsc-pages',property:'sc-domain:flatkey.ai',date:new Date(Date.parse('2026-11-05T00:00:00Z')+i*86400000).toISOString().slice(0,10),observedAt:now.toISOString(),source:'google-api',complete:true,rows:[{url:'https://flatkey.ai/blog/a',clicks:i<7?2:4,impressions:50,position:5}]}));
  const directions=growthPageContributionDirections(ws,[],rows,period,now); assert.equal(directions.length,1); assert.equal(directions[0].drivers[0].previous,14); assert.equal(directions[0].drivers[0].current,28); assert.equal(directions[0].drivers[0].url,'https://flatkey.ai/blog/a'); assert.deepEqual(directions[0].taskIds,['task-a']); assert.match(directions[0].drivers[0].limitation,/不据此证明因果/);
  rows[0].rows=[]; assert.deepEqual(growthPageContributionDirections(ws,[],rows,period,now),[]);
  assert.deepEqual(growthPageContributionDirections(ws,[],rows.slice(1),period,now),[]);
});

test('unbuilt formal targets stay in the frozen denominator while paid monitoring holds them',()=>{
 const {buildGrowthCollectionManifest}=require('../src/lib/growth-collection.ts');
 const t=target('unbuilt',{pageState:'unmapped',publishedUrls:[],plannedUrls:[],rank:null,rankEligible:false,observationEligible:false,monitoringEligible:false});
 const ws=workspace([t]);const state=freeze(emptyGrowthStrategy(),ws);
 assert.equal(state.baseline.targets.length,1);assert.equal(state.baseline.targets[0].pageState,'unmapped');
 assert.equal(evaluateGrowthGoals(state,ws,[],period,now).baselineCount,1);
 const manifest=buildGrowthCollectionManifest(ws,'2026-11-17',{revision:1,connectionVersion:1},now);
 assert.equal(manifest.queries.length,0);assert.equal(manifest.held.length,1);
});

test('weekly cohort gets an independent three-calendar-month deadline without moving quarter goals',()=>{
 const {growthBatchDeadline}=require('../src/lib/growth-strategy.ts');
 assert.equal(growthBatchDeadline(new Date('2026-11-23T12:00:00Z')),'2027-02-23');
 assert.equal(growthBatchDeadline(new Date('2027-01-31T04:00:00Z')),'2027-04-30');
 const ws=workspace([target('a'),target('b'),target('c')]);
 assert.throws(()=>run(freeze(),{action:'admit_batch',batchId:'wrong-deadline',targetIds:['c'],deadline:'2026-12-20',reason:'cannot shorten the new batch window'},'human',ws),/三个月/);
});
