const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);

const prismaPath = require.resolve("../src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: {
  prisma: new Proxy({}, { get() { assert.fail("an unconfigured dashboard must not read the database"); } }),
} };
const demoPath = require.resolve("../src/lib/demo-data.ts");
require.cache[demoPath] = { id: demoPath, filename: demoPath, loaded: true, exports: {
  getDemoDashboard() { assert.fail("a missing database must never fall back to example keywords, volumes or ranks"); },
} };
const { loadDashboard } = require("../src/lib/services/dashboard-data.ts");
const { GET } = require("../src/app/api/dashboard/route.ts");

beforeEach(t => {
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.after(() => { if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original; });
  t.mock.method(globalThis, "fetch", async () => assert.fail("an unconfigured dashboard must not contact any provider"));
  t.mock.method(console, "error", () => {});
});

test("every dashboard source fails closed without a database instead of returning sample data", async () => {
  for (const source of ["dataforseo_serp", "dataforseo_labs", "gsc", "ahrefs", "combined"]) {
    for (const period of ["week", "history"]) {
      await assert.rejects(loadDashboard("all", source, period), /数据库未配置，暂时无法读取真实数据/);
    }
  }
});

test("dashboard API reports 503 and never sends fabricated inventory, volume or ranking fields", async () => {
  for (const source of ["dataforseo_serp", "combined"]) {
    const response = await GET(new Request(`https://flatkey.test/api/dashboard?source=${source}&refresh=1`));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.equal(body.message, "数据暂时无法读取");
    for (const key of ["keywords", "topics", "usingDemoData", "latestRanks", "marketVolumes", "volume"]) {
      assert.equal(Object.hasOwn(body, key), false, key);
    }
    assert.equal(JSON.stringify(body).includes("postgresql://"), false);
  }
});
