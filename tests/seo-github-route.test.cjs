const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),load=Module._load,resolve=Module._resolveFilename;let writes=0,reads=0;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest);};
Module._load=function(name,...rest){
 if(name.includes('services/import-tokens'))return {authenticateImportToken:async req=>req.headers.get('authorization')==='Bearer fixture'};
 if(name.includes('seo-analytics-access'))return {authorizeAnalyticsRead:async req=>req.headers.get('x-test-session')==='yes',privateAnalyticsHeaders:{'cache-control':'private, no-store'}};
 if(name.includes('services/seo-github-channel'))return {saveGithubChannel:async input=>{const {githubChannelSchema}=require('../src/lib/seo-github-channel.ts');githubChannelSchema.parse(input);writes++;return {stored:true,storage:'database'};},loadGithubChannels:async()=>{reads++;return [];}};
 if(name.includes('services/ga4-github-referrals'))return {fetchGithubReferrals:async()=>({status:'unavailable'})};
 return name==='server-only'?{}:load.call(this,name,...rest);
};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const route=require('../src/app/api/seo/github/route.ts');
const request=(headers={},body={})=>new Request('https://flatkey-seo-roadmap.vercel.app/api/seo/github',{method:'POST',headers,body:JSON.stringify(body)});
test('import requires scoped server token and rejects browser Origin, anonymous and normal read session',async()=>{
 for(const headers of [{},{'x-test-session':'yes'},{authorization:'Bearer fixture',origin:'https://flatkey-seo-roadmap.vercel.app'}])assert.equal((await route.POST(request(headers))).status,401);
 assert.equal(writes,0);assert.equal((await route.POST(request({authorization:'Bearer fixture'}))).status,400);
});
test('private archive read requires auth and collection requires importer permission',async()=>{
 const url='https://flatkey-seo-roadmap.vercel.app/api/seo/github?start=2026-11-01&end=2026-11-10';
 assert.equal((await route.GET(new Request(url))).status,401);
 assert.equal((await route.GET(new Request(url,{headers:{'x-test-session':'yes'}}))).status,200);assert.equal(reads,1);
 assert.equal((await route.GET(new Request(url+'&collect=referrals&repository=flatkey-ai%2Fawesome-images',{headers:{'x-test-session':'yes'}}))).status,403);
 assert.equal((await route.GET(new Request(url+'&collect=referrals&repository=outside%2Frepo',{headers:{authorization:'Bearer fixture'}}))).status,400);
});
