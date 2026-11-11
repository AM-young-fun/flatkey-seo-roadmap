const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const file = path.resolve(__dirname, "../src/lib/seo-workspace-routes.ts");
const compiled = new Module(file, module);
compiled._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { workspaceRedirectHref, executionViewRoutes } = compiled.exports;

test("legacy execution views return to their actionable workspace", () => {
  assert.equal(executionViewRoutes.deliveries, "/work?panel=deliveries");
  assert.equal(executionViewRoutes.runs, "/automations");
  assert.equal(executionViewRoutes.optimizations, "/pages?panel=optimizations");
  assert.equal(executionViewRoutes.approvals, "/approvals");
});

test("panel redirects retain country, dates, site, page URL and repeated filters", () => {
  const pageUrl = "https://rackrate.org/gpu?name=A%2BB&size=2";
  const target = workspaceRedirectHref("/pages?panel=optimizations", {
    tab: "optimizations", country: "BR", site: "rackrate.org", start: "2026-10-20", end: "2026-11-09",
    compareStart: "2026-09-29", compareEnd: "2026-10-19", week: "2026-11-09", pageUrl,
    status: ["planned", "draft"], omitted: undefined,
  });
  const url = new URL(target, "https://test.invalid");
  assert.equal(url.pathname, "/pages");
  assert.equal(url.searchParams.get("country"), "BR");
  assert.equal(url.searchParams.get("site"), "rackrate.org");
  assert.equal(url.searchParams.get("start"), "2026-10-20");
  assert.equal(url.searchParams.get("compareEnd"), "2026-10-19");
  assert.equal(url.searchParams.get("week"), "2026-11-09");
  assert.equal(url.searchParams.get("pageUrl"), pageUrl);
  assert.deepEqual(url.searchParams.getAll("status"), ["planned", "draft"]);
  assert.equal(url.searchParams.has("tab"), false);
  assert.equal(url.searchParams.has("omitted"), false);
  assert.equal(url.searchParams.get("panel"), "optimizations");
  assert.equal(target.match(/\?/g).length, 1);
});

test("legacy route destination chooses its own panel and cannot be overridden", () => {
  const target = workspaceRedirectHref("/work?panel=traffic", { panel: ["runs", "deliveries"], country: "JP", tab: "runs" });
  const url = new URL(target, "https://test.invalid");
  assert.deepEqual(url.searchParams.getAll("panel"), ["traffic"]);
  assert.equal(url.searchParams.get("country"), "JP");
});

test("empty redirects have no dangling query; approval deep links preserve the ticket", () => {
  assert.equal(workspaceRedirectHref("/work", { tab: "tasks" }), "/work");
  const url = new URL(workspaceRedirectHref(executionViewRoutes.approvals, { tab: "approvals", approvalId: "approval-v2", country: "ES" }), "https://test.invalid");
  assert.equal(url.pathname, "/approvals");
  assert.equal(url.searchParams.get("approvalId"), "approval-v2");
  assert.equal(url.searchParams.get("country"), "ES");
});
