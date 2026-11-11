const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const mock = (name, exports) => { const file = path.join(root, "src/lib", name + ".ts"); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
let trendCalls = [], rebuilt = [], savedRows = [];
mock("prisma", { prisma: { $queryRaw: async () => savedRows } });
mock("services/display-trends", { buildDisplayTrends: async (site, range, now, module) => { trendCalls.push({ site, range, module }); return { moduleScope: { module } }; } });
mock("services/display-snapshots", { rebuildDisplaySnapshot: async spec => { rebuilt.push(spec); return true; } });
for (const name of ["services/dashboard-data", "services/weekly-report", "services/keyword-okr", "services/optimized-page-monitor"]) mock(name, {});
const { displayViewSpec, refreshDisplayViews } = require("../src/lib/services/display-views.ts");
const params = module => new URLSearchParams({ view: "trends", site: "all", start: "2026-10-08", end: "2026-10-16", module });

test("persisted trend identity includes the actual module and builder receives the same scope", async () => {
  trendCalls = [];
  const all = displayViewSpec(params("all")), blog = displayViewSpec(params("blog")), gpu = displayViewSpec(params("gpu"));
  assert.equal(new Set([all.key, blog.key, gpu.key]).size, 3);
  assert.ok(blog.key.endsWith(":blog:current-target-modules-v1"));
  assert.ok(gpu.key.endsWith(":gpu:current-target-modules-v1"));
  const result = await gpu.build(); assert.equal(result.value.moduleScope.module, "gpu");
  assert.deepEqual(trendCalls[0], { site: "all", range: { start: "2026-10-08", end: "2026-10-16" }, module: "gpu" });
});

test("background display rebuild restores the requested module instead of rebuilding an all-module key", async () => {
  rebuilt = [];
  const blog = displayViewSpec(params("blog"));
  savedRows = [{ key: blog.key }, { key: "display-v1:trends:all:2026-10-08:2026-10-16" }];
  await refreshDisplayViews(Date.now() + 60000);
  const restored = rebuilt.find(spec => spec.key === blog.key);
  assert.ok(restored); assert.equal((await restored.build()).value.moduleScope.module, "blog");
  assert.equal(rebuilt.some(spec => spec.key === savedRows[1].key), false, "obsolete unscoped cache keys cannot revive");
});
