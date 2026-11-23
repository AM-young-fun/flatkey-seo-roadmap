const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(name, parent, ...rest) {
  return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const builders = new Set(["dashboard-data", "weekly-report", "keyword-okr", "optimized-page-monitor", "display-trends"]);
const loaded = [], built = [];
Module._load = function(name, parent, ...rest) {
  const service = name.startsWith("./") && builders.has(name.slice(2)) ? name.slice(2) : null;
  if (service) {
    loaded.push(service);
    if (service === "weekly-report") return { buildWeeklyReport: async periods => { built.push(periods); return { report: "saved-scope" }; } };
    if (service === "display-trends") return { buildDisplayTrends: async (site, range, now, module) => ({ site, ...range, module }) };
    throw new Error(`Unexpected builder: ${service}`);
  }
  return load.call(this, name, parent, ...rest);
};
for (const [name, exports] of [["prisma", { prisma: {} }], ["services/display-snapshots", {}]]) {
  const file = path.join(root, "src/lib", name + ".ts");
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
const { displayViewSpec } = require("../src/lib/services/display-views.ts");

test("saved display descriptors do not load any reconstruction services", () => {
  for (const view of ["dashboard", "traffic", "trends"]) {
    const spec = displayViewSpec(new URLSearchParams({ view }));
    assert.ok(spec.key.startsWith(`display-v1:${view}:`));
  }
  assert.throws(() => displayViewSpec(new URLSearchParams({ site: "invalid" })), /网站无效/);
  assert.deepEqual(loaded, []);
});

test("rebuilding loads only that display's builder and retains its original scope", async () => {
  const trend = displayViewSpec(new URLSearchParams({ view: "trends", site: "rackrate.org", module: "gpu", start: "2026-10-08", end: "2026-10-16" }));
  assert.deepEqual(await trend.build(), { value: { site: "rackrate.org", module: "gpu", start: "2026-10-08", end: "2026-10-16" } });
  assert.deepEqual(loaded, ["display-trends"]);
  const report = displayViewSpec(new URLSearchParams({ view: "traffic" }));
  assert.deepEqual(await report.build(), { value: { report: "saved-scope" } });
  assert.deepEqual(loaded, ["display-trends", "weekly-report"]);
  assert.ok(report.key.includes(built[0].current.start));
});
