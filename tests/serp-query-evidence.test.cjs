const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname,".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name,parent,...rest) { return resolve.call(this,name.startsWith("@/") ? path.join(root,"src",name.slice(2)) : name,parent,...rest); };
require.extensions[".ts"] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
let taskQuery;
const mock = (relative,exports) => {const file=path.join(root,relative);require.cache[file]={id:file,filename:file,loaded:true,exports};};
const raw=JSON.stringify({login:"never-return",password:"secret",tasks:[{data:{password:"secret"},result:[{keyword:"API key not found in cookies",location_code:2840,language_code:"en",datetime:"2026-10-19 08:04:17 +00:00",items:[{type:"paid",url:"https://ad.test/"},{type:"organic",rank_group:6,rank_absolute:9,page:1,url:"https://flatkey.ai/zh/blog/api-key-not-found-in-cookies",domain:"flatkey.ai",title:"Example",privateField:"secret"}]}]}]});
mock("src/lib/prisma.ts",{prisma:{serpMonitorRun:{findFirst:async()=>({id:"current-run",periodLabel:"current issue"})},serpMonitorTask:{findFirst:async query=>{taskQuery=query;return {keyword:"API key not found in cookies",region:"US",state:"COMPLETE",checkedAt:new Date("2026-10-19T08:04:17Z"),requestJson:{keyword:"API key not found in cookies",location_code:2840,language_code:"en",device:"desktop",os:"windows",depth:100,se_domain:"google.com",password:"secret"},rawResponse:raw};}}}});
const {publicSerpSnapshot,loadSerpQueryEvidence}=require("../src/lib/services/serp-query-evidence.ts");
test("query evidence reads saved current-run results without provider requests or credentials",async t=>{
 t.mock.method(globalThis,"fetch",async()=>assert.fail("evidence must never contact the provider"));
 const evidence=await loadSerpQueryEvidence("API key not found in cookies","US");
 assert.deepEqual(taskQuery.where,{runId:"current-run",region:"US",keyword:{equals:"API key not found in cookies",mode:"insensitive"}});
 assert.equal(evidence.snapshot.organicResults.length,1);assert.equal(evidence.snapshot.organicResults[0].rankGroup,6);assert.equal(evidence.snapshot.organicResults[0].rankAbsolute,9);
 assert.equal(evidence.request.device,"desktop");assert.ok(!JSON.stringify(evidence).includes("secret"));assert.ok(!JSON.stringify(evidence).includes("password"));
 assert.equal(publicSerpSnapshot("broken"),null);assert.equal(publicSerpSnapshot(null),null);
});
