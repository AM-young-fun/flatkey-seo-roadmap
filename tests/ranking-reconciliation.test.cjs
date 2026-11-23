const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText,f);
const {reconcileRankings}=require('../src/lib/ranking-reconciliation.ts');
const url='https://flatkey.ai/blog/example',date='2026-11-23T03:00:00Z';
const check=(keyword='example pricing',country='US',rank=8)=>({keywordId:'existing-id',keyword,country,language:country==='JP'?'ja':'en',targetUrls:[url],checkedAt:date,captured:true,pages:rank?[{keyword,country,rank,url,checkedAt:date,collectedAt:date,source:'serp'}]:[]});
const base=()=>({checks:[check()],discovery:{complete:true,items:[]},memberships:[{keywordId:'existing-id',active:true,pool:'FORMAL',keyword:{text:'example pricing',active:true},targetUrls:[url]}],inventory:[{url,lastSeen:'2026-11-19T00:00:00Z'}],workflow:{tasks:[],publications:[]},generatedAt:date});
const discovery=(keyword,rank=23)=>({keyword,observations:[{keyword,country:'US',rank,url,sourceSerpUpdatedAt:'2026-09-20T00:00:00Z',collectedAt:'2026-11-22T11:00:00Z'}]});
test('domain discovery is merged with target checks, words and rank buckets count once while page ranks stay independent',()=>{
 const input=base();input.discovery.items=[discovery('a100 rental')];input.checks[0].pages.push({...input.checks[0].pages[0],url:url+'-second',rank:19});
 const r=reconcileRankings(input);assert.equal(r.total,2);assert.equal(r.ranked.find(w=>w.keyword==='example pricing').rank,8);assert.equal(r.ranked.find(w=>w.keyword==='example pricing').pages.length,2);
 assert.equal(r.countries.reduce((sum,c)=>sum+c.count,0),r.total);assert.equal(r.bands.reduce((sum,c)=>sum+c.count,0),r.total);assert.equal(r.ranked.find(w=>w.keyword==='a100 rental').checkedAt,'2026-09-20T00:00:00Z');
});
test('a newer checked miss does not resurrect an old indexed hit or fabricate ranking loss',()=>{
 const input=base();input.checks=[check('a100 rental','US',null)];input.discovery.items=[discovery('a100 rental')];
 const r=reconcileRankings(input);assert.equal(r.total,0);assert.equal(r.historical.length,1);assert.equal(r.unrankedBuilt.length,1);assert.equal(r.unrankedBuilt[0].captured,true);assert.equal(r.quote.newQueryCount,0);
});
test('unbuilt plans and archived library entries cannot become built unranked pages or paid query requests',()=>{
 const input=base();input.checks=[check('example pricing','US',null)];input.inventory=[];const r=reconcileRankings(input);assert.equal(r.unrankedBuilt.length,0);assert.equal(r.quote.maxCostMicros,0);
 input.inventory=[{url,lastSeen:date}];input.memberships[0].active=false;assert.equal(reconcileRankings(input).unrankedBuilt.length,0);
});
test('published page targets reuse their real keyword ID and create one unapproved fee row despite multiple publications',()=>{
 const input=base();input.checks=[];input.memberships=[{keywordId:'real-cuda-id',active:true,pool:'FORMAL',keyword:{text:'cuda version compatibility',active:true},targetUrls:[url]}];input.workflow.tasks=[{id:'t',keyword:'cuda version compatibility',country:'US',language:'en'}];
 input.workflow.publications=[{id:'p1',taskId:'t',status:'verified',publishedAt:date,pageUrl:url,language:'en'},{id:'p2',taskId:'t',status:'verified',publishedAt:date,pageUrl:url+'-second',language:'en'}];
 const r=reconcileRankings(input);assert.equal(r.unrankedBuilt.length,1);assert.equal(r.unrankedBuilt[0].pages.length,2);assert.equal(r.quote.newQueryCount,1);assert.equal(r.quote.maxCostMicros,12000);assert.equal(r.missing[0].keywordId,'real-cuda-id');assert.equal(r.missing[0].approved,false);
 input.memberships[0].pool='RESEARCH';assert.equal(reconcileRankings(input).unrankedBuilt.length,1,'actual publication still counts before a library promotion');
});
test('wrong-country English wording on translated pages remains held, never a repeated paid country query',()=>{
 const input=base();input.checks=[];input.workflow.tasks=[{id:'t',keyword:'gpu direct storage',country:'JP',language:'ja'}];input.workflow.publications=[{id:'p',taskId:'t',status:'verified',publishedAt:date,pageUrl:'https://flatkey.ai/ja/blog/gpu-direct-storage',language:'ja'}];
 const r=reconcileRankings(input);assert.equal(r.unrankedBuilt.length,1);assert.equal(r.quote.newQueryCount,0);assert.equal(r.quote.heldCount,1);assert.equal(r.quote.maxCostMicros,0);
});
test('unknown database language and offsite URLs cannot inflate the total',()=>{
 const input=base();input.discovery.items=[discovery('unknown shared identifier')];input.checks[0].pages.push({...input.checks[0].pages[0],keyword:'offsite',url:'https://example.com',rank:1});const r=reconcileRankings(input);
 assert.equal(r.total,1);assert.equal(r.languagePending.length,1);
});
