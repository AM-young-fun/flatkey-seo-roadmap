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
   targetId:target.id,researchDate:'2026-12-04',stage:'research_only',ahrefs:{keyword:target.keyword,country:'US',volume:20}}))};
 const first={...task,dueAt:'2026-12-02T06:00:00Z',workflowContract:'growth-v1.5',
  research:{intent:'GPU rental'},researchReview:{keyword:task.keyword,country:task.country,language:task.language,
   reviewedAt:'2026-11-27T05:00:00Z',duplicateCheckedAt:'2026-11-27T06:00:00Z',evidence:[{}]}};
 assert.deepEqual(quarterContentProblems([first],approved,[]),[]);
 for(const patch of [{researchReview:undefined},{dueAt:'2026-11-26T06:00:00Z'},{dueAt:'2026-11-28T06:00:00Z'},
  {dueAt:'2027-02-08T06:00:00Z'},{keywordId:'other'},{status:'researching'}]){
  assert.equal(quarterContentProblems([{...first,...patch}],approved,[]).length,1);
 }
 assert.equal(quarterContentProblems([first],approved,[row('task',{...first,id:'already-scheduled'})]).length,1);
 for (const field of ['reviewedAt','duplicateCheckedAt']) {
  const late={...first,researchReview:{...first.researchReview,[field]:'2026-12-02T07:00:00Z'}};
  assert.equal(quarterContentProblems([late],approved,[]).length,1);
 }
 const scheduled=approved.quarterPlanning.plan.calendar[0];
 Object.assign(scheduled,{researchDate:'2026-11-27',deliveryDate:'2026-12-03',stage:'delivery',primary:true,kind:'blog'});
 assert.equal(quarterContentProblems([first],approved,[]).length,1);
 assert.deepEqual(quarterContentProblems([{...first,dueAt:'2026-12-03T06:00:00Z'}],approved,[]),[]);
 delete scheduled.deliveryDate;
 scheduled.researchDate='2026-12-04';
 const {quarterCalendarDisplay}=require('../src/lib/growth-quarter-display.ts');
 const projected=quarterCalendarDisplay(approved,approved.baseline.targets.map(target=>({...target,topicName:'GPU rental'})),[first]);
 assert.equal(projected.total,1000);
 assert.equal(projected.rows[0].researchDate,'2026-12-04');
 assert.equal(projected.rows[0].deliveryDate,'2026-12-02');
 assert.equal(projected.rows[1].deliveryDate,null);
 assert.equal(projected.deliveryPending,999);
});

test('the separate two-site pool keeps original commitments and requires exact identity and research before production', () => {
 const approved = state();
 approved.baseline.targets = approved.baseline.targets.slice(0, 1000);
 approved.baseline.planHash = approved.quarterPlanning.hash;
 approved.quarterPlanning.plan = { version: 'quarter-planning-v3', targetIds: approved.baseline.targets.map(target => target.id),
  executionStart: '2026-11-27', executionEnd: '2027-02-05', reservedOriginalTaskIds: ['old-model'], calendar: [] };
 const rowModel = { siteDomain: 'modelfit.cc', keywordId: 'model-id', targetId: 'model-target', topicId: 'model-topic',
  keyword: 'model compatibility guide', country: 'US', language: 'en', volume: 90, researchDate: '2026-11-30' };
 const rowRack = { ...rowModel, siteDomain: 'rackrate.org', keywordId: 'rack-id', targetId: 'rack-target', topicId: 'rack-topic', keyword: 'gpu rental pricing options' };
 approved.satelliteQuarter = { baselinePlanHash: approved.baseline.planHash, members: [rowModel, rowRack] };
 const model = { ...task, ...rowModel, id: 'model-new', dueAt: '2026-12-02T06:00:00Z', workflowContract: 'growth-v1.5',
  research: { intent: 'choosing a compatible runtime' },
  researchReview: { keyword: rowModel.keyword, country: 'US', language: 'en', evidence: [{}] } };
 const rack = { ...model, ...rowRack, id: 'rack-new', kind: 'landing', researchReview: { ...model.researchReview, keyword: rowRack.keyword } };
 assert.deepEqual(quarterContentProblems([model, rack], approved, []), []);
 for (const bad of [{ ...model, topicId: rowRack.topicId }, { ...model, keywordId: rowRack.keywordId }, { ...model, researchReview: undefined },
  { ...model, dueAt: '2026-11-27T06:00:00Z' }, { ...rack, kind: 'blog' }, { ...rack, kind: 'cluster' }]) {
  assert.equal(quarterContentProblems([bad], approved, []).length, 1);
 }
 assert.equal(quarterContentProblems([model], approved, [row('task', { ...model, id: 'model-duplicate' })]).length, 1);
 const original = { ...model, id: 'old-model', keyword: 'already promised outside the new pool' };
 assert.deepEqual(quarterContentProblems([original], approved, [row('task', original)]), []);
 const { quarterCalendarDisplay } = require('../src/lib/growth-quarter-display.ts');
 const projected = quarterCalendarDisplay(approved, [], [model]);
 assert.equal(projected.total, 1000);
 assert.deepEqual(projected.satellite.siteCounts, { 'modelfit.cc': 1, 'rackrate.org': 1 });
 assert.equal(projected.satellite.rows[0].deliveryDate, '2026-12-02');
 assert.equal(projected.satellite.rows[1].deliveryDate, null);
});

test('supplement intake requires 200 unique cross-site words with immutable Ahrefs provenance and actual research dates', () => {
 const { satelliteQuarterCommandSchema, satelliteQuarterHash, satelliteQuarterProblem } = require('../src/lib/satellite-quarter.ts');
 const approved = state();
 approved.baseline.targets = approved.baseline.targets.slice(0, 1000);
 approved.baseline.planHash = approved.quarterPlanning.hash;
 approved.quarterPlanning.plan = { version: 'quarter-planning-v3', targetIds: approved.baseline.targets.map(target => target.id),
  executionStart: '2026-11-27', executionEnd: '2027-02-05', calendar: [] };
 const now = new Date('2026-11-26T04:00:00Z');
 const rows = Array.from({ length: 200 }, (_, index) => {
  const keyword = 'verified fixture keyword ' + index, sourceRow = index + 1;
  return { siteDomain: index < 100 ? 'modelfit.cc' : 'rackrate.org', topicId: 'site-topic', keyword, country: 'US', language: 'en', volume: 30,
   sourceUrl: 'https://app.ahrefs.com/keywords-explorer/google/us/matching-terms', sourceFile: 'fixture.csv', sourceSha256: 'a'.repeat(64),
   sourceRow, observedAt: now.toISOString(), researchDate: '2026-11-30',
   excerpt: `#,Keyword,Country,Volume,Languages\n${sourceRow},${keyword},us,30,English` };
 });
 const command = satelliteQuarterCommandSchema.parse({ action: 'apply_satellite_quarter', requestId: 'test-fixture-200', expectedVersion: 30, rows });
 assert.equal(satelliteQuarterProblem(command, approved, now), null);
 assert.equal(satelliteQuarterHash(rows), satelliteQuarterHash([...rows].reverse()));
 assert.equal(satelliteQuarterCommandSchema.safeParse({ ...command, rows: rows.slice(1) }).success, false);
 const problem = patch => satelliteQuarterProblem({ ...command, rows: [...rows.slice(0, -1), { ...rows.at(-1), ...patch }] }, approved, now);
 assert.match(problem({ researchDate: '2026-11-29' }), /真实工作日/);
 assert.match(problem({ volume: 40 }), /原始导出行/);
 assert.match(problem({ ...rows[0], siteDomain: 'rackrate.org' }), /重复/);
 assert.match(satelliteQuarterProblem({ ...command, rows: rows.map(row => ({ ...row, siteDomain: 'modelfit.cc' })) }, approved, now), /涵盖/);
 approved.satelliteQuarter = { baselinePlanHash: "8".repeat(64), members: rows };
 const extend = satelliteQuarterCommandSchema.parse({ ...command, mode: "extend", rows: [
  { ...rows[0], keyword: "verified additional source word", sourceRow: 301, excerpt: "#,Keyword,Country,Volume,Languages\n301,verified additional source word,us,30,English" },
 ] });
 assert.equal(satelliteQuarterProblem(extend, approved, now), null);
 assert.equal(satelliteQuarterProblem({ ...extend, rows: [] }, approved, now), null);
 assert.equal(satelliteQuarterCommandSchema.safeParse({ ...extend, rows: [rows[199]] }).success, false);
 assert.match(satelliteQuarterProblem({ ...extend, rows: [rows[0]] }, approved, now), /重复/);
});
