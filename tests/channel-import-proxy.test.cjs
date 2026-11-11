const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),load=Module._load,resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest);};
Module._load=function(name,...rest){
 if(name==='@/lib/auth')return {AUTH_COOKIE_NAME:'session',isAuthEnabled:()=>true,isValidAuthToken:async()=>false};
 if(name.includes('services/import-tokens'))return {authenticateImportToken:async req=>req.headers.get('authorization')==='Bearer fixture'};
 if(name.includes('seo-analytics-access'))return {authorizeAnalyticsRead:async()=>false,analyticsLocalPreview:()=>false,privateAnalyticsHeaders:{'cache-control':'private, no-store'}};
 if(name.includes('services/seo-business-analytics'))return {loadBusinessAnalytics:async()=>[],saveBusinessAnalytics:async input=>require('../src/lib/seo-business-analytics.ts').businessAnalyticsSchema.parse(input)};
 if(name.includes('services/seo-github-channel'))return {loadGithubChannels:async()=>[],saveGithubChannel:async input=>require('../src/lib/seo-github-channel.ts').githubChannelSchema.parse(input)};
 return name==='server-only'?{}:load.call(this,name,...rest);
};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {NextRequest}=require('next/server'),{proxy}=require('../src/proxy.ts');
for(const channel of ['business','github'])test(`${channel} import reaches its own token authentication without a browser session`,async()=>{
 const endpoint='https://flatkey.test/api/seo/'+channel,route=require('../src/app/api/seo/'+channel+'/route.ts');
 assert.equal((await proxy(new NextRequest(endpoint))).headers.get('x-middleware-next'),'1');
 assert.equal((await proxy(new NextRequest(endpoint+'/admin'))).status,401);
 for(const headers of [{},{authorization:'Bearer wrong'},{authorization:'Bearer fixture',origin:'https://flatkey.test'}]){
  assert.equal((await route.POST(new Request(endpoint,{method:'POST',headers,body:'{}'}))).status,401);
 }
 assert.equal((await route.POST(new Request(endpoint,{method:'POST',headers:{authorization:'Bearer fixture'},body:'{}'}))).status,400);
 assert.equal((await route.GET(new Request(endpoint+'?start=2026-11-01&end=2026-11-10',{headers:{authorization:'Bearer fixture'}}))).status,200);
 assert.equal((await route.GET(new Request(endpoint+'?start=2026-11-01&end=2026-11-10'))).status,401);
});
test('managed credentials and unrelated APIs still require the human login session',async()=>{
 for(const endpoint of ['/api/import-tokens','/api/keywords','/api/seo/github-private'])assert.equal((await proxy(new NextRequest('https://flatkey.test'+endpoint,{headers:{authorization:'Bearer fixture'}}))).status,401);
});
