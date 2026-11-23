const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const{digestDailyNativeRankingNotes}=require('../src/lib/seo-digest-rankings.ts');
const row=(id,extra={})=>({id,keyword:'gpu keyword '+id,site:'flatkey.ai',country:'US',language:'en',membership:'opportunity',rank:20,rankUrl:'https://flatkey.ai/blog/gpu-'+id,rankSource:'serp',checkedAt:'2026-11-23T07:00:00Z',languageStatus:'match',captureState:'ranked',rankEligible:true,observationEligible:true,captureScope:'DIAGNOSTIC',...extra});
const workspace=targets=>({generatedAt:'2026-11-23T12:00:00Z',targets});
test('daily notes count all native diagnostic SERPs across memberships, not just the two formal targets',()=>{
  const targets=Array.from({length:200},(_,i)=>row('word-'+i,{membership:i<2?'formal':i%3===0?'review':'opportunity',rank:i<155?20:80}));
  targets.push(...targets.slice(0,4).map((target,i)=>({...target,id:'cross-site-'+i,site:'rackrate.org',rank:80,rankUrl:'https://rackrate.org/pricing/gpu-'+i,membership:'opportunity'})));
  const notes=digestDailyNativeRankingNotes(workspace(targets),'2026-11-22'),text=notes.join('\n');
  assert.match(text,/前100有排名 204 个组合/);assert.match(text,/去重原词 200 个/);assert.match(text,/前50 155 个组合/);assert.match(text,/正式规划有排名 2 个组合，机会及待归类 202 个组合/);assert.match(text,/https:\/\/flatkey\.ai\/blog\//);assert.ok(notes.filter(line=>/^\[/.test(line)).length<=5);
});
test('daily notes use the exact LA day and never borrow old, future, stale, database, GSC or language-mismatched evidence',()=>{
  const targets=[row('valid'),row('old-day',{checkedAt:'2026-11-22T07:59:59Z'}),row('future',{checkedAt:'2026-11-24T01:00:00Z'}),row('database',{rankSource:'database'}),row('gsc',{rankSource:'gsc'}),row('wrong-language',{languageStatus:'mismatch'}),row('unknown-language',{languageStatus:'unknown'}),row('brand',{keyword:'Flatkey API'}),row('failed',{rank:null,captureState:'failed',rankEligible:false,observationEligible:false})];
  assert.match(digestDailyNativeRankingNotes(workspace(targets),'2026-11-22').join('\n'),/前100有排名 1 个组合/);
  assert.deepEqual(digestDailyNativeRankingNotes(workspace([row('old-day',{checkedAt:'2026-11-22T07:59:59Z'})]),'2026-11-22'),[]);
  assert.deepEqual(digestDailyNativeRankingNotes({...workspace([row('stale')]),generatedAt:'2026-12-10T12:00:00Z'},'2026-11-22'),[]);
  assert.deepEqual(digestDailyNativeRankingNotes(workspace(targets),'2026-11-23'),[]);
});
test('complete outside100 is a real zero-ranked receipt, incomplete misses remain unknown, and HTTPS examples belong to the ranked site',()=>{
  const targets=[row('outside',{rank:null,rankUrl:null,captureState:'outside100',rankEligible:false}),row('incomplete',{rank:null,rankUrl:null,captureState:'incomplete',rankEligible:false,observationEligible:false}),row('http',{rankUrl:'http://flatkey.ai/blog/test'}),row('foreign',{rankUrl:'https://competitor.example/blog/test'})];
  const notes=digestDailyNativeRankingNotes(workspace(targets),'2026-11-22').join('\n');assert.match(notes,/前100有排名 0 个组合/);assert.match(notes,/完整核验 1 个组合，确认前100外 1 个/);assert.doesNotMatch(notes,/http:|competitor/);
  const boundary=digestDailyNativeRankingNotes(workspace([row('boundary',{checkedAt:'2026-11-22T08:00:00Z'})]),'2026-11-22');assert.match(boundary.join('\n'),/前100有排名 1/);
});
test('duplicate identities are not double-counted and one real country-language result is not reassigned to another market',()=>{
  const target=row('same'),copy={...target,id:'copy'},japanese=row('japanese',{keyword:'日本 GPU 料金',country:'JP',language:'ja',rankUrl:'https://flatkey.ai/ja/blog/gpu'});
  const text=digestDailyNativeRankingNotes(workspace([target,copy,japanese]),'2026-11-22').join('\n');assert.match(text,/前100有排名 2 个组合/);assert.match(text,/日本 JP · ja：前100 1/);assert.match(text,/美国 US · en：前100 1/);assert.match(text,/\[日本 GPU 料金\]\(https:\/\/flatkey\.ai\/ja\/blog\/gpu\)/);
});
