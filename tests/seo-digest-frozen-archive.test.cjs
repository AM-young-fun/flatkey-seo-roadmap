const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const originalLoad=Module._load,originalResolve=Module._resolveFilename,root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
Module._resolveFilename=function(name,parent,...args){return originalResolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...args);};
const {buildSeoDigest}=require('../src/lib/seo-digest.ts');
const frozen=buildSeoDigest({date:'2026-11-23',now:new Date('2026-11-23T10:00:00Z'),observations:[],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:'partial',optimizationCoverage:'missing',rankingNotes:['原关键词实测'],workPlan:{weekStart:'2026-11-23',status:'scheduled',tasks:[]}});
frozen.dashboard={detailText:'原六块正文',attributionText:'原归因',technicalText:'原技术',sourceEvidenceSha256:'a'.repeat(64)};
frozen.dailyDashboardBody={version:1,recordOnly:true};
const newerGeneric={...frozen,id:'seo-digest:2026-11-23:bbbbbbbbbbbbbbbb',dashboard:undefined,dailyDashboardBody:undefined,rankingNotes:['较新通用稿，不应遮盖来源看板']};
let liveReads=0,snapshotReads=0,deliveryReads=0,local=false,hasSourceDashboard=true;
const tripwire=()=>{liveReads++;throw Error('saved_archive_must_not_overlay_live_state');};
Module._load=function(name,...args){
 if(name==='@/lib/services/import-tokens')return{authenticateImportToken:async()=>true};
 if(name==='@/lib/seo-analytics-access')return{authorizeAnalyticsRead:async()=>false,analyticsLocalPreview:()=>local,privateAnalyticsHeaders:{'cache-control':'private, no-store'}};
 if(name==='@/lib/services/seo-digest')return{DigestError:class extends Error{},generateSeoDigest:tripwire,saveSeoDigest:tripwire};
 if(name==='@/lib/prisma')return{prisma:{seoReportVersion:{groupBy:async()=>[{periodStart:new Date(frozen.date)}],findFirst:async({where})=>{snapshotReads++;return where.id?{payload:structuredClone(where.id===frozen.id?frozen:newerGeneric)}:where.AND?hasSourceDashboard?{payload:structuredClone(frozen)}:null:{payload:structuredClone(newerGeneric)};},findUnique:async()=>({kind:'SEO_DIGEST',payload:structuredClone(frozen)})},seoDigestDelivery:{findUnique:async()=>{deliveryReads++;return null;}}}};
 if(name==='@/lib/seo-workflow-http')return{authorizeWorkflow:tripwire};
 if(name==='@/lib/services/seo-digest-recovery')return{DigestRecoveryError:class extends Error{}};
 if(name.startsWith('@/lib/services/'))return new Proxy({}, {get:()=>tripwire});
 return originalLoad.call(this,name,...args);
};
const route=require('../src/app/api/seo/digest/route.ts'),url='https://flatkey-seo-roadmap.vercel.app/api/seo/digest';
test('default archived date and explicit report ID return the same complete frozen payload without live reads',async()=>{
 for(const query of ['?saved=1&archive=1&kind=daily','?saved=1&date=2026-11-23&kind=daily','?saved=1&archive=1&kind=daily&reportId='+frozen.id]){
  const r=await route.GET(new Request(url+query)),body=await r.json();assert.equal(r.status,200);assert.deepEqual(body.report,JSON.parse(JSON.stringify(frozen)));assert.equal(body.view,undefined);
 }
 assert.equal(liveReads,0);assert.equal(snapshotReads,3);assert.equal(deliveryReads,1);
 const r=await route.POST(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'read_saved',reportId:frozen.id})}));assert.deepEqual((await r.json()).report,JSON.parse(JSON.stringify(frozen)));assert.equal(liveReads,0);
});
test('local archived preview ignores a stale live view without mutating its saved snapshot',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'seo-frozen-report-')),previous=process.env.SEO_DIGEST_PREVIEW_DIR;process.env.SEO_DIGEST_PREVIEW_DIR=directory;local=true;
 try{fs.writeFileSync(path.join(directory,'2026-11-23.daily.json'),JSON.stringify({report:frozen,view:{workPlan:{status:'changed-live'},businessRegistrations:{total:9999}}}));const response=await route.GET(new Request(url+'?saved=1&archive=1&kind=daily'));const body=await response.json();assert.equal(response.status,200);assert.deepEqual(body.report,JSON.parse(JSON.stringify(frozen)));assert.equal(body.view,undefined);assert.equal(liveReads,0);}finally{local=false;if(previous===undefined)delete process.env.SEO_DIGEST_PREVIEW_DIR;else process.env.SEO_DIGEST_PREVIEW_DIR=previous;fs.rmSync(directory,{recursive:true,force:true});}
});
test('a racing newer generic cannot obscure a source snapshot, while explicit generic history and first base remain readable',async()=>{
 const current=await route.GET(new Request(url+'?saved=1&archive=1&kind=daily'));assert.equal((await current.json()).report.id,frozen.id);
 const explicit=await route.GET(new Request(url+'?saved=1&archive=1&kind=daily&reportId='+newerGeneric.id));assert.equal((await explicit.json()).report.id,newerGeneric.id);
 hasSourceDashboard=false;try{const initial=await route.GET(new Request(url+'?saved=1&archive=1&kind=daily'));assert.equal((await initial.json()).report.id,newerGeneric.id);}finally{hasSourceDashboard=true;}assert.equal(liveReads,0);
});
