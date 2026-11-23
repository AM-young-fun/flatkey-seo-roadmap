const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const load=Module._load;let calls=0,query,archive=[];
Module._load=function(name,parent,...rest){if(name==="../prisma"&&parent.filename.endsWith("/monthly-page-archive.ts"))return{prisma:{seoAnalyticsDay:{findMany:async options=>{calls++;query=options;return archive;}}}};return load.call(this,name,parent,...rest);};
const {loadMonthlyPageArchive,monthlyArchiveScope}=require('../src/lib/services/monthly-page-archive.ts');Module._load=load;
const {recentPublishedPages,monthlyOptimizationChanges}=require('../src/lib/seo-digest-recent-pages.ts');
const targets=[{pageUrl:'https://flatkey.ai/models/a?x=1',siteDomain:'flatkey.ai'}];
test('archive scope preserves exact query URL/host/path and excludes unrelated site archives',()=>{
 assert.deepEqual(monthlyArchiveScope(targets),{kinds:['ga4-pages','gsc-pages'],urls:['https://flatkey.ai/models/a?x=1'],paths:['flatkey.ai/models/a?x=1']});
});
test("empty candidate set skips reads; native scoped query preserves metadata and matching row order",async()=>{
 calls=0;assert.deepEqual(await loadMonthlyPageArchive([],"2026-10-01","2026-11-29"),[]);assert.equal(calls,0);
 const matching={url:targets[0].pageUrl,clicks:2};
 archive=[{payload:{kind:"gsc-pages",complete:false,rows:[matching,{url:"https://other.ai/"},matching]}}];
 assert.deepEqual(await loadMonthlyPageArchive(targets,"2026-10-01","2026-11-29"),[{payload:{kind:"gsc-pages",complete:false,rows:[matching,matching]}}]);
 assert.equal(calls,1);assert.deepEqual(query.where,{date:{gte:"2026-10-01",lte:"2026-11-29"},kind:{in:["ga4-pages","gsc-pages"]}});
});
test('all eligible candidates are retained before ranking; filtering unrelated observations preserves complete ranking and visits',()=>{
 const now=new Date('2026-11-24T02:00:00Z');const workflow={approvals:[],publications:Array.from({length:12},(_,i)=>({id:'p'+i,pageUrl:'https://flatkey.ai/p'+i,siteDomain:'flatkey.ai',title:'p'+i,kind:'optimization',status:'verified',publishedAt:'2026-11-01T16:00:00Z',verifiedAt:'2026-11-01T17:00:00Z',verificationRecordedAt:'2026-11-01T18:00:00Z'}))};
 const candidates=monthlyOptimizationChanges(workflow,'2026-11-24',now,false);assert.equal(candidates.size,12);
 const urls=new Set([...candidates.keys()]);const rows=['2026-10-31','2026-11-23'].flatMap((date,d)=>[
 {kind:'gsc-pages',date,property:'sc-domain:flatkey.ai',complete:true,observedAt:now.toISOString(),rows:Array.from({length:1000},(_,i)=>({url:'https://flatkey.ai/p'+i,clicks:d?i+1:0,impressions:d?i+10:0}))},
 {kind:'ga4-pages',date,property:'541304395',complete:true,hostnameDimension:'hostName',observedAt:now.toISOString(),rows:Array.from({length:1000},(_,i)=>({hostname:'flatkey.ai',path:'/p'+i,sessions:d?i+1:0}))}]);
 const projected=rows.map(row=>({...row,rows:row.rows.filter(item=>urls.has(item.url??'https://'+item.hostname+item.path))}));
 const original=recentPublishedPages(workflow,rows,'2026-11-24',now,false);
 assert.deepEqual(recentPublishedPages(workflow,projected,'2026-11-24',now,false),original);assert.equal(original.length,10);assert.ok(Buffer.byteLength(JSON.stringify(projected))<Buffer.byteLength(JSON.stringify(rows))/30);
});
