const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const originalLoad=Module._load;
let sharedMode=false,workspaceReads=0,legacyRankReads=0,sharedWorkspace=null,workspaceAsOf=null;
const fixtureWorkspace={generatedAt:'2026-11-23T12:00:00Z',targets:[{id:'saved-diagnostic',site:'flatkey.ai',keyword:'gpu pricing',country:'US',language:'en',membership:'opportunity',rank:8,rankUrl:'https://flatkey.ai/blog/gpu-pricing',rankSource:'serp',checkedAt:'2026-11-23T07:00:00Z',languageStatus:'match',captureState:'ranked',rankEligible:true,observationEligible:true,captureScope:'DIAGNOSTIC'}]};
Module._load=function(name,parent,...args){
  if(name==='server-only')return {};
  if(name==='@/lib/prisma'||name==='../prisma')return {prisma:{seoAnalyticsDay:{findMany:async()=>[]},collectorRun:{findMany:async()=>[]}}};
  if(name==='./growth-strategy'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadGrowthReportSnapshot:async(_date,_local,now,provided)=>{if(!sharedMode)throw Error('injected source outage');sharedWorkspace=provided?.workspace;return require('../src/lib/growth-strategy.ts').unavailableGrowthReportSnapshot({start:'2026-11-12',end:'2026-11-18'},now);}};
  if(name==='./growth-workspace'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadGrowthWorkspace:async(_local,asOf)=>{workspaceReads++;workspaceAsOf=asOf;return fixtureWorkspace;}};
  if(name==='./seo-workflow'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadWorkflowSnapshot:async(options)=>require('../src/lib/seo-workflow-state.ts').workflowSnapshot([],options,'database')};
  if(name==='./seo-registration-period'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadRegistrationPeriods:async()=>[]};
  if(name==='./seo-business-analytics'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadBusinessAnalytics:async()=>[]};
  if(name==='./seo-github-channel'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadGithubChannels:async()=>[]};
  if(name==='./seo-account-registrations'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadAccountRegistrationSummary:async(range)=>require('../src/lib/seo-account-registrations.ts').accountRegistrationSummary(range)};
  if(name==='./daily-seo-page-groups'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadDailySeoPageGroupsHistory:async()=>undefined};
  if(name==='./daily-seo-traffic'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadDailySeoTrafficHistory:async()=>undefined};
  if(name==='./approved-weekly-keyword-capture'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadApprovedWeeklyKeywordCapture:async()=>null};
  if(name==='./serp-results'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadSerpTasks:async()=>{legacyRankReads++;return [];}};
  if(name.startsWith('@/'))return originalLoad.call(this,path.resolve(__dirname,'../src',name.slice(2))+(name.endsWith('.cjs')?'':'.ts'),parent,...args);
  return originalLoad.call(this,name,parent,...args);
};
const {generateSeoDigest}=require('../src/lib/services/seo-digest.ts');
test('a real generation read failure keeps the current five blocks and unknown quarter goals rather than silently switching to legacy template',async()=>{
  const result=await generateSeoDigest('2026-11-19',new Date('2026-11-23T12:00:00Z'),'weekly');
  assert.equal(result.growthSnapshot.sourceVersion,'unavailable');assert.equal(result.growthSnapshot.goals.weeklySessions,null);assert.equal(result.growthSnapshot.goals.baselineCount,null);
  for(const section of ['一','二','三','四','五'])assert.match(result.text,new RegExp('\\*\\*'+section+'、'));
  assert.doesNotMatch(result.text,/\\*\\*六、|GitHub/);
  assert.match(result.detailText,/季度目标与方向证据读取失败/);assert.match(result.text,/同窗口来源未齐/);
});
test('daily ranking notes and the growth snapshot share one complete workspace read and never fall back to the legacy scope-filtered loader',async()=>{
  sharedMode=true;workspaceReads=0;legacyRankReads=0;
  const result=await generateSeoDigest('2026-11-23',new Date('2026-11-23T12:00:00Z'),'daily');
  assert.equal(workspaceReads,1);assert.equal(sharedWorkspace,fixtureWorkspace);assert.equal(legacyRankReads,0);
  assert.equal(workspaceAsOf.toISOString(),'2026-11-23T07:59:59.999Z');
  assert.match(result.rankingNotes.join('\n'),/前100有排名 1 个组合/);assert.match(result.rankingNotes.join('\n'),/正式规划有排名 0 个组合，机会及待归类 1 个组合/);assert.match(result.rankingNotes.join('\n'),/https:\/\/flatkey\.ai\/blog\/gpu-pricing/);
});
