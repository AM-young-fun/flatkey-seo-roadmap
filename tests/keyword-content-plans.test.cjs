const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { keywordContentPlans, contentPlansCsv } = require("../src/lib/keyword-content-plans.ts");
const plan = { originalVerdict: "MISMATCH", action: "BUILD", pageUrls: [], previousPageUrl: "https://flatkey.ai/old-page", proposedTitle: "A dedicated integration guide",
  requirements: ["Explain the exact vendor's integration.", "Include runnable requests and responses.", "Document quotas and failures with actual sources."], acceptance: ["Every example uses the specified vendor.", "The public page answers the full requested integration."] };

test("the action list retains completed links and pending builds once while ignoring archived words", () => {
  const items = [{ id: "linked", active: true, pool: "FORMAL", workPlan: { ...plan, action: "LINK", pageUrls: ["https://flatkey.ai/correct"] } },
    { id: "build", active: true, pool: "FORMAL", workPlan: plan }, { id: "research", active: true, pool: "RESEARCH", workPlan: plan },
    { id: "archived", active: false, pool: "ARCHIVED", workPlan: plan }, { id: "unreviewed", active: true, pool: "FORMAL" }];
  assert.deepEqual(keywordContentPlans(items).map(item => item.id), ["linked", "build"]);
});

test("CSV keeps all keyword-specific requirements and safely escapes formulas, quotes and newlines", () => {
  const csv = contentPlansCsv([{ id: "1", text: "=danger(1)", active: true, pool: "FORMAL", workPlan: { ...plan, proposedTitle: 'Vendor "API", guide' },
    latestPageAuditReason: "No matching page found.", latestPageAuditCheckedAt: "2026-10-16T08:00:00Z" }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=danger(1)"'));
  assert.ok(csv.includes('Vendor ""API"", guide'));
  assert.ok(csv.includes('1. Explain the exact vendor\'s integration.\n2. Include runnable requests and responses.'));
  assert.ok(csv.includes('"新建页面","","Vendor'));
  assert.ok(csv.includes("https://flatkey.ai/old-page"));
});
