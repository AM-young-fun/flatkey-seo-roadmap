const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),Module=require("node:module"),ts=require("typescript");
require.extensions[".ts"]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const load=Module._load;let calls=0,query,sql,archive=[],versions=[],failRevision=false,failRead=false;
Module._load=function(name,parent,...rest){if(name==="../prisma"&&parent.filename.endsWith("/monthly-page-archive.ts"))return{prisma:{$queryRaw:async q=>{sql=q;if(failRevision)throw Error("unavailable");return versions;},seoAnalyticsDay:{findMany:async options=>{calls++;query=options;if(failRead)throw Error("read failed");return options.where.OR?archive.filter(day=>options.where.OR.some(scope=>scope.kind===day.kind&&scope.date===day.date)):archive;}}}};return load.call(this,name,parent,...rest);};
const {loadMonthlyPageArchive,monthlyArchiveScope}=require("../src/lib/services/monthly-page-archive.ts");Module._load=load;
const {recentPublishedPages,monthlyOptimizationChanges}=require("../src/lib/seo-digest-recent-pages.ts");
const targets=[{pageUrl:"https://flatkey.ai/models/a?x=1",siteDomain:"flatkey.ai"}];
const payload=clicks=>({kind:"gsc-pages",complete:false,observedAt:"2026-11-01T00:00:00Z",rows:[{url:targets[0].pageUrl,clicks},{url:"https://other.ai/",clicks:100}]});
test("archive scope preserves exact query URL/host/path and excludes unrelated site archives",()=>{
 assert.deepEqual(monthlyArchiveScope(targets),{kinds:["ga4-pages","gsc-pages"],urls:["https://flatkey.ai/models/a?x=1"],paths:["flatkey.ai/models/a?x=1"]});
});
test("empty candidates skip reads; revisions query never expands JSON and native reads preserve metadata and duplicates",async()=>{
 calls=0;assert.deepEqual(await loadMonthlyPageArchive([],"2026-10-01","2026-11-29"),[]);assert.equal(calls,0);
 const matching={url:targets[0].pageUrl,clicks:2};
 archive=[{kind:"gsc-pages",date:"2026-11-01",payload:{kind:"gsc-pages",complete:false,rows:[matching,{url:"https://other.ai/"},matching]}}];versions=archive.map(({kind,date})=>({kind,date,revision:"1"}));
 assert.deepEqual(await loadMonthlyPageArchive(targets,"2026-10-01","2026-11-29"),[{payload:{kind:"gsc-pages",complete:false,rows:[matching,matching]}}]);
 assert.equal(calls,1);assert.deepEqual(query.where,{OR:[{kind:"gsc-pages",date:"2026-11-01"}]});assert.match(sql.sql,/xmin::text/);assert.doesNotMatch(sql.sql,/jsonb/);assert.ok(sql.values.includes("2026-10-01"));
});
test("each read checks revisions; unchanged dates reuse projection, corrections with unchanged observedAt reload only changed day, deletions vanish",async()=>{
 calls=0;archive=[{kind:"gsc-pages",date:"2026-11-01",payload:payload(1)},{kind:"gsc-pages",date:"2026-11-02",payload:payload(2)}];versions=archive.map(({kind,date})=>({kind,date,revision:"2"}));
 const first=await loadMonthlyPageArchive(targets,"2026-10-01","2026-11-28");assert.equal(first.length,2);assert.equal(calls,1);
 assert.deepEqual(await loadMonthlyPageArchive(targets,"2026-10-01","2026-11-28"),first);assert.equal(calls,1);
 archive[1].payload=payload(8);versions[1]={...versions[1],revision:"3"};
 const changed=await loadMonthlyPageArchive(targets,"2026-10-01","2026-11-28");assert.equal(calls,2);assert.deepEqual(query.where.OR,[{kind:"gsc-pages",date:"2026-11-02"}]);assert.equal(changed[1].payload.rows[0].clicks,8);assert.equal(changed[1].payload.observedAt,first[1].payload.observedAt);
 versions=versions.slice(1);assert.equal((await loadMonthlyPageArchive(targets,"2026-10-01","2026-11-28")).length,1);assert.equal(calls,2);
});
test("concurrent identical revision reads share one archive fetch; failed reads are retried and never served as cached data",async()=>{
 calls=0;archive=[{kind:"gsc-pages",date:"2026-11-02",payload:payload(2)}];versions=archive.map(({kind,date})=>({kind,date,revision:"4"}));
 const values=await Promise.all([loadMonthlyPageArchive(targets,"2026-10-01","2026-11-27"),loadMonthlyPageArchive(targets,"2026-10-01","2026-11-27")]);assert.deepEqual(values[0],values[1]);assert.equal(calls,1);
 failRead=true;versions[0]={...versions[0],revision:"5"};try{await assert.rejects(loadMonthlyPageArchive(targets,"2026-10-01","2026-11-27"),/read failed/);}finally{failRead=false;}
 archive[0].payload=payload(9);assert.equal((await loadMonthlyPageArchive(targets,"2026-10-01","2026-11-27"))[0].payload.rows[0].clicks,9);assert.equal(calls,3);
});
test("revision lookup failure falls back to native scoped reads without using cached data",async()=>{
 failRevision=true;try{const result=await loadMonthlyPageArchive(targets,"2026-10-01","2026-11-26");assert.equal(result[0].payload.rows[0].clicks,9);assert.deepEqual(query.where,{date:{gte:"2026-10-01",lte:"2026-11-26"},kind:{in:["ga4-pages","gsc-pages"]}});}finally{failRevision=false;}
});
test('all eligible candidates are retained before ranking; filtering unrelated observations preserves complete ranking and visits',()=>{
 const now=new Date('2026-11-24T02:00:00Z');const workflow={approvals:[],publications:Array.from({length:12},(_,i)=>({id:'p'+i,pageUrl:'https://flatkey.ai/p'+i,siteDomain:'flatkey.ai',title:'p'+i,kind:'optimization',status:'verified',publishedAt:'2026-11-01T16:00:00Z',verifiedAt:'2026-11-01T17:00:00Z',verificationRecordedAt:'2026-11-01T18:00:00Z'}))};
 const candidates=monthlyOptimizationChanges(workflow,'2026-11-24',now,false);assert.equal(candidates.size,12);
 const urls=new Set([...candidates.keys()]);const rows=['2026-10-31','2026-11-23'].flatMap((date,d)=>[
 {kind:'gsc-pages',date,property:'sc-domain:flatkey.ai',complete:true,observedAt:now.toISOString(),rows:Array.from({length:1000},(_,i)=>({url:'https://flatkey.ai/p'+i,clicks:d?i+1:0,impressions:d?i+10:0}))},
 {kind:'ga4-pages',date,property:'541304395',complete:true,hostnameDimension:'hostName',observedAt:now.toISOString(),rows:Array.from({length:1000},(_,i)=>({hostname:'flatkey.ai',path:'/p'+i,sessions:d?i+1:0}))}]);
 const projected=rows.map(row=>({...row,rows:row.rows.filter(item=>urls.has(item.url??'https://'+item.hostname+item.path))}));
 const original=recentPublishedPages(workflow,rows,'2026-11-24',now,true);
 assert.deepEqual(recentPublishedPages(workflow,projected,'2026-11-24',now,true),original);assert.equal(original.length,10);assert.ok(Buffer.byteLength(JSON.stringify(projected))<Buffer.byteLength(JSON.stringify(rows))/30);
});
