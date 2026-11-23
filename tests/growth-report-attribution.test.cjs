const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { growthPageContributionDirections } = require("../src/lib/growth-report-attribution.ts");
const period = { start: "2026-11-12", end: "2026-11-18" }, now = new Date("2026-11-23T12:00:00Z");
const workspace = { targets: [], topics: [] };
function observations(url, range = period, property = "sc-domain:flatkey.ai") {
  const first = Date.parse(range.start + "T00:00:00Z") - 7 * 86400000;
  return Array.from({ length: 14 }, (_, i) => ({ kind: "gsc-pages", property, date: new Date(first + i * 86400000).toISOString().slice(0, 10), observedAt: now.toISOString(), source: "google-api", complete: true,
    rows: [{ url, clicks: i < 7 ? 2 : 4, impressions: 50, position: 5 }] }));
}
const publication = (id, publishedAt, pageUrl, extra = {}) => ({ id, taskId: "original-task-" + id, siteDomain: "flatkey.ai", pageUrl, contentVersion: "original-version-" + id, publishedAt, status: "verified", kind: "optimization", language: "en", ...extra });
const driver = (url, publications = [], ws = workspace, range = period, property) => growthPageContributionDirections(ws, publications, observations(url, range, property), range, now)[0].drivers[0];

test("all ten Flatkey route languages retain the content module without assigning a country or target language", () => {
  for (const [prefix, language] of [["", "en"], ["zh", "zh-CN"], ["es", "es-ES"], ["fr", "fr"], ["pt", "pt-BR"], ["ru", "ru"], ["ja", "ja"], ["vi", "vi"], ["de", "de"], ["id", "id"]]) {
    const url = "https://flatkey.ai/" + (prefix ? prefix + "/" : "") + "blog/original-page";
    const target = { site: "flatkey.ai", country: "US", language: "en", topicId: "original-topic", publishedUrls: [url], taskIds: ["original-task"] };
    const ws = { targets: [target], topics: [] }, before = JSON.stringify(ws), row = driver(url, [], ws);
    assert.equal(row.module, "blog", prefix); assert.equal(row.language, language, prefix); assert.equal(row.country, "ALL");
    assert.deepEqual(row.taskIds, ["original-task"]); assert.equal(JSON.stringify(ws), before);
  }
  assert.equal(driver("https://flatkey.ai/ru").module, "home");
  assert.equal(driver("https://flatkey.ai/ru").language, "ru");
  assert.equal(driver("https://flatkey.ai/blog/ru").language, "en", "only the leading route segment identifies a locale");
  assert.equal(driver("https://flatkey.ai/constructor").module, "constructor");
});

test("Flatkey localized routing is not copied onto satellite pages", () => {
  const url = "https://modelfit.cc/models/original-model", pub = publication("satellite", "2026-11-15T00:00:00Z", url, { siteDomain: "modelfit.cc", language: "en" });
  const row = driver(url, [pub], workspace, period, "https://modelfit.cc/");
  assert.equal(row.module, "models"); assert.equal(row.language, "en"); assert.equal(row.country, "ALL");
});

test("verified changes use the actual LA report day across both winter boundaries and explicit offsets", () => {
  const url = "https://flatkey.ai/blog/original-page";
  const publications = [
    publication("utc-start-previous-la-day", "2026-11-12T00:30:00Z", url),
    publication("exact-la-start", "2026-11-12T08:00:00Z", url),
    publication("utc-next-day-still-la-end", "2026-11-19T07:59:59Z", url),
    publication("same-end-in-bjt", "2026-11-19T15:59:59+08:00", url),
    publication("exact-la-next-day", "2026-11-19T08:00:00Z", url),
  ];
  const row = driver(url, publications);
  assert.deepEqual(row.publicationIds, ["exact-la-start", "utc-next-day-still-la-end", "same-end-in-bjt"]);
  assert.match(row.explanation, /本期存在优化回执/);
  assert.deepEqual(new Set(row.taskIds), new Set(publications.map(pub => pub.taskId)), "older task references remain available without falsely counting an in-week change");
  const earlier = driver(url, [publications[0]]);
  assert.deepEqual(earlier.publicationIds, []); assert.match(earlier.explanation, /本期未找到/);
});

test("summer LA daylight time uses its seven-hour offset rather than the winter boundary", () => {
  const url = "https://flatkey.ai/blog/original-page", range = { start: "2026-07-02", end: "2026-07-08" };
  const row = driver(url, [publication("pdt-end", "2026-07-09T06:59:59Z", url), publication("pdt-next", "2026-07-09T07:00:00Z", url)], workspace, range);
  assert.deepEqual(row.publicationIds, ["pdt-end"]);
});
