const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
async function run(after) {
 const calls=[];const pages=[{url:"https://flatkey.ai/"}];
 const context=vm.createContext({process:{env:{SEO_IMPORT_TOKEN:"test"}},require:()=>({}),Date,Set,AbortSignal,console:{log:()=>{},error:()=>{}},fetch:async (_,options)=>{calls.push(options.method);return {ok:true,json:async()=>calls.length===3?after:{storage:"database",pages,capturedAt:new Date().toISOString()}};}});
 const source=fs.readFileSync(path.join(__dirname,"../scripts/server-seo-inventory.cjs"),"utf8");
 vm.runInContext(source.slice(0,source.lastIndexOf("run().catch"))+"globalThis.done=run();",context);
 await context.done;return calls;
}
test("inventory sync is read back from durable storage",async()=>{assert.deepEqual(await run({storage:"database",pages:[{url:"https://flatkey.ai/"}],capturedAt:new Date().toISOString()}),["GET","POST","GET"]);});
test("missing or stale readback does not pass",async()=>{await assert.rejects(run({storage:"database",pages:[],capturedAt:"2020-01-01T00:00:00Z"}),/inventory_readback_failed/);});
