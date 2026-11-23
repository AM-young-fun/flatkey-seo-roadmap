const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),original=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return original.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest)};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const mock=(name,exports)=>{const file=path.join(root,'src',name);require.cache[file]={id:file,filename:file,loaded:true,exports}};
let denied=false,reads=0,query;
mock('lib/seo-workflow-http.ts',{authorizeWorkflow:async()=>{if(denied)throw Error('denied')},workflowHeaders:{'Cache-Control':'private, no-store'},workflowErrorResponse:()=>Response.json({}, {status:401})});
mock('lib/approved-weekly-keyword-capture.ts',{approvedWeeklyCaptureRunIds:()=>['first','other']});
mock('lib/prisma.ts',{prisma:{serpMonitorTask:{findMany:async q=>{reads++;query=q;return [{id:'task',runId:'first',keyword:'test',region:'US',providerTaskId:'existing',requestJson:{depth:100,privateSecret:'not public'},rawResponse:JSON.stringify({tasks:[{status_code:20000,data:{secret:'hidden'},result:[{keyword:'test',items_count:101,pages_count:8,items:[{type:'organic',rank_group:1,url:'https://example.com',secret:'hidden'}]}]}]}),normalizedJson:{organicCount:79}}]}}}});
const {GET}=require('../src/app/api/seo/approved-keyword-review/evidence/route.ts');
test('authorization and invalid pagination stop before any DB read',async()=>{
 denied=true;assert.equal((await GET(new Request('https://example.com/?offset=0'))).status,401);assert.equal(reads,0);
 denied=false;assert.equal((await GET(new Request('https://example.com/?offset=-1'))).status,400);assert.equal(reads,0);
});
test('fixed saved runs and public evidence only; GET has no provider call',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No supplier requests allowed'));
 const response=await GET(new Request('https://example.com/?offset=50')),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(query.where,{runId:{in:['first','other']}});assert.equal(query.take,50);assert.equal(query.skip,50);
 assert.equal(body.readOnly,true);assert.equal(body.newQueries,0);assert.equal(body.items[0].result.itemsCount,101);assert.equal(body.items[0].result.nodes[0].rankGroup,1);
 assert.doesNotMatch(JSON.stringify(body),/hidden|privateSecret|not public/);
});
