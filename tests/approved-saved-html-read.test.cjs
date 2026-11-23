const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),original=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return original.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest)};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const mock=(name,exports)=>{const file=path.join(root,'src',name);require.cache[file]={id:file,filename:file,loaded:true,exports}};
let found=true,credentialReads=0,query;
mock('lib/prisma.ts',{prisma:{serpMonitorTask:{findFirst:async q=>{query=q;return found?{keyword:'example',region:'US',requestJson:{location_code:2840,language_code:'en'}}:null}},dataForSeoConnection:{findUnique:async()=>{credentialReads++;return{encryptedCredentials:'encrypted'}}}}});
mock('lib/dataforseo-credentials.ts',{decryptDataForSeoCredentials:()=>({apiLogin:'private',apiPassword:'secret'})});
mock('lib/approved-weekly-keyword-capture.ts',{approvedWeeklyCaptureRunIds:()=>['first','other']});
const {readSavedHtml}=require('../src/app/api/seo/approved-keyword-review/evidence/saved-html.ts');
const id='11230313-2535-0066-0000-9d1079aa42de';
test('only completed fixed-run IDs may read HTML; no credentials before scope validation',async()=>{
 await assert.rejects(readSavedHtml('../other'));found=false;await assert.rejects(readSavedHtml(id));assert.equal(credentialReads,0);found=true;
 assert.deepEqual(query.where.runId,{in:['first','other']});assert.equal(query.where.state,'COMPLETE');
});
test('retrieval uses GET of exact paid ID, validates country and exposes no credentials',async t=>{
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,`https://api.dataforseo.com/v3/serp/google/organic/task_get/html/${id}`);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);return Response.json({status_code:20000,tasks_count:1,tasks_error:0,cost:0,tasks:[{id,status_code:20000,result:[{keyword:'example',location_code:2840,language_code:'en',items:[{page:1,html:'<html>saved</html>'}]}]}]})});
 const result=await readSavedHtml(id);assert.equal(result.newQueries,0);assert.equal(result.providerReportedCost,0);assert.equal(result.pages.length,1);assert.match(result.pages[0].htmlSha256,/^[0-9a-f]{64}$/);assert.equal(result.pages[0].html,undefined);assert.doesNotMatch(JSON.stringify(result),/private|secret|encrypted/);
});
