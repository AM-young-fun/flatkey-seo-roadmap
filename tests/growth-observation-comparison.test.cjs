const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const{prepareGrowthObservationComparison}=require('../src/lib/growth-observation-comparison.ts');
const{growthObservationComparisonText}=require('../src/lib/growth-observation-display.ts');
const{growthStrategyCommandSchema,growthStrategyStoredSchema,emptyGrowthStrategy,unavailableGrowthReportSnapshot,growthReportLines}=require('../src/lib/growth-strategy.ts');
const{buildSeoDigest}=require('../src/lib/seo-digest.ts');
const now=new Date('2026-11-23T12:00:00Z'),pub={id:'pub-opt',taskId:'task-opt',siteDomain:'flatkey.ai',pageUrl:'https://flatkey.ai/blog/gpu',contentVersion:'sha-v2',publishedAt:'2026-11-01T12:00:00Z',country:'US',language:'en',kind:'optimization'};
const dates=(start,n)=>Array.from({length:n},(_,i)=>new Date(Date.parse(start+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
const evidence=()=>[{source:'GA4',reference:'archive:actual-page-window',observedAt:'2026-11-22T12:00:00Z'}];
const full=()=>({status:'complete',publicationId:pub.id,taskId:pub.taskId,contentVersion:pub.contentVersion,site:pub.siteDomain,pageUrl:pub.pageUrl,country:'US',language:'en',source:'GA4',propertyId:'541304395',sourceTimezone:'America/Los_Angeles',scope:'page-session-organic-search',before:{start:'2026-10-18',end:'2026-10-31',coveredDates:dates('2026-10-18',14),sessions:100,evidence:evidence(),limitations:[]},after:{start:'2026-11-02',end:'2026-11-15',coveredDates:dates('2026-11-02',14),sessions:180,evidence:evidence(),limitations:[]},reason:'Same page, original market, equal complete periods',limitations:[]});
const evaluate=(input,publication=pub,sessions=180)=>prepareGrowthObservationComparison(input,publication,14,{sourceTimezone:'America/Los_Angeles',propertyId:'541304395',now,sessions});
test('an optimized page compares complete equal-length windows and derives true previousSessions/delta without changing its delivery',()=>{
  const result=evaluate(full());assert.deepEqual(result.issues,[]);assert.equal(result.comparison.previousSessions,100);assert.equal(result.comparison.currentSessions,180);assert.equal(result.comparison.delta,80);assert.equal(result.comparison.relativeChange,.8);
  const text=growthObservationComparisonText(result.comparison,14);assert.match(text,/上线前14日 2026-10-18—2026-10-31 的 100/);assert.match(text,/上线后14日 2026-11-02—2026-11-15 的 180/);assert.match(text,/变化\+80/);assert.match(text,/尚不构成因果证明/);assert.equal(pub.kind,'optimization');
});
test('one day cannot impersonate a 14-day window and unequal before/after windows are rejected',()=>{
  const single=full();single.before.coveredDates=['2026-10-31'];assert.ok(evaluate(single).issues.some(x=>x.includes('缺日')));
  const unequal=full();unequal.before.start='2026-10-25';unequal.before.coveredDates=dates('2026-10-25',7);assert.ok(evaluate(unequal).issues.some(x=>x.includes('两窗必须等长')));
  const changed=full();changed.contentVersion='another-version';assert.ok(evaluate(changed).issues.some(x=>x.includes('原发布版本')));
});
test('missing source remains null with insufficient_data and does not manufacture a zero baseline or improvement',()=>{
  const input=full();input.status='insufficient_data';input.before.sessions=null;input.before.coveredDates=[];input.before.evidence=[];input.before.limitations=['Historic GA4 source unavailable'];input.limitations=['Before-window source missing'];input.reason='Wait for original window archive';
  const result=evaluate(input);assert.deepEqual(result.issues,[]);assert.equal(result.comparison.previousSessions,null);assert.equal(result.comparison.currentSessions,180);assert.equal(result.comparison.delta,null);assert.equal(result.comparison.relativeChange,null);assert.match(growthObservationComparisonText(result.comparison,14),/不计算增量或涨幅/);
  input.before.sessions=0;assert.ok(evaluate(input).issues.some(x=>x.includes('必须保留null')));
});
test('a new page has no historical baseline and records new_page with null, while an optimization cannot use that escape',()=>{
  const input=full();input.status='new_page';input.before.sessions=null;input.before.coveredDates=[];input.before.evidence=[];input.before.limitations=['First publication; no previous page'];input.reason='New page has no historical baseline';
  const result=evaluate(input,{...pub,kind:'source_blog'});assert.deepEqual(result.issues,[]);assert.equal(result.comparison.previousSessions,null);assert.equal(result.comparison.delta,null);assert.match(growthObservationComparisonText(result.comparison,14),/新页没有上线前14日历史基线/);
  assert.ok(evaluate(input).issues.some(x=>x.includes('旧页优化')));
});
test('new records require comparison, historical 56-day receipts remain readable, and daily/weekly text consumes the structured result',()=>{
  const legacy={id:'legacy-56',publicationId:pub.id,taskId:pub.taskId,site:pub.siteDomain,pageUrl:pub.pageUrl,contentVersion:pub.contentVersion,publishedAt:pub.publishedAt,checkpoint:56,checkedAt:now.toISOString(),timezone:'America/Los_Angeles',windowStart:'2026-11-02',windowEnd:'2026-12-27',indexing:'unknown',rank:null,sessions:null,evidence:[{source:'manual',reference:'old-receipt',observedAt:now.toISOString(),supports:'legacy observation'}],conclusion:'Old window retained',nextAction:'Original task'};
  assert.equal(growthStrategyStoredSchema.safeParse({...emptyGrowthStrategy(),observations:[legacy]}).success,true);
  assert.equal(growthStrategyCommandSchema.safeParse({requestId:'new-observation-1',expectedVersion:0,action:'record_observation',observation:{...legacy,checkpoint:14}}).success,false);
  const growth=unavailableGrowthReportSnapshot({start:'2026-11-12',end:'2026-11-18'},now);growth.observations=[{...legacy,checkpoint:14,comparison:evaluate(full()).comparison}];
  assert.match(growthReportLines(growth).join('\n'),/变化\+80/);
  const base={now,notificationCompact:true,growthSnapshot:growth,observations:[],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:'missing',optimizationCoverage:'missing'};
  for(const[kind,date]of[['daily','2026-11-23'],['weekly','2026-11-19']]){const report=buildSeoDigest({...base,kind,date});assert.match(report.text,/变化\+80/);assert.match(report.text,/前窗14\/14日，后窗14\/14日/);}
});
