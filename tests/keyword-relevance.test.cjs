const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);

const { normalizeKeywordText, keywordRelevance } = require("../src/lib/keyword-relevance.ts");
const reviewData = require("../src/lib/data/keyword-review.json");

test("normalization matches full-width text, casing and repeated Unicode whitespace", () => {
  assert.equal(normalizeKeywordText("  ＧＥＭＩＮＩ\u3000API\n  料金  "), "gemini api 料金");
  assert.equal(keywordRelevance(" ＦＬＡＴＫＥＹ．ＡＩ ", "  STORAGE\nUNITS   PRICING ").status, "unrelated");
});

test("reviewed homonyms and unrelated search intent are excluded with a reason", () => {
  for (const keyword of ["tapo h100 vs h200", "warzone low gpu utilization", "openai 401k", "car model names", "peloton bike alternatives"]) {
    const result = keywordRelevance("flatkey.ai", keyword);
    assert.equal(result.status, "unrelated", keyword);
    assert.ok(result.reason, keyword);
  }
  assert.equal(keywordRelevance("rackrate.org", '"compare the market"').status, "unrelated");
});

test("curated exclusions and review decisions are isolated to the reviewed site", () => {
  assert.deepEqual(keywordRelevance("modelfit.cc", "tapo h100 vs h200"), { status: "relevant", reason: null });
  assert.deepEqual(keywordRelevance("flatkey.ai", '"compare the market"'), { status: "relevant", reason: null });
  assert.deepEqual(keywordRelevance("rackrate.org", "6sense api pricing"), { status: "relevant", reason: null });
});

test("standalone noise and currency/count fragments are excluded without matching substrings", () => {
  for (const keyword of [...reviewData.genericNoise, " ＴＵＲＥ ", "$20", "$10 USD", "20 usd", "usd 1,000.00", "€0.50", "r$ 55", "2,000", "5000枚", "20 units"]) {
    assert.equal(keywordRelevance("flatkey.ai", keyword).status, "unrelated", keyword);
  }
  for (const keyword of ["true api pricing", "no api key required llm", "test llm model API", "claude api under $20", "h100 $2 per hour", "4090", "5090", "70b", "26b-a4b", "h100", "gpt-6"]) {
    assert.deepEqual(keywordRelevance("flatkey.ai", keyword), { status: "relevant", reason: null }, keyword);
  }
});

test("valid multilingual model, API, GPU and tool intent remains available", () => {
  for (const keyword of [
    "gemini api 料金", "gemini api 价格", "gemini api 價格", "gemini api 無料枠", "gemma-4-26b-a4b-it",
    "deepseek api бесплатно", "средняя стоимость обработки одного ai-запроса 2026", "api llm gratis",
    "saldo pré-pago api de ia", "aluguel gpu", "音声 文字起こし api", "h100租赁价格", "glm 5.3 prime",
    "openai compatible gemini api", "google/gemma-4-26b-a4b-it", "best gpu for local llm inference and gaming 2026",
    "apify api", "photo editing api", "new enterprise tool API pricing",
  ]) {
    assert.deepEqual(keywordRelevance("flatkey.ai", keyword), { status: "relevant", reason: null }, keyword);
  }
});

test("tool API ambiguity and AI factory ambiguity preserve raw keywords for review", () => {
  for (const keyword of ["6sense api pricing", "funnel api", "jira api base url", "esignature api pricing", "nasdaq api pricing", "what is an ai dark factory", "what is an ai-ready factory?", "企業情報api 料金 費用"]) {
    const result = keywordRelevance("flatkey.ai", keyword);
    assert.equal(result.status, "review", keyword);
    assert.ok(result.reason, keyword);
  }
  const offPeak = reviewData.review.find(row => row.keyword.startsWith("(2) off-peak rates"));
  assert.ok(offPeak);
  assert.equal(keywordRelevance("flatkey.ai", offPeak.keyword).status, "review");
});

test("a realistic long natural-language API question is not excluded by length or formatting", () => {
  const keyword = "I'm building an enterprise AI application with many teams, different model providers and strict monthly budgets. "
    + "Which unified API lets us route between text, image and video models with fallback, per-team quotas, usage accounting, "
    + "provider-compatible SDKs and a predictable integration path while preserving the full original query for review?";
  assert.deepEqual(keywordRelevance("flatkey.ai", keyword), { status: "relevant", reason: null });
});

test("reviewable documentation and runtime policy match without conflicting normalized decisions", () => {
  const document = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/keyword-review-2026-10-15.json"), "utf8"));
  assert.deepEqual(document.excluded, reviewData.excluded);
  assert.deepEqual(document.review, reviewData.review);
  const excludedKeys = new Set(reviewData.excluded.map(row => `${normalizeKeywordText(row.site)}\0${normalizeKeywordText(row.keyword)}`));
  assert.equal(excludedKeys.size, reviewData.excluded.length);
  for (const row of reviewData.review) {
    assert.ok(!excludedKeys.has(`${normalizeKeywordText(row.site)}\0${normalizeKeywordText(row.keyword)}`), row.keyword);
  }
});
