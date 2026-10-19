const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { createClientReadCache } = require("../src/lib/client-read-cache.ts");

test("navigation and simultaneous readers share one private GET, while country/pool/week keys stay separate", async () => {
  const calls = []; let release;
  const wait = new Promise(resolve => { release = resolve; });
  const store = createClientReadCache(async (url, options) => { calls.push({url,options}); await wait; return Response.json({url}); });
  const first = store.read("/api/keywords/okr?pool=FORMAL"), second = store.read("/api/keywords/okr?pool=FORMAL");
  assert.equal(first, second); release();
  await first; await store.read("/api/keywords/okr?pool=FORMAL");
  assert.equal(calls.length, 1); assert.equal(calls[0].options.cache, "no-store");
  await store.read("/api/keywords/okr?pool=RESEARCH"); await store.read("/api/insights?week=2026-10-13");
  assert.equal(calls.length, 3);
});
test("expiry and explicit refresh fetch again; clearing cannot let an old in-flight response repopulate private data", async () => {
  let clock = 0, calls = 0;
  const store = createClientReadCache(async () => Response.json({version:++calls}), () => clock);
  await store.read("/api/report"); clock = 59_999; assert.equal((await store.read("/api/report")).version, 1);
  clock = 60_000; assert.equal((await store.read("/api/report")).version, 2);
  assert.equal((await store.read("/api/report", true)).version, 3);
  let release;
  const pending = createClientReadCache(() => new Promise(resolve => { release = resolve; }));
  const request = pending.read("/api/private"); pending.clear(); release(Response.json({private:true})); await request;
  assert.equal(pending.peek("/api/private"), null);
});
test("failed and unauthorized responses are never cached or silently converted into empty data", async () => {
  let calls=0;
  const store=createClientReadCache(async()=>Response.json({message:"unavailable"},{status:++calls === 1 ? 401 : 503}));
  await assert.rejects(store.read("/api/report"), error=>error.status === 401);
  await assert.rejects(store.read("/api/report"), error=>error.status === 503);
  assert.equal(calls,2); assert.equal(store.peek("/api/report"),null);
});
