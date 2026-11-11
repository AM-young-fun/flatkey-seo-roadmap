const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const load=Module._load;
Module._load=function(name,...rest){return name==='server-only'?{}:load.call(this,name,...rest);};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {enrichGithubReferrals}=require('../src/lib/services/ga4-github-referrals.ts');
const missing={status:'unavailable',count:null,uniques:null,days:[],reason:'permission'};
const fixture={version:1,kind:'github-prompt-channel',repository:'flatkey-ai/awesome-images',observedAt:'2026-11-11T01:00:00Z',timezone:'UTC',stars:12,forks:2,metadataStatus:'ok',metadataReason:null,views:missing,clones:missing,referrals:[],linkAudit:{status:'ok',flatkeyLinks:1,attributedLinks:1,reason:null}};
test('Google enrichment preserves original GitHub date and missing traffic; each referral has an actual independent date',async()=>{
 const windows=[{start:'2026-11-10',end:'2026-11-10'}];let calls=0;
 const fetcher=async(repository,start,end)=>{calls++;assert.equal(repository,fixture.repository);return {start,end,timezone:'America/Los_Angeles',status:'ok',sessions:4,users:3,observedAt:'2026-11-11T09:00:00Z',reason:null};};
 const [row]=await enrichGithubReferrals([fixture],windows,fetcher);
 assert.equal(calls,1);assert.equal(row.observedAt,fixture.observedAt);assert.equal(row.stars,12);assert.deepEqual(row.views,missing);assert.equal(row.referrals[0].observedAt,'2026-11-11T09:00:00Z');assert.deepEqual(fixture.referrals,[]);
 const [again]=await enrichGithubReferrals([row],windows,fetcher);assert.equal(again.referrals.length,1);
});
test('Google failure remains unavailable and does not invent a missing GitHub repository snapshot',async()=>{
 const [row]=await enrichGithubReferrals([fixture],[{start:'2026-11-10',end:'2026-11-10'}],async(_,start,end)=>({start,end,timezone:'America/Los_Angeles',status:'unavailable',sessions:null,users:null,observedAt:'2026-11-11T09:00:00Z',reason:'ga4_http_403'}));
 assert.equal(row.referrals[0].sessions,null);assert.equal(row.referrals[0].status,'unavailable');assert.equal(row.observedAt,fixture.observedAt);
 assert.deepEqual(await enrichGithubReferrals([],[],async()=>{throw Error('must not query unknown repository');}),[]);
});
