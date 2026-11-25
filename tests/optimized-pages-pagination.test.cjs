const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const src = path.resolve(__dirname, "../src"), load = Module._load;
const results = Array.from({ length: 24 }, (_, index) => ({
  id: "published-" + (index + 1),
  pageUrl: "https://flatkey.ai/blog/gpu-" + (index + 1),
  siteDomain: "flatkey.ai", title: "GPU Page " + (index + 1), kind: "optimization", status: "verified",
  publishedAt: `2025-11-${String(index + 1).padStart(2, "0")}T08:00:00Z`,
  verifiedAt: "2025-11-25T08:01:00Z", verificationRecordedAt: "2025-11-25T08:03:00Z",
}));
const laterVersion = { ...results[0], id: "later-version", publishedAt: "2025-12-10T08:00:00Z", verifiedAt: "2025-12-10T08:01:00Z", verificationRecordedAt: "2025-12-10T08:03:00Z" };
Module._load = function(name, parent, ...args) {
  if (name === "@/lib/seo-analytics-access") return {
    analyticsLocalPreview: () => false, authorizeAnalyticsRead: async request => request.headers.has("x-fixture"),
    privateAnalyticsHeaders: { "cache-control": "private, no-store" },
  };
  if (name === "@/lib/prisma") return { prisma: { keywordSourceRow: { findMany: async () => [] } } };
  if (name === "@/lib/services/seo-workflow") return { loadWorkflowSnapshot: async () => ({ publications: [...results, laterVersion] }) };
  return load.call(this, name.startsWith("@/") ? path.join(src, name.slice(2)) : name, parent, ...args);
};
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { GET } = require("../src/app/api/seo/optimized-pages/route.ts");
const request = async (query = "", authenticated = true) => GET(new Request("https://flatkey.test/api/seo/optimized-pages" + query,
  { headers: authenticated ? { "x-fixture": "1" } : {} }));

test("optimization list returns only ten page summaries, with later and clamped pages", async () => {
  const responses = await Promise.all([request(), request("?page=2"), request("?page=99")]);
  assert.ok(responses.every(result => result.status === 200 && result.headers.get("cache-control") === "private, no-store"));
  const [first, second, last] = await Promise.all(responses.map(result => result.json()));
  assert.deepEqual([first.rows.length, second.rows.length, last.rows.length], [10, 10, 4]);
  assert.deepEqual([first.page, second.page, last.page], [1, 2, 3]);
  assert.equal(first.total, 24);
  assert.equal(first.rows[0].version.id, "later-version");
  assert.equal(first.rows[0].page.versions, undefined);
  assert.equal(new Set([...first.rows, ...second.rows, ...last.rows].map(row => row.page.url)).size, 24);
});

test("filters precede pagination; archived detail uses a direct original publication lookup", async () => {
  const list = await (await request("?q=gpu+page&site=flatkey.ai&start=2025-11-01&end=2025-11-18&page=2")).json();
  assert.equal(list.total, 18);
  assert.equal(list.rows.length, 8);
  assert.ok(list.rows.some(row => row.version.id === "published-1"));
  const detail = await (await request("?publication=published-1")).json();
  assert.equal(detail.view, "detail");
  assert.equal(detail.item.version.id, "published-1");
  assert.equal(detail.rows, undefined);
  const byUrl = await (await request("?" + new URLSearchParams({ pageUrl: "https://flatkey.ai/blog/gpu-1/" }))).json();
  assert.equal(byUrl.item.version.id, "later-version");
  assert.equal((await request("?page=0")).status, 400);
  assert.equal((await request("?publication=published-1", false)).status, 401);
});
