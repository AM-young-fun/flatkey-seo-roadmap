const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname,".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name,parent,...rest) { return resolve.call(this,name.startsWith("@/") ? path.join(root,"src",name.slice(2)) : name,parent,...rest); };
require.extensions[".ts"] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
let queries = [], rows = [];
const mock = (relative,exports) => {const file=path.join(root,relative);require.cache[file]={id:file,filename:file,loaded:true,exports};};
mock("src/lib/prisma.ts",{prisma:{$queryRaw:async query=>{queries.push(query);return rows;}}});
const {loadSerpCollectionProgress} = require("../src/lib/services/serp-collection-progress.ts");
const {collectionIsActive} = require("../src/lib/serp-collection-progress.ts");

test("query progress is a free metadata read and four-country completed words are separate from submitted queries", async t => {
  t.mock.method(globalThis,"fetch",async()=>assert.fail("progress must not contact any provider"));
  queries=[];rows=[{runId:"existing-run",periodLabel:"2026年10月第2期",status:"RUNNING",totalQueries:5580,totalKeywords:1395,completedKeywords:12,
    completedQueries:49,plannedQueries:5180,waitingQueries:351,processingQueries:0,failedQueries:0,startedAt:new Date("2026-10-19T07:43:00Z"),completedAt:null}];
  const progress=await loadSerpCollectionProgress("flatkey.ai");
  assert.equal(progress.submittedQueries,400);assert.equal(progress.completedQueries,49);assert.equal(progress.completedKeywords,12);
  assert.equal(queries.length,1);assert.deepEqual(queries[0].values,["flatkey.ai","flatkey.ai"]);
  assert.match(queries[0].sql,/scope = 'SCHEDULED'/);assert.match(queries[0].sql,/countries = 4/);
  assert.equal(collectionIsActive(progress.status),true);assert.equal(collectionIsActive("COMPLETED"),false);
  for(const value of ["rawResponse","encryptedCredentials","apiPassword"]) assert.ok(!JSON.stringify(progress).includes(value));
  rows=[];assert.equal(await loadSerpCollectionProgress(),null);
});

test("the lightweight progress endpoint requires login and rejects invalid site scope without reading tasks", async t => {
  let session=false;
  mock("src/lib/auth.ts",{AUTH_COOKIE_NAME:"fixture-session",isAuthEnabled:()=>true,isValidAuthToken:async()=>session});
  const headersFile=require.resolve("next/headers");
  require.cache[headersFile]={id:headersFile,filename:headersFile,loaded:true,exports:{cookies:async()=>({get:()=>({value:"fixture"})})}};
  process.env.DATABASE_URL="postgresql://unused.invalid/progress";
  const {GET}=require("../src/app/api/serp-monitor/route.ts");
  t.mock.method(globalThis,"fetch",async()=>assert.fail("opening progress must not start or poll paid work"));
  queries=[];
  assert.equal((await GET(new Request("https://flatkey.test/api/serp-monitor?progress=1"))).status,401);
  assert.equal(queries.length,0);session=true;
  assert.equal((await GET(new Request("https://flatkey.test/api/serp-monitor?progress=1&site=evil.invalid"))).status,400);
  assert.equal(queries.length,0);
  const response=await GET(new Request("https://flatkey.test/api/serp-monitor?progress=1"));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{progress:null});
  assert.equal(queries.length,1);assert.match(response.headers.get("cache-control"),/private, no-store/);
});
