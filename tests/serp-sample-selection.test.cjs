const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { selectSerpSampleTargets, SERP_SAMPLE_MAX_QUERIES } = require("../src/lib/serp-sample-selection.ts");

const target = (keyword, targetUrls, overrides = {}) => ({ keyword, keywordId: keyword, siteDomain: "flatkey.ai", targetUrls, ...overrides });

test("the paid sample is an existing formal subset; missing terms are never invented or replaced", () => {
  assert.equal(SERP_SAMPLE_MAX_QUERIES, 38);
  const input = [target("flatkey", ["https://flatkey.ai/"]), target("gpt image 2 pricing", ["https://flatkey.ai/models/gpt-image-2"]),
    target("claude api pricing", ["https://flatkey.ai/blog/claude-api-pricing"]), target("yes", ["https://flatkey.ai/"]),
    target("flatkey model api price", ["https://flatkey.ai/models/gpt-image-2"]), target("unreviewed new model pricing", ["https://flatkey.ai/models/new-model"])];
  const result = selectSerpSampleTargets(input);
  assert.deepEqual(result.targets.map(row => row.keyword), ["flatkey", "gpt image 2 pricing", "claude api pricing"]);
  assert.deepEqual(Object.values(result.categories), ["BRAND", "MODEL_PRICE", "MODEL_PRICE"]);
  assert.equal(result.reasons["flatkey.ai:gpt image 2 pricing"], "模型价格词，已有对应模型详情页");
  assert.deepEqual(selectSerpSampleTargets([]).targets, []);
});

test("sample selection prioritizes brands, then model details, then pricing articles independently of input order", () => {
  const input = [target("claude api pricing", ["https://flatkey.ai/blog/claude-api-pricing"]),
    target("seedance 2.5 api pricing", ["https://flatkey.ai/models/seedance-2.5"]),
    target("flatkey sdk setup", ["https://flatkey.ai/blog/flatkey-integration-starter"]), target("flat key", ["https://flatkey.ai/"]),
    target("flatkey", ["https://flatkey.ai/"]), target("gpt 6 astra price", ["https://flatkey.ai/models/gpt-6-astra"])];
  const snapshot = structuredClone(input);
  const selected = selectSerpSampleTargets(input);
  assert.deepEqual(selected.targets.map(row => row.keyword), ["flatkey", "flat key", "flatkey sdk setup", "gpt 6 astra price", "seedance 2.5 api pricing", "claude api pricing"]);
  assert.deepEqual(selected, selectSerpSampleTargets([...input].reverse()));
  selected.targets[0].targetUrls.push("https://flatkey.ai/other");
  assert.deepEqual(input, snapshot, "preview output must not mutate its formal cohort input");
});

test("only the precise same-site page type qualifies; missing, spoofed, prompt and mismatched pages cannot authorize a query", () => {
  const rows = [target("flatkey", []), target("flatkey ai", ["https://flatkey.ai.attacker.test/"]),
    target("flat key", ["javascript:alert(1)"]), target("gpt image 2 pricing", ["https://flatkey.ai/blog/gpt-image-2"]),
    target("gpt 6 astra price", ["https://flatkey.ai/models/gpt-6-astra/prompts/film"]),
    target("claude api pricing", ["https://flatkey.ai/models/claude"]),
    target("seedance 2.5 api pricing", ["https://flatkey.ai/models/seedance-2.5"], { siteDomain: "modelfit.cc" }),
    target("glm prime pricing", ["https://flatkey.ai/ja/models/glm-5.3-prime"]),
    target("gemini 3 pro image price", ["https://flatkey.ai/id/models/gemini-3-pro-image"]),
    target("glm api price", ["https://flatkey.ai@attacker.test/models/glm-api"])];
  assert.deepEqual(selectSerpSampleTargets(rows).targets.map(row => row.keyword), ["gemini 3 pro image price", "glm prime pricing"]);
});

test("normalization keeps exact intended terms and duplicate rows never enlarge the approved query count", () => {
  const first = target("  FLATKEY  AI ", ["https://flatkey.ai/"], { keywordId: "a" });
  const duplicate = target("flatkey ai", ["https://flatkey.ai/"], { keywordId: "b" });
  const pages = ["https://flatkey.ai/models/gpt-image-2", "https://flatkey.ai/blog/gpt-image-2-pricing"];
  const result = selectSerpSampleTargets([duplicate, first, first, target("gpt image 2 pricing", pages)]);
  assert.equal(result.targets.length, 2);
  assert.equal(result.targets[0].keywordId, "a");
  assert.deepEqual(result.targets[1].targetUrls, pages, "all formal target pages are retained for multi-page evidence");
  assert.deepEqual(Object.keys(result.categories), ["flatkey.ai:a", "flatkey.ai:gpt image 2 pricing"]);
});
