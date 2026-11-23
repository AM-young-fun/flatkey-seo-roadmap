const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText, file);
const coverage = require("../src/lib/saved-ranking-coverage.ts"), root = path.resolve(__dirname, "..");
function load(relative, mocks) {
  const file = path.join(root, relative), original = Module._load; delete require.cache[file];
  Module._load = function (name, parent, main) { return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, name, parent, main); };
  try { return require(file); } finally { Module._load = original; }
}

test("coverage storage reads only the exact four allowlisted runs and never selects credentials/raw requests", async () => {
  const selection = coverage.coverageSelection(new URLSearchParams({ periodKey: "2026-11-17" })), calls = [];
  const service = load("src/lib/services/saved-ranking-coverage.ts", {
    "@/lib/prisma": { prisma: { dataForSeoRun: { findMany: async query => { calls.push(query); return []; } } } },
    "@/lib/saved-ranking-coverage": coverage,
  });
  const report = await service.loadSavedRankingCoverage(selection);
  assert.equal(calls.length, 1); assert.equal(calls[0].where.siteDomain, "flatkey.ai"); assert.deepEqual(calls[0].where.requestId.in, selection.runIds);
  assert.deepEqual(Object.keys(calls[0].select).sort(), ["collectedAt", "completedAt", "normalized", "requestId", "siteDomain", "status"]);
  assert.equal(report.complete, false); assert.equal(report.countries.length, 4); assert.equal(report.newPaidRequests, 0);
});

function route(options = {}) {
  const calls = [];
  const handlers = load("src/app/api/seo/ranked-keyword-coverage/route.ts", {
    "@/lib/env": { isDatabaseConfigured: () => options.database !== false },
    "@/lib/database-read": { retryDatabaseRead: fn => fn() },
    "@/lib/saved-ranking-coverage": coverage,
    "@/lib/services/ranking-coverage-access": { authorizeSavedRankingCoverage: async () => options.authorized !== false },
    "@/lib/services/saved-ranking-coverage": { loadSavedRankingCoverage: async selection => { calls.push(selection); if (options.fail) throw Error("never expose raw DB diagnostics"); return { complete: true, newPaidRequests: 0, newCostMicros: 0 }; } },
  });
  return { handlers, calls };
}
test("GET denies unauthenticated and invalid/mixed/unscoped input before reading ranking rows", async () => {
  let current = route({ authorized: false });
  assert.equal((await current.handlers.GET(new Request("https://example.com/api/seo/ranked-keyword-coverage?periodKey=2026-11-17"))).status, 401);
  assert.equal(current.calls.length, 0);
  current = route();
  for (const query of ["", "?periodKey=2026-11-17&site=modelfit.cc", "?periodKey=2026-11-17&refresh=true"]) assert.equal((await current.handlers.GET(new Request("https://example.com/api/seo/ranked-keyword-coverage" + query))).status, 400);
  assert.equal(current.calls.length, 0); assert.equal(current.handlers.POST, undefined);
});
test("GET returns private no-store saved evidence and never masks DB failure as zero results", async () => {
  const request = new Request("https://example.com/api/seo/ranked-keyword-coverage?periodKey=2026-11-17");
  const current = route(), response = await current.handlers.GET(request);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).newCostMicros, 0); assert.equal(current.calls[0].runIds.length, 4);
  assert.equal((await route({ database: false }).handlers.GET(request)).status, 503);
  const failed = await route({ fail: true }).handlers.GET(request); assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(await failed.json()), /raw DB diagnostics/);
  const proxy = fs.readFileSync(path.join(root, "src/proxy.ts"), "utf8");
  assert.match(proxy, /pathname === "\/api\/seo\/ranked-keyword-coverage" && request\.method === "GET"/);
});
