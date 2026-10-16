const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { buildPageTaskMerge, pageTaskWorkDetails } = require("../src/lib/keyword-page-tasks.ts");
const work = (keyword, page, extras = {}) => ({ keywordId: keyword, keyword, originalVerdict: "CONTENT_GAP", action: "EXPAND", pageUrls: [page], previousPageUrl: page,
  proposedTitle: `${keyword} documentation`, requirements: [`Explain ${keyword} setup and exact conditions.`, "Show a real request and response.", "Link dated primary documentation."],
  acceptance: ["The public page includes the full requested explanation.", "All numerical examples can be reproduced."], ...extras });
const task = (id, page, keywords, extras = {}) => ({ id, plannedUrl: page, type: "EXPAND", status: "TODO", title: `Existing ${id}`, reason: "Existing editorial reason", keywords,
  targetUrls: [page], owner: null, dueAt: null, ...extras });

test("same canonical primary page becomes one task with all per-keyword requirements and extra verified pages retained", () => {
  const page = "https://flatkey.ai/models/example";
  const items = [work("price", `${page}/#price`, { pageUrls: [`${page}/#price`, "https://flatkey.ai/extra"] }), work("API", page)];
  const old = task("old", page, ["unrelated", "price"], { owner: "Alice", status: "IN_PROGRESS", dueAt: "2026-11-01T00:00:00.000Z" });
  const result = buildPageTaskMerge([old], items);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.summary.pageTasks, 1);
  assert.equal(result.summary.created, 0);
  const next = result.tasks[0];
  assert.equal(next.id, "old");
  assert.equal(next.plannedUrl, page);
  assert.equal(next.owner, "Alice");
  assert.equal(next.status, "IN_PROGRESS");
  assert.equal(next.dueAt, old.dueAt);
  assert.equal(next.title, old.title);
  assert.equal(next.reason, old.reason);
  assert.deepEqual(new Set(next.keywords), new Set(["unrelated", "price", "API"]));
  const details = pageTaskWorkDetails(next, items);
  assert.equal(details.workPlans.length, 2);
  assert.equal(details.workPlans.find(row => row.keyword === "price").pageUrls.length, 2);
  assert.equal(details.requirements.filter(row => row === "Show a real request and response.").length, 1);
  assert.equal(buildPageTaskMerge(result.after, items).changes.length, 0, "replay must perform no writes");
});

test("reviewed new-page synonyms merge while distinct model comparisons remain separate and unknown builds fail closed", () => {
  const build = keyword => work(keyword, "https://flatkey.ai/old", { action: "BUILD", originalVerdict: "MISMATCH", pageUrls: [] });
  const result = buildPageTaskMerge([], [build("open router api keys"), build("openrouter ai api key"), build("grok 4.3 vs gpt 5.4"), build("grok 4.3 vs gpt 5.5")]);
  assert.equal(result.summary.pageTasks, 3);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.tasks.find(row => row.plannedUrl.endsWith("openrouter-api-keys")).keywords.length, 2);
  assert.ok(result.tasks.every(row => row.type === "NEW" && row.targetUrls.length === 0));
  assert.match(buildPageTaskMerge([], [build("a future unmapped topic")]).conflicts.join(" "), /尚无经过审核/);
});

test("moves only requested words off old cards, reuses emptied tasks and preserves unrelated or completed-link words", () => {
  const old = task("old", "https://flatkey.ai/old", ["first", "retained", "already linked"]);
  const items = [work("first", "https://flatkey.ai/correct"), work("already linked", "https://flatkey.ai/link", { action: "LINK" })];
  const result = buildPageTaskMerge([old], items);
  assert.equal(result.summary.keywords, 1);
  assert.deepEqual(result.after.find(row => row.id === "old").keywords, ["retained", "already linked"]);
  assert.equal(result.tasks[0].keywords.filter(word => word === "first").length, 1);
  const emptied = buildPageTaskMerge([task("reuse-id", "https://flatkey.ai/old", ["first"])], items);
  assert.equal(emptied.tasks[0].id, "reuse-id");
  assert.equal(emptied.summary.created, 0);
});

test("duplicate pristine page cards merge but multiple cards with manual progress are reported without an unsafe merge", () => {
  const page = "https://flatkey.ai/same";
  const items = [work("price", page)];
  const before = [task("manual", page, ["price"], { owner: "Alice" }), task("duplicate", page, ["another related word"])];
  const result = buildPageTaskMerge(before, items);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.tasks[0].id, "manual");
  assert.ok(result.tasks[0].keywords.includes("another related word"));
  assert.equal(result.after.find(row => row.id === "duplicate").status, "MERGED");
  assert.match(buildPageTaskMerge(before.map((row, i) => ({ ...row, owner: i ? "Bob" : "Alice" })), items).conflicts.join(" "), /不同负责人/);
});

test("legacy same-page tasks outside the 149 words also merge without losing keywords or compatible manual metadata", () => {
  const page = "https://flatkey.ai/troubleshooting";
  const before = [task("one", "https://flatkey.ai/planned-one", ["auth errors"], { type: "REUSE", targetUrls: [page], owner: "Alice" }),
    task("two", "https://flatkey.ai/planned-two", ["invalid key"], { type: "REUSE", targetUrls: [`${page}/#key`], dueAt: "2026-11-01T00:00:00.000Z" })];
  const result = buildPageTaskMerge(before, [work("pricing", "https://flatkey.ai/pricing")]);
  assert.deepEqual(result.conflicts, []);
  const legacy = result.after.filter(row => row.status !== "MERGED" && row.keywords.includes("auth errors"));
  assert.equal(legacy.length, 1);
  assert.ok(legacy[0].keywords.includes("invalid key"));
  assert.equal(legacy[0].owner, "Alice");
  assert.equal(legacy[0].dueAt, "2026-11-01T00:00:00.000Z");
  assert.match(legacy[0].reason, /Existing two/);
  assert.equal(buildPageTaskMerge(result.after, [work("pricing", "https://flatkey.ai/pricing")]).changes.length, 0);
});

test("the reviewed local worklist covers all 149 words exactly once in 96 page groups and is repeatable", { skip: !fs.existsSync(path.join(root, ".local/page-actions/2026-10-16/content-actions-all.json")) }, () => {
  const inputs = JSON.parse(fs.readFileSync(path.join(root, ".local/page-actions/2026-10-16/content-actions-all.json"), "utf8"));
  const audit = require("../src/lib/data/keyword-okr-audit.json");
  const before = audit.tasks.map(row => task(String(row.number), row.plannedUrl, row.keywords, { type: row.type, targetUrls: row.targetUrls, title: row.title, reason: audit.reasons[row.reason] }));
  const items = inputs.map((row, i) => ({ ...row, keywordId: String(i) }));
  const result = buildPageTaskMerge(before, items);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.summary.keywords, 149);
  assert.equal(result.summary.expandKeywords, 118);
  assert.equal(result.summary.buildKeywords, 31);
  assert.equal(result.summary.expandPages, 69);
  assert.equal(result.summary.buildPages, 27);
  assert.equal(result.summary.pageTasks, 96);
  assert.equal(result.tasks.reduce((count, row) => count + row.workPlans.length, 0), 149);
  const active = result.after.filter(row => row.status !== "MERGED");
  const destinations = active.map(row => (row.targetUrls[0] ?? row.plannedUrl).replace(/\/+$/, ""));
  assert.equal(new Set(destinations).size, active.length, "all page cards have distinct primary destinations");
  const keptWords = new Set(active.flatMap(row => row.keywords.map(word => word.toLowerCase())));
  for (const word of before.flatMap(row => row.keywords)) assert.ok(keptWords.has(word.toLowerCase()), `old task word remains: ${word}`);
  assert.equal(buildPageTaskMerge(result.after, items).changes.length, 0);
  const output = path.join(root, ".local/page-actions/2026-10-16/page-task-merge-offline-preview.json");
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
});
