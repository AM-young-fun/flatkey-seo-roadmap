const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { reportFocusLines } = require("../src/lib/seo-report-plan-display.ts");

test("focus keeps original task identity and excludes candidates and completed tasks", () => {
  const task = (id, extra = {}) => ({ id, weekStart: "2026-11-16", title: "修正费用单位", dueAt: "2026-11-20T10:00:00+08:00", country: "BR", language: "pt-BR", status: "ready", action: "先读 /Users/private/research.md；".repeat(200), ...extra });
  const plan = { weekStart: "2026-11-23", status: "scheduled", tasks: [task("candidate", { scheduled: false }), task("done", { status: "verified" }), task("original")] };
  const lines = reportFocusLines(plan);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /work\/original\?week=2026-11-16/);
  assert.match(lines[0], /BR \/ pt-BR/);
  assert.ok(lines[0].length < 200);
  assert.doesNotMatch(lines[0], /Users|research\.md|candidate|done/);
});

test("legacy focus without market metadata cannot display embedded execution instructions", () => {
  const lines = reportFocusLines(undefined, ["[查看下周完整工作计划](https://example.org/plan)", "1. [修正旧页](https://flatkey.ai/blog/cost) · 原执行说明保留 · 先读 /Users/private/research.md；".repeat(20)]);
  assert.deepEqual(lines, ["[修正旧页](https://flatkey.ai/blog/cost)"]);
});
