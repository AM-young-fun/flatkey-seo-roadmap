const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname,".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name,parent,...rest) { return resolve.call(this,name.startsWith("@/") ? path.join(root,"src",name.slice(2)) : name,parent,...rest); };
require.extensions[".ts"] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
let taskQuery;
const mock = (relative,exports) => {const file=path.join(root,relative);require.cache[file]={id:file,filename:file,loaded:true,exports};};
const raw=JSON.stringify({login:"never-return",password:"secret",tasks:[{data:{password:"secret"},result:[{keyword:"API key not found in cookies",location_code:2840,language_code:"en",datetime:"2026-10-19 08:04:17 +00:00",items:[{type:"paid",url:"https://ad.test/"},{type:"organic",rank_group:6,rank_absolute:9,page:1,url:"https://flatkey.ai/zh/blog/api-key-not-found-in-cookies",domain:"flatkey.ai",title:"Example",privateField:"secret"}]}]}]});
mock("src/lib/prisma.ts",{prisma:{serpMonitorRun:{findFirst:async()=>({id:"current-run",periodLabel:"current issue"})},serpMonitorTask:{findFirst:async query=>{taskQuery=query;return {keyword:"API key not found in cookies",region:"US",state:"COMPLETE",checkedAt:new Date("2026-10-19T08:04:17Z"),providerTaskId:"existing-task-id",requestJson:{keyword:"API key not found in cookies",location_code:2840,language_code:"en",device:"desktop",os:"windows",depth:100,se_domain:"google.com",password:"secret"},rawResponse:raw};}},dataForSeoConnection:{findUnique:async()=>({encryptedCredentials:"fixture-encrypted"})}}});
mock("src/lib/dataforseo-credentials.ts",{decryptDataForSeoCredentials:()=>({apiLogin:"fixture-login",apiPassword:"fixture-password"})});
const {publicSerpSnapshot,loadSerpQueryEvidence,downloadSerpQueryEvidence}=require("../src/lib/services/serp-query-evidence.ts");
test("query evidence reads saved current-run results without provider requests or credentials",async t=>{
 t.mock.method(globalThis,"fetch",async()=>assert.fail("evidence must never contact the provider"));
 const evidence=await loadSerpQueryEvidence("API key not found in cookies","US");
 assert.deepEqual(taskQuery.where,{runId:"current-run",region:"US",keyword:{equals:"API key not found in cookies",mode:"insensitive"}});
 assert.equal(evidence.snapshot.organicResults.length,1);assert.equal(evidence.snapshot.organicResults[0].rankGroup,6);assert.equal(evidence.snapshot.organicResults[0].rankAbsolute,9);
 assert.equal(evidence.request.device,"desktop");assert.ok(!JSON.stringify(evidence).includes("secret"));assert.ok(!JSON.stringify(evidence).includes("password"));
 assert.equal(publicSerpSnapshot("broken"),null);assert.equal(publicSerpSnapshot(null),null);
});

test("HTML audit can only GET the existing task and never returns account credentials",async t=>{
 const calls=[]; t.mock.method(globalThis,"fetch",async(url,options)=>{calls.push({url,options});return Response.json({status_code:20000,cost:0.0024,tasks:[{id:"existing-task-id",status_code:20000,cost:0.0024,result:[{keyword:"API key not found in cookies",location_code:2840,language_code:"en",items:[{page:1,date:"2026-10-19",html:"<html>saved search</html>"}]}]}]});});
 const evidence=await downloadSerpQueryEvidence("API key not found in cookies","US");
 assert.equal(calls.length,1);assert.equal(calls[0].url,"https://api.dataforseo.com/v3/serp/google/organic/task_get/html/existing-task-id");assert.equal(calls[0].options.method,"GET");assert.equal(calls[0].options.redirect,"error");
 assert.equal(evidence.newTaskSubmitted,false);assert.equal(evidence.providerReportedCost,0.0024);assert.equal(evidence.pages[0].html,"<html>saved search</html>");assert.ok(!JSON.stringify(evidence).includes("fixture-password"));
});
test("HTML audit rejects a wrong task or a different market instead of using it as ranking evidence",async t=>{
 t.mock.method(globalThis,"fetch",async()=>Response.json({status_code:20000,cost:0,tasks:[{id:"existing-task-id",status_code:20000,cost:0,result:[{keyword:"API key not found in cookies",location_code:2392,language_code:"ja",items:[{page:1,html:"wrong market"}]}]}]}));
 await assert.rejects(downloadSerpQueryEvidence("API key not found in cookies","US"),/范围不符/);
});
