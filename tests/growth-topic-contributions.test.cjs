const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {growthContributionDrivers,growthTopicContributions}=require('../src/lib/growth-topic-contributions.ts');
const window={start:'2026-11-12',end:'2026-11-18',previousStart:'2026-11-05',previousEnd:'2026-11-11',timezone:'America/Los_Angeles'};
const driver=(patch={})=>({url:'https://flatkey.ai/blog/gpu',topicId:'gpu',country:'US',language:'en',source:'GA4',metric:'sessions',previous:10,current:20,window,...patch});
const snapshot=rows=>({period:{start:window.start,end:window.end,timezone:window.timezone},directions:[{drivers:rows},{drivers:rows}]});
test('overview and topic rows reuse exact saved page evidence once, retaining metric/source/market/comparison dimensions',()=>{
 const source=snapshot([driver(),driver({url:'https://flatkey.ai/blog/gpu2',previous:4,current:9}),driver({country:'JP',language:'ja',current:30}),driver({source:'GSC',metric:'clicks',previous:2,current:3})]);
 const input=JSON.stringify(source);assert.equal(growthContributionDrivers(source).length,4);
 const rows=growthTopicContributions(source,{site:'flatkey.ai',topicId:'gpu'},{country:'all',language:'all'});
 assert.equal(rows.length,3);const us=rows.find(row=>row.metric==='sessions'&&row.country==='US');assert.equal(us.previous,14);assert.equal(us.current,29);assert.equal(us.urls.length,2);
 assert.equal(growthTopicContributions(source,{site:'flatkey.ai',topicId:'gpu'},{country:'JP',language:'ja'}).length,1);assert.equal(JSON.stringify(source),input);
});
test('wrong site/topic, stale window, native timezone, incompatible source and overlapping comparison cannot become a topic total',()=>{
 const source=snapshot([driver({topicId:'other'}),driver({url:'https://modelfit.cc/blog/gpu'}),driver({window:{...window,start:'2026-11-11'}}),driver({window:{...window,timezone:'Asia/Shanghai'}}),driver({source:'GSC'}),driver({window:{...window,previousEnd:window.start}})]);
 assert.deepEqual(growthTopicContributions(source,{site:'flatkey.ai',topicId:'gpu'},{country:'all',language:'all'}),[]);
 assert.deepEqual(growthTopicContributions(null,{site:'flatkey.ai',topicId:'gpu'},{country:'all',language:'all'}),[]);
});
test('conflicting duplicate observations are withheld rather than taking whichever direction was returned last',()=>{
 assert.deepEqual(growthContributionDrivers(snapshot([driver(),driver({current:21})])),[]);
});
test('one page attributed to two topics counts once by module and is withheld from both topic totals',()=>{
 const source=snapshot([driver({module:'blog'}),driver({module:'blog',topicId:'api'})]);
 const before=JSON.stringify(source), rows=growthContributionDrivers(source,'sessions');assert.equal(rows.length,1);assert.equal(rows[0].current,20);assert.equal(rows[0].topicId,null);assert.equal(rows[0].module,'blog');
 for(const topicId of ['gpu','api'])assert.deepEqual(growthTopicContributions(source,{site:'flatkey.ai',topicId},{country:'all',language:'all'}),[]);
 assert.equal(JSON.stringify(source),before);
 assert.deepEqual(growthContributionDrivers(snapshot([driver({topicId:'gpu'}),driver({topicId:'api',current:99})])),[],'different topic must not mask conflicting metric values');
});
test('a unique explicit topic remains usable while conflicting modules stay unassigned, with one observation only',()=>{
 const rows=growthContributionDrivers(snapshot([driver({topicId:null,module:'blog'}),driver({module:'models'})]));
 assert.equal(rows.length,1);assert.equal(rows[0].topicId,'gpu');assert.equal(rows[0].module,'模块待核');assert.equal(rows[0].current,20);
});
