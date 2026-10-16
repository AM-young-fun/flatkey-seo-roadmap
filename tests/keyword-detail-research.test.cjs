const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);

process.env.DATABASE_URL = "postgresql://test.invalid/research-evidence";
const collectedAt = new Date("2026-10-16T03:33:16.037Z");
const sourceDate = new Date("2026-09-28T11:27:05Z");
const memberships = [
  { id: "formal", text: "claude api", pool: "FORMAL", topicId: "topic-1", topicText: "Claude API" },
  { id: "research", text: "google gemini url", pool: "RESEARCH", topicId: null, topicText: null },
];
const queries = memberships.map((row, index) => ({
  siteDomain: "flatkey.ai", keywordId: row.id, region: "US", source: "dataforseo_labs", rank: index ? 23 : 12,
  rankStatus: "ranked", rankReported: true, captureStatus: "COMPLETE", captureId: "complete-snapshot",
  collectedAt, dataUpdatedAt: sourceDate, importedAt: collectedAt, periodStart: null, periodEnd: null,
  url: `https://flatkey.ai/blog/${row.id}`, volume: index ? 200 : 100,
}));
const phases = [];
const db = {
  rankingImport: { findFirst: async () => null },
  syncRun: { findFirst: async () => null },
  $queryRaw: async query => {
    const sql = query.sql;
    const phase = /dashboard:(keywords|ranks|pages|volumes|topics)/.exec(sql)?.[1];
    if (phase === "topics") return [{ siteDomain: "flatkey.ai", id: "topic-1", text: "Claude API", type: "MAIN", parentId: null, parentIds: [] }];
    // Model the membership restriction against a real missing-topic research
    // fixture, for every evidence read rather than merely testing a UI filter.
    const includeResearch = sql.includes("sk.pool IN ('FORMAL','RESEARCH')");
    assert.ok(includeResearch || sql.includes("sk.pool = 'FORMAL'"));
    phases.push({ phase, includeResearch });
    const allowed = memberships.filter(row => includeResearch || row.pool === "FORMAL" && row.topicId);
    const ids = new Set(allowed.map(row => row.id));
    if (phase === "keywords") return allowed.map(row => ({ ...row, siteDomain: "flatkey.ai", type: "MAIN", parentId: null,
      parentIds: [], topicTexts: [], origin: "DISCOVERED", targetUrls: [], defaultVolume: 0, lastSyncedAt: null }));
    if (phase === "ranks" || phase === "pages") return queries.filter(row => ids.has(row.keywordId));
    if (phase === "volumes") return queries.filter(row => ids.has(row.keywordId)).map(row => ({ ...row, fetchedAt: collectedAt }));
    throw new Error(`Unexpected read: ${phase}`);
  },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const { GET } = require("../src/app/api/dashboard/route.ts");
const { createDashboardStore } = require("../src/lib/dashboard-client.ts");

test("keyword-detail scope exposes stored research rank, page and volume without a topic while overview remains formal", async () => {
  const read = async suffix => {
    const response = await GET(new Request(`https://flatkey.test/api/dashboard?site=flatkey.ai${suffix}`));
    assert.equal(response.status, 200);
    return response.json();
  };
  const overview = await read("");
  assert.deepEqual(overview.keywords.map(row => row.id), ["formal"]);
  const details = await read("&includeResearch=1");
  assert.deepEqual(details.keywords.map(row => row.id), ["formal", "research"]);
  const research = details.keywords.find(row => row.id === "research");
  assert.equal(research.topicId, null);
  assert.equal(research.latestRanks.US.rank, 23);
  assert.equal(research.latestRanks.US.checkedAt, collectedAt.toISOString());
  assert.equal(research.rankingEvidence.US[0].pages[0].url, "https://flatkey.ai/blog/research");
  assert.equal(research.marketVolumes.US, 200);
  assert.equal((await read("")).keywords.length, 1);
  assert.equal((await read("&includeResearch=1")).keywords.length, 2);
  for (const phase of ["keywords", "ranks", "pages", "volumes"]) {
    assert.deepEqual(phases.filter(row => row.phase === phase).map(row => row.includeResearch), [false, true]);
  }
  assert.equal((await GET(new Request("https://flatkey.test/api/dashboard?includeResearch=all"))).status, 400);
});

test("in-memory and persisted dashboard caches keep research detail data separate from overview data", async () => {
  const saved = new Map(), urls = [];
  const persistence = {
    load: async key => saved.get(key), save: async (key, body, savedAt) => saved.set(key, { body, savedAt }), clear: () => saved.clear(),
  };
  const fetcher = async url => {
    urls.push(url);
    const response = await GET(new Request(`https://flatkey.test${url}`));
    return response;
  };
  const store = createDashboardStore(fetcher, () => 100000, persistence);
  const [overview, details] = await Promise.all([store.read("flatkey.ai", "dataforseo_labs"), store.read("flatkey.ai", "dataforseo_labs", false, true)]);
  assert.equal(overview.keywords.length, 1);
  assert.equal(details.keywords.length, 2);
  assert.equal(store.peek("flatkey.ai", "dataforseo_labs").keywords.length, 1);
  assert.equal(store.peek("flatkey.ai", "dataforseo_labs", true).keywords.length, 2);
  assert.ok(urls.some(url => url.includes("includeResearch=1")));
  assert.equal(saved.size, 2);
  const restored = createDashboardStore(fetcher, () => 100000, persistence);
  assert.equal((await restored.hydrate("flatkey.ai", "dataforseo_labs")).keywords.length, 1);
  assert.equal((await restored.hydrate("flatkey.ai", "dataforseo_labs", true)).keywords.length, 2);
});
