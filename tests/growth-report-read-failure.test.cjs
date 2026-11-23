const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const originalLoad=Module._load;
Module._load=function(name,parent,...args){
  if(name==='server-only')return {};
  if(name==='@/lib/prisma'||name==='../prisma')return {prisma:{seoAnalyticsDay:{findMany:async()=>[]},collectorRun:{findMany:async()=>[]}}};
  if(name==='./growth-strategy'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadGrowthReportSnapshot:async()=>{throw Error('injected source outage');}};
  if(name==='./seo-workflow'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadWorkflowSnapshot:async(options)=>require('../src/lib/seo-workflow-state.ts').workflowSnapshot([],options,'database')};
  if(name==='./seo-registration-period'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadRegistrationPeriods:async()=>[]};
  if(name==='./seo-business-analytics'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadBusinessAnalytics:async()=>[]};
  if(name==='./seo-github-channel'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadGithubChannels:async()=>[]};
  if(name==='./seo-account-registrations'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadAccountRegistrationSummary:async(range)=>require('../src/lib/seo-account-registrations.ts').accountRegistrationSummary(range)};
  if(name==='./daily-seo-page-groups'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadDailySeoPageGroupsHistory:async()=>undefined};
  if(name==='./daily-seo-traffic'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadDailySeoTrafficHistory:async()=>undefined};
  if(name==='./approved-weekly-keyword-capture'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadApprovedWeeklyKeywordCapture:async()=>null};
  if(name==='./serp-results'&&parent.filename.endsWith('/services/seo-digest.ts'))return {loadSerpTasks:async()=>[]};
  if(name.startsWith('@/'))return originalLoad.call(this,path.resolve(__dirname,'../src',name.slice(2))+(name.endsWith('.cjs')?'':'.ts'),parent,...args);
  return originalLoad.call(this,name,parent,...args);
};
const {generateSeoDigest}=require('../src/lib/services/seo-digest.ts');
test('a real generation read failure keeps the v1.5 six blocks and unknown quarter goals rather than silently switching to legacy template',async()=>{
  const result=await generateSeoDigest('2026-11-19',new Date('2026-11-23T12:00:00Z'),'weekly');
  assert.equal(result.growthSnapshot.sourceVersion,'unavailable');assert.equal(result.growthSnapshot.goals.weeklySessions,null);assert.equal(result.growthSnapshot.goals.baselineCount,null);
  for(const section of ['一','二','三','四','五','六'])assert.match(result.text,new RegExp('\\*\\*'+section+'、'));
  assert.match(result.detailText,/季度目标与方向证据读取失败/);assert.match(result.text,/同窗口来源未齐/);
});
