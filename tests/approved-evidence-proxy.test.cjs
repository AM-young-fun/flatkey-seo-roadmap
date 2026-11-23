const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename,load=Module._load;
let cookieValue,dbReads=0,htmlReads=0;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest)};
Module._load=function(name,...rest){
 if(name==='server-only')return {};
 if(name==='next/headers')return {cookies:async()=>({get:()=>cookieValue?{value:cookieValue}:undefined})};
 return load.call(this,name,...rest);
};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const mock=(file,exports)=>{const name=path.join(root,file);require.cache[name]={id:name,filename:name,loaded:true,exports}};
mock('src/lib/auth.ts',{AUTH_COOKIE_NAME:'session',isAuthEnabled:()=>true,isValidAuthToken:async value=>value==='existing-human-session'});
mock('src/lib/services/import-tokens.ts',{authenticateImportToken:async request=>request.headers.get('authorization')==='Bearer existing-collector'});
mock('src/lib/prisma.ts',{prisma:{serpMonitorTask:{findMany:async()=>{dbReads++;return []}}}});
mock('src/app/api/seo/approved-keyword-review/evidence/saved-html.ts',{readSavedHtml:async id=>{htmlReads++;assert.equal(id,'already-paid-id');return {readOnly:true,newQueries:0,providerTaskId:id}}});
const {NextRequest}=require('next/server'),{proxy}=require('../src/proxy.ts'),route=require('../src/app/api/seo/approved-keyword-review/evidence/route.ts');
const endpoint='https://seo.test/api/seo/approved-keyword-review/evidence';
test('exact evidence GET delegates but the unchanged handler rejects anonymous and invalid credentials before reads',async()=>{
 for(const headers of [{},{authorization:'Bearer wrong'}]){
  const request=new NextRequest(endpoint+'?htmlTaskId=already-paid-id',{headers});
  assert.equal((await proxy(request)).headers.get('x-middleware-next'),'1');
  const response=await route.GET(request);assert.equal(response.status,401);assert.equal((await response.json()).code,'unauthorized');
 }
 assert.equal(dbReads,0);assert.equal(htmlReads,0);
});
test('existing collector reaches only the original authenticated saved-row or original-ID HTML reader without new queries',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No provider request or paid POST in this routing test'));
 const headers={authorization:'Bearer existing-collector'};
 const request=new NextRequest(endpoint,{headers});
 assert.equal((await proxy(request)).headers.get('x-middleware-next'),'1');
 let response=await route.GET(request);assert.equal(response.status,200);assert.equal((await response.json()).newQueries,0);assert.equal(dbReads,1);
 response=await route.GET(new NextRequest(endpoint+'?htmlTaskId=already-paid-id',{headers}));
 assert.equal(response.status,200);assert.equal((await response.json()).providerTaskId,'already-paid-id');assert.equal(htmlReads,1);
 response=await route.GET(new NextRequest(endpoint,{headers:{...headers,origin:'https://seo.test'}}));assert.equal(response.status,403);assert.equal(dbReads,1);
 assert.equal(route.POST,undefined);
});
test('evidence POST and neighboring paths are not handed off to the GET credential handler',async()=>{
 const headers={authorization:'Bearer existing-collector'};
 for(const method of ['POST','PUT','PATCH','DELETE','HEAD'])assert.equal((await proxy(new NextRequest(endpoint,{method,headers}))).status,401);
 for(const suffix of ['/admin','-private','/nested','/'])assert.equal((await proxy(new NextRequest(endpoint+suffix,{headers}))).status,401);
 assert.equal(dbReads,1);assert.equal(htmlReads,1);
});
test('existing browser session still uses the same handler authorization',async()=>{
 cookieValue='existing-human-session';
 try{const response=await route.GET(new NextRequest(endpoint));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store')}
 finally{cookieValue=undefined}
});
