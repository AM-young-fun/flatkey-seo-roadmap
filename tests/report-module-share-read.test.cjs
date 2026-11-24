const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const original=Module._load;let rows=[],lastQuery;
Module._load=function(name,...args){if(name==='@/lib/prisma')return{prisma:{seoReportVersion:{findMany:async q=>{lastQuery=q;return rows;}}}};if(name==='@/lib/env')return{isDatabaseConfigured:()=>true};return original.call(this,name,...args);};
const{loadReportModuleShares}=require('../src/lib/services/report-module-shares.ts');Module._load=original;
const period={start:'2026-11-19',end:'2026-11-25'},previous={start:'2026-11-12',end:'2026-11-18'},now=new Date('2026-11-26T12:00:00Z');
test('reuses exact whole-period saved source only, stripping future extensions and preserving the original payload',async()=>{
  const values={current:{all:100,modelDetail:80,prompts:70,secret:'private'},previous:{all:100,modelDetail:70,prompts:60},observedAt:'2026-11-26T11:00:00Z',secret:'private'};
  rows=[{id:'seo-digest:2026-11-26:'+'a'.repeat(16),payload:{kind:'weekly',dashboard:{moduleShares:values,sourceEvidenceSha256:'b'.repeat(64)}}}];const before=structuredClone(rows);
  const result=await loadReportModuleShares(period,previous,'weekly',now);assert.equal(result.values.current.modelDetail,80);assert.doesNotMatch(JSON.stringify(result),/private|secret/);assert.deepEqual(rows,before);
  assert.equal(lastQuery.where.AND[0].payload.equals,period.start);assert.equal(lastQuery.where.AND[1].payload.equals,period.end);assert.equal(lastQuery.select.payload,true);
});
test('mismatched periods, invalid subsets, daily sources and delayed or future source times remain missing rather than summed',async()=>{
  const source=structuredClone(rows[0]);
  for(const mutate of [r=>r.payload.kind='daily',r=>r.payload.dashboard.moduleShares.current.modelDetail=101,r=>r.payload.dashboard.moduleShares.observedAt='2026-11-25T12:00:00Z',r=>r.payload.dashboard.moduleShares.observedAt='2026-11-27T12:00:00Z',r=>r.payload.moduleShareSnapshot={values:r.payload.dashboard.moduleShares,sourceEvidenceSha256:'b'.repeat(64),period,comparisonPeriod:{start:'2026-11-11',end:'2026-11-17'},timezone:'America/Los_Angeles'}]){const candidate=structuredClone(source);mutate(candidate);rows=[candidate];assert.equal(await loadReportModuleShares(period,previous,'weekly',now),undefined);}
});
