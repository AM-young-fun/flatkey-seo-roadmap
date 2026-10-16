const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { pageTaskChecklist, matchesPageTask, pageTasksCsv } = require("../src/lib/keyword-page-task-view.ts");
const task = { id: "one-page", title: '=A "vendor", API guide', plannedUrl: "https://flatkey.ai/blog/vendor-api", type: "EXPAND", status: "IN_PROGRESS", owner: "Alice", dueAt: "2026-11-01", reason: "One page supports both keyword intents.",
  keywords: ["vendor api key", "vendor api pricing"], targetUrls: ["https://flatkey.ai/blog/vendor-api"],
  requirements: ["Add authentication example"], acceptance: ["Runnable examples"], workPlans: [
    { keyword: "vendor api key", pageUrls: ["https://flatkey.ai/blog/vendor-api"], requirements: ["Add authentication example"], acceptance: ["Runnable examples"] },
    { keyword: "vendor api pricing", pageUrls: ["https://flatkey.ai/blog/vendor-api"], requirements: ["Document quotas\nand pricing"], acceptance: ["Prices have dated sources"] },
  ] };

test("one page keeps shared requirements once and retains keyword-specific acceptance", () => {
  assert.deepEqual(pageTaskChecklist(task), { requirements: ["Add authentication example", "Document quotas\nand pricing"], acceptance: ["Runnable examples", "Prices have dated sources"] });
  assert.equal(matchesPageTask(task, " ＶＥＮＤＯＲ ＡＰＩ ＰＲＩＣＩＮＧ "), true);
  assert.equal(matchesPageTask(task, "dated sources"), true);
  assert.equal(matchesPageTask(task, "not covered"), false);
});

test("page CSV exports one row per page with all words, progress and per-word acceptance, escaping spreadsheet formula cells", () => {
  const csv = pageTasksCsv([task]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(csv.split("\r\n").length, 2);
  assert.ok(csv.includes('"\'=A ""vendor"", API guide"'));
  assert.ok(csv.includes('"进行中","Alice","2026-11-01"'));
  assert.ok(csv.includes('"vendor api key\nvendor api pricing"'));
  assert.ok(csv.includes("vendor api pricing\n具体要求：\n1. Document quotas\nand pricing\n验收标准：\n1. Prices have dated sources"));
  assert.ok(csv.includes("2. Document quotas\nand pricing"));
});
