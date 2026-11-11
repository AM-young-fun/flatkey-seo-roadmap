const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),load=Module._load,resolve=Module._resolveFilename;
let rows=[],dbFails=false,authEnabled=true;
const table={
 async findFirst(){if(dbFails)throw Error('database unavailable');return [...rows].sort((a,b)=>b.id.localeCompare(a.id))[0]||null;},
 async create({data}){if(rows.some(x=>x.id===data.id))throw Object.assign(Error('unique'),{code:'P2002'});rows.push(structuredClone(data));return data;},
};
const db={seoReportVersion:table,$transaction:async callback=>callback({seoReportVersion:table})};
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest);};
Module._load=function(name,...rest){
 if(name==='@/lib/prisma')return {prisma:db};
 if(name==='@/lib/services/import-tokens')return {authenticateImportToken:async req=>req.headers.get('authorization')==='Bearer fixture'};
 if(name==='@/lib/auth')return {AUTH_COOKIE_NAME:'seo_rank_auth',isAuthEnabled:()=>authEnabled,isValidAuthToken:async value=>value==='valid-session'};
 return name==='server-only'?{}:load.call(this,name,...rest);
};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const service=require('../src/lib/services/seo-reporting-control.ts'),route=require('../src/app/api/seo/reporting-control/route.ts');
const {SEO_REPORT_GROUP,SEO_REPORT_ROBOT}=require('../src/lib/seo-digest.ts');
const {NextRequest}=require('next/server');
const origin='https://flatkey-seo-roadmap.vercel.app';
const command=(extra={})=>({enabled:true,expectedVersion:0,protocolVersion:2,destination:SEO_REPORT_GROUP,robotCode:SEO_REPORT_ROBOT,reason:'Verified preview and destination',...extra});
const request=(method,headers={},body=command())=>new NextRequest(origin+'/api/seo/reporting-control',{method,headers:method==='POST'?{'content-type':'application/json',...headers}:headers,...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
test('unconfigured reporting defaults closed and env does not bypass it; read failures remain failures',async()=>{
 rows=[];process.env.SEO_UNIFIED_REPORTING_ENABLED='true';
 const control=await service.getSeoReportingControl();assert.equal(control.enabled,false);assert.equal(control.version,0);assert.equal(control.protocolVersion,2);
 dbFails=true;await assert.rejects(service.getSeoReportingControl());dbFails=false;
});
test('immutable versioned writes preserve actor, bindings and all changes including disable; clock rollback cannot select stale enabled state',async()=>{
 rows=[];const first=await service.setSeoReportingControl(command(),'import-token',new Date('2026-11-11T09:00:00Z'));assert.equal(first.control.version,1);
 const second=await service.setSeoReportingControl(command({enabled:false,expectedVersion:1,reason:'Pause after failed validation'}),'admin-session',new Date('2026-11-10T09:00:00Z'));
 assert.equal(second.control.version,2);assert.equal(rows.length,2);assert.equal(rows[0].payload.enabled,true);assert.equal(rows[1].payload.actor,'admin-session');assert.equal((await service.getSeoReportingControl()).enabled,false);
 await assert.rejects(service.setSeoReportingControl(command(),'import-token'),error=>error.code==='version_conflict');assert.equal(rows.length,2);
});
test('concurrent same-version writers cannot both win database unique-version CAS',async()=>{
 rows=[];const results=await Promise.allSettled([service.setSeoReportingControl(command(),'import-token'),service.setSeoReportingControl(command({enabled:false}),'admin-session')]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(rows.length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'version_conflict');
});
test('wrong protocol/destination/robot, missing reason and forged audit fields never write',async()=>{
 rows=[];
 for(const change of [{protocolVersion:1},{destination:'other-group'},{robotCode:'other-bot'},{reason:' '},{actor:'admin-session'},{expectedVersion:-1}])await assert.rejects(service.setSeoReportingControl(command(change),'import-token'));
 assert.equal(rows.length,0);
 rows=[{id:'reporting-control:v000000000001',payload:{...command(),version:1}}];await assert.rejects(service.getSeoReportingControl(),error=>error.code==='invalid_stored_control');
 assert.equal((await route.GET(request('GET',{authorization:'Bearer fixture'}))).status,503);rows=[];
});
test('anonymous/incorrect token/cross-origin and local-preview headers cannot read or mutate',async()=>{
 rows=[];
 for(const headers of [{},{authorization:'Bearer wrong'},{'x-test-session':'yes'},{authorization:'Bearer fixture',origin:'https://evil.example'},{authorization:'Bearer fixture','sec-fetch-site':'cross-site'}]){
  assert.ok([401,403].includes((await route.GET(request('GET',headers))).status));assert.ok([401,403].includes((await route.POST(request('POST',headers))).status));
 }
 assert.equal(rows.length,0);
});
test('server token and same-origin real session can write, but browser token without session and session missing Origin cannot',async()=>{
 rows=[];
 assert.equal((await route.POST(request('POST',{authorization:'Bearer fixture',origin}))).status,401);
 assert.equal((await route.POST(request('POST',{cookie:'seo_rank_auth=valid-session'}))).status,403);
 let response=await route.POST(request('POST',{authorization:'Bearer fixture'}));assert.equal(response.status,200);assert.equal((await response.json()).control.actor,'import-token');
 response=await route.POST(request('POST',{cookie:'seo_rank_auth=valid-session',origin},command({expectedVersion:1,enabled:false})));assert.equal(response.status,200);assert.equal((await response.json()).control.actor,'admin-session');
 const read=await route.GET(request('GET',{authorization:'Bearer fixture'}));assert.equal(read.status,200);assert.equal((await read.json()).control.enabled,false);
 authEnabled=false;assert.equal((await route.POST(request('POST',{cookie:'seo_rank_auth=valid-session',origin},command({expectedVersion:2})))).status,401);authEnabled=true;
});
test('API uses bounded JSON, rejects stale writes and fails closed when storage is down',async()=>{
 rows=[];const auth={authorization:'Bearer fixture'};
 assert.equal((await route.POST(request('POST',{...auth,'content-type':'text/plain'}))).status,415);
 assert.equal((await route.POST(request('POST',auth,'{bad'))).status,400);
 assert.equal((await route.POST(request('POST',auth,'x'.repeat(8193)))).status,413);
 assert.equal((await route.POST(request('POST',auth,command({protocolVersion:1})))).status,400);
 assert.equal((await route.POST(request('POST',auth))).status,200);assert.equal((await route.POST(request('POST',auth))).status,409);
 dbFails=true;assert.equal((await route.GET(request('GET',auth))).status,503);assert.equal((await route.POST(request('POST',auth,command({expectedVersion:1})))).status,503);dbFails=false;
 assert.equal(rows.length,1);
});
