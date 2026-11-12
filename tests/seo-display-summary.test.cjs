const assert = require('node:assert/strict'), {test} = require('node:test'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {metricStats,changeText}=require('../src/lib/seo-display-summary.ts');
const range={start:'2026-10-20',end:'2026-10-26'};
const stats=(...values)=>metricStats(values.map(sessions=>({sessions,registrations:null})),'sessions');
test('missing days suppress comparison; a measured zero stays zero',()=>{
 assert.equal(stats(null).total,null); assert.equal(stats(0).total,0);
 assert.equal(changeText(stats(100,null),stats(50,50),range),'数据未齐，暂不比较');
 assert.equal(changeText(stats(100,100),stats(50,null),range),'对比期数据未齐');
});
test('equal periods compare totals while unequal periods compare daily averages',()=>{
 assert.equal(changeText(stats(1164),stats(1100),range),'比对比期多 5.8%');
 assert.equal(changeText(stats(69),stats(107),range),'比对比期少 35.5%');
 assert.equal(changeText(stats(200,200),stats(100),range),'日均比对比期多 100.0%');
});
test('zero baseline uses absolute difference and no comparison stays quiet',()=>{
 assert.equal(changeText(stats(8),stats(0),range),'比对比期多 8');
 assert.equal(changeText(stats(0),stats(0),range),'与对比期持平');
 assert.equal(changeText(stats(8),null,null),'');
});
