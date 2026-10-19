const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
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

let sessionToken, runs, memberships, reads;
const db = {
  dataForSeoRun: { findFirst: async ({ where, orderBy, select }) => {
    reads.push("run");
    assert.deepEqual(where, { siteDomain: "flatkey.ai", status: "COMPLETED", collectedAt: { not: null }, normalized: { path: ["region"], equals: "US" } });
    assert.deepEqual(select, { normalized: true }, "the endpoint cannot read credentials, request JSON or raw responses");
    assert.deepEqual(orderBy, [{ collectedAt: "desc" }, { createdAt: "desc" }]);
    const run = runs.filter(row => row.siteDomain === where.siteDomain && row.status === where.status && row.collectedAt)
      .sort((a, b) => b.collectedAt - a.collectedAt || b.createdAt - a.createdAt)[0];
    return run ? { normalized: structuredClone(run.normalized) } : null;
  } },
  siteKeyword: { findMany: async ({ where, select }) => {
    reads.push("memberships");
    assert.deepEqual(where, { siteDomain: "flatkey.ai" }, "all memberships must be read so retired words cannot become new candidates");
    assert.deepEqual(select, { keywordId: true, active: true, pool: true, excludedAt: true, reviewStatus: true, keyword: { select: { text: true, active: true } } });
    return structuredClone(memberships);
  } },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: {
  cookies: async () => ({ get: name => name === "seo_rank_auth" && sessionToken ? { value: sessionToken } : undefined }),
} };
const { buildRankingDiscovery } = require("../src/lib/ranking-discovery.ts");
const { loadRankingDiscovery } = require("../src/lib/services/ranking-discovery.ts");
const { GET } = require("../src/app/api/rankings/discovery/route.ts");
const { getAuthToken } = require("../src/lib/auth.ts");
const collectedAt = "2026-10-16T03:33:16.037Z";
function row(keyword, rank = 7, overrides = {}) {
  return { source: "dataforseo_labs", keyword, rawKeyword: keyword, region: "US", locationCode: 2840, languageCode: "en", itemIndex: 0,
    rank_group: rank, rank_absolute: rank + 2, url: `https://flatkey.ai/models/${encodeURIComponent(keyword)}`, title: keyword,
    sourceSerpUpdatedAt: "2026-09-01T05:00:00.000Z", sourceSerpUpdatedAtRaw: null, sourceSerpDateField: null,
    volume: 30, volumeUpdatedAt: null, checkUrl: "https://www.google.com/search?q=example", collectedAt, ...overrides };
}
function snapshot(rows = []) {
  return { schemaVersion: 1, source: "dataforseo_labs", datasetType: "provider_ranked_keywords_snapshot", runId: "cached-discovery",
    targetDomain: "flatkey.ai", region: "US", languageCode: "en", collectedAt, historicalSerpMode: "live", realTimeSerpFetch: false,
    requestedLimit: 1000, returnedItems: rows.length, totalMatchingCount: rows.length, truncated: false, rows, rejectedItems: [] };
}
function member(text, pool = "FORMAL", overrides = {}) {
  return { keywordId: text, active: true, pool, keyword: { text, active: true }, ...overrides };
}
function run(normalized, overrides = {}) {
  return { siteDomain: "flatkey.ai", status: "COMPLETED", collectedAt: new Date(collectedAt), createdAt: new Date(collectedAt), normalized, ...overrides };
}
beforeEach(t => {
  process.env.LOGIN_PWD = "fictional-discovery-session-password";
  process.env.DATABASE_URL = "postgresql://unused.invalid/discovery";
  sessionToken = null; runs = []; memberships = []; reads = [];
  t.mock.method(globalThis, "fetch", async () => { assert.fail("cached discovery must never perform a provider/network request"); });
});

test("the full cached business discovery stays separate from the formal OKR cohort, and unknown words remain uninserted candidates", () => {
  const cached = snapshot([row("claude api", 31), row("a100 rental", 2), row("gpt 5.4 api pricing", 6), row("yes", 1)]);
  const members = [member("ＣＬＡＵＤＥ   API"), member("a100 rental", "RESEARCH"), member("flatkey"), member("flatkey ai")];
  const before = structuredClone(members), result = buildRankingDiscovery(cached, members, "all", "US");
  assert.equal(result.available, true);
  assert.deepEqual(result.stats, { uniqueDiscoveredKeywords: 3, uniqueBusinessKeywords: 3, intentReview: 0, returnedItems: 4, filteredUnrelated: 1, policyExcluded: 0,
    formal: 1, research: 1, newCandidates: 1, ambiguous: 0, buckets: [2, 0, 1, 0] });
  assert.equal(result.rows.find(row => row.keyword === "claude api").pool, "FORMAL");
  assert.equal(result.rows.find(row => row.keyword === "gpt 5.4 api pricing").pool, "NEW_CANDIDATE");
  assert.equal(result.rows.find(row => row.keyword === "gpt 5.4 api pricing").keywordId, null);
  assert.deepEqual(result.brandCoverage, { formalTerms: 2, returnedTerms: 0, unobservedTerms: ["flatkey", "flatkey ai"] });
  assert.deepEqual(members, before);
  assert.equal(result.snapshot.siteDomain, "flatkey.ai", "all-site selection does not broaden the actual captured site");
  assert.equal(result.snapshot.realTimeSerpFetch, false);
});

test("ambiguous homepage phrase plan key retains its observed rank but is not counted as confirmed business relevance", () => {
  const result = buildRankingDiscovery(snapshot([row("plan key", 57, { url: "https://flatkey.ai/" }), row("gpt 5.4 api pricing", 6)]), [], "all", "US");
  assert.equal(result.stats.uniqueDiscoveredKeywords, 2); assert.equal(result.stats.uniqueBusinessKeywords, 1);
  assert.equal(result.stats.intentReview, 1); assert.equal(result.stats.newCandidates, 1); assert.equal(result.stats.ambiguous, 1);
  assert.deepEqual(result.stats.buckets, [1, 0, 0, 0]);
  const planKey = result.rows.find(row => row.keyword === "plan key");
  assert.equal(planKey.rank, 57); assert.equal(planKey.pool, "AMBIGUOUS"); assert.equal(planKey.relevance, "review");
  assert.match(planKey.reviewReason, /不足以确认/);
});

test("manual exclusions, archived/merged words and inactive identities never return as new candidates", () => {
  const words = ["archived model api", "merged model api", "inactive model api", "inactive global model api", "excluded model api", "manual status model api"];
  const members = [member(words[0], "ARCHIVED"), member(words[1], "MERGED"), member(words[2], "RESEARCH", { active: false }),
    member(words[3], "RESEARCH", { keyword: { text: words[3], active: false } }), member(words[4], "FORMAL", { excludedAt: new Date(collectedAt) }),
    member(words[5], "FORMAL", { reviewStatus: "MANUALLY_ARCHIVED" })];
  const before = structuredClone(members);
  const result = buildRankingDiscovery(snapshot([...words.map(word => row(word)), row(words[0], 3, { url: "https://flatkey.ai/blog/archived" }), row("new model api")]), members, "all", "US");
  assert.equal(result.stats.policyExcluded, 6, "one retired word is counted once even with multiple ranking URLs");
  assert.deepEqual(result.rows.map(row => row.keyword), ["new model api"]);
  assert.equal(result.stats.newCandidates, 1); assert.deepEqual(members, before);
});

test("an active canonical word remains visible when an inactive merged spelling shares its normalized identity", () => {
  const members = [member("claude api"), member("ＣＬＡＵＤＥ   API", "MERGED", { active: false, excludedAt: new Date(collectedAt) })];
  const result = buildRankingDiscovery(snapshot([row("claude api")]), members, "all", "US");
  assert.equal(result.stats.policyExcluded, 0); assert.equal(result.stats.formal, 1);
  assert.equal(result.rows[0].keywordId, "claude api"); assert.equal(result.rows[0].pool, "FORMAL");
});

test("one keyword retains each actual URL and source date without averaging or counting duplicate words", () => {
  const oldPage = row("claude api", 2, { url: "https://flatkey.ai/models/claude", sourceSerpUpdatedAt: "2026-08-01T00:00:00.000Z" });
  const newPage = row("claude api", 19, { url: "https://flatkey.ai/blog/claude-api", sourceSerpUpdatedAt: "2026-10-01T00:00:00.000Z" });
  const unknownDate = row("claude api", 1, { url: "https://flatkey.ai/claude-api", sourceSerpUpdatedAt: null });
  const result = buildRankingDiscovery(snapshot([oldPage, newPage, unknownDate, structuredClone(oldPage)]), [member("claude api")], "flatkey.ai", "US");
  assert.equal(result.stats.uniqueBusinessKeywords, 1);
  assert.deepEqual(result.stats.buckets, [0, 1, 0, 0]);
  assert.equal(result.rows[0].rank, 19, "a newer provider date takes precedence over an old or undated better rank");
  assert.equal(result.rows[0].sourceSerpUpdatedAt, newPage.sourceSerpUpdatedAt);
  assert.equal(result.rows[0].collectedAt, collectedAt);
  assert.equal(result.rows[0].pages.length, 3);
  assert.deepEqual(result.rows[0].pages.map(p => p.rank), [19, 2, 1]);
  assert.equal(result.rows[0].pages[2].sourceSerpUpdatedAt, null, "unknown provider date must not become the collection date");
});

test("ambiguous normalized memberships do not silently assign a word to either keyword identity", () => {
  const result = buildRankingDiscovery(snapshot([row("claude api")]), [member("claude api"), member("ＣＬＡＵＤＥ API", "RESEARCH")], "all", "US");
  assert.equal(result.rows[0].pool, "AMBIGUOUS"); assert.equal(result.rows[0].keywordId, null);
  assert.equal(result.stats.ambiguous, 1); assert.equal(result.stats.formal, 0);
});

test("no capture and unsupported markets are unavailable, while a genuine completed empty snapshot is explicitly available", () => {
  for (const [site, region] of [["rackrate.org", "US"], ["modelfit.cc", "US"], ["flatkey.ai", "JP"], ["all", "JP"]]) {
    const result = buildRankingDiscovery(snapshot([row("claude api")]), [member("claude api")], site, region);
    assert.equal(result.available, false); assert.equal(result.reason, "OUT_OF_SCOPE"); assert.equal(result.snapshot, null); assert.deepEqual(result.rows, []);
  }
  assert.equal(buildRankingDiscovery(null, [], "all", "US").reason, "NO_SNAPSHOT");
  const empty = buildRankingDiscovery(snapshot(), [member("flatkey")], "flatkey.ai", "US");
  assert.equal(empty.available, true); assert.equal(empty.stats.uniqueBusinessKeywords, 0);
  assert.deepEqual(empty.brandCoverage.unobservedTerms, ["flatkey"]);
});

test("malformed scope, foreign URLs and invalid ranks cannot masquerade as lower discovered coverage", () => {
  for (const cached of [
    { ...snapshot(), targetDomain: "other.example" }, { ...snapshot(), collectedAt: "unknown" },
    { ...snapshot(), realTimeSerpFetch: true }, snapshot([row("claude api", 0)]), snapshot([row("claude api", 101)]),
    snapshot([row("claude api", 4, { url: "https://flatkey.ai.other.example/model" })]),
  ]) {
    const result = buildRankingDiscovery(cached, [], "all", "US");
    assert.equal(result.available, false); assert.equal(result.reason, "INVALID_SNAPSHOT"); assert.equal(result.snapshot, null);
  }
});

test("the service reads only the newest completed normalized snapshot and does not replay a pending or failed ledger", async () => {
  memberships = [member("claude api")];
  runs = [run(snapshot([row("claude api", 7)])), run(snapshot([row("claude api", 1)]), { status: "IMPORT_FAILED", collectedAt: new Date("2026-10-17T00:00:00Z") }),
    run(snapshot([row("claude api", 2)]), { collectedAt: new Date("2026-10-15T00:00:00Z") })];
  const before = structuredClone({ memberships, runs }), result = await loadRankingDiscovery("all", "US");
  assert.equal(result.rows[0].rank, 7); assert.deepEqual({ memberships, runs }, before);
  reads = []; assert.equal((await loadRankingDiscovery("all", "JP")).available, false); assert.deepEqual(reads, []);
});

test("GET requires an enabled cookie session, keeps cache private and accepts no collector bearer substitute", async () => {
  const request = query => new Request(`https://flatkey.test/api/rankings/discovery${query}`, { headers: { Authorization: "Bearer fictional-collector-token" } });
  assert.equal((await GET(request(""))).status, 401); assert.deepEqual(reads, []);
  sessionToken = await getAuthToken(); runs = [run(snapshot([row("claude api")]))]; memberships = [member("claude api")];
  const response = await GET(request("?site=flatkey.ai&region=US"));
  assert.equal(response.status, 200); assert.match(response.headers.get("Cache-Control"), /private, no-store/);
  const dto = await response.json(); assert.equal(dto.stats.formal, 1);
  for (const text of ["rawResponse", "requestJson", "encryptedCredentials", "connectionVersion"]) assert.ok(!JSON.stringify(dto).includes(text));
  assert.equal((await GET(request("?site=arbitrary.example"))).status, 400);
  assert.equal((await GET(request("?region=INVALID"))).status, 400);
  delete process.env.LOGIN_PWD;
  assert.equal((await GET(request(""))).status, 401);
});
