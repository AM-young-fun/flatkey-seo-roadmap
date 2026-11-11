const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { keywordWorkspaceHref } = require("../src/lib/keyword-workspace-routes.ts");

test("legacy keyword links retain market, keyword, business, optimized status and cross-language scope", () => {
  const url = new URL(keywordWorkspaceHref({ country: "BR", keyword: "preço API de IA", business: "CLOUD_GPU", status: "optimized", crossLanguage: "1" }, "keywords"), "https://seo.example");
  assert.equal(url.pathname, "/opportunities");
  assert.equal(url.searchParams.get("details"), "keywords");
  assert.equal(url.searchParams.get("keyword"), "preço API de IA");
  assert.equal(url.searchParams.get("country"), "BR");
  assert.equal(url.searchParams.get("business"), "CLOUD_GPU");
  assert.equal(url.searchParams.get("status"), "optimized");
  assert.equal(url.searchParams.get("crossLanguage"), "1");
  assert.equal(url.hash, "#keyword-evidence");
});

test("ranking redirect preserves repeated query parameters but opens only its relevant evidence", () => {
  const url = new URL(keywordWorkspaceHref({ country: "JP", tag: ["a", "b"], details: ["network", "keywords"], start: "2026-11-01", ignored: undefined }, "rankings"), "https://seo.example");
  assert.deepEqual(url.searchParams.getAll("tag"), ["a", "b"]);
  assert.deepEqual(url.searchParams.getAll("details"), ["rankings"]);
  assert.equal(url.searchParams.get("start"), "2026-11-01");
  assert.equal(url.searchParams.has("ignored"), false);
});

test("query text cannot turn a legacy keyword link into an external redirect", () => {
  const url = new URL(keywordWorkspaceHref({ q: "https://outside.example/?x=1#x", targetUrl: "https://flatkey.ai/blog/example" }, "keywords"), "https://seo.example");
  assert.equal(url.origin, "https://seo.example");
  assert.equal(url.searchParams.get("q"), "https://outside.example/?x=1#x");
  assert.equal(url.searchParams.get("targetUrl"), "https://flatkey.ai/blog/example");
});
