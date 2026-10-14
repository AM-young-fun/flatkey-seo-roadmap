const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolve.call(
    this,
    name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name,
    parent,
    ...rest,
  );
};
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
const {
  rankingImportSchema,
  importSecretMatches,
  readImportJson,
} = require("../src/lib/ranking-import.ts");
const { displayBucket, rankingStats } = require("../src/lib/rank-display.ts");
const { Prisma } = require("@prisma/client");
let batches, observations, failWrite, captures, trafficRows;
const keywords = [
  {
    id: "keyword-1",
    text: "claude api",
    topic: { text: "Claude" },
    type: "LONG_TAIL",
    topicId: "topic-1",
    parentId: null,
    childEdges: [],
    siteLinks: [{ topicId: "topic-1", topic: { text: "Claude" }, topicAssignments: [], targetUrls: [], origin: "PLANNED" }],
    active: true,
    snapshots: [],
    diffs: [],
    volumes: [],
    lastSyncedAt: null,
    defaultVolume: 0,
  },
];
const db = {
  seoSite: { findUnique: async ({ where }) => ["flatkey.ai", "rackrate.org"].includes(where.domain) ? { domain: where.domain, active: true, ga4PropertyId: null } : null },
  siteKeyword: { findMany: async ({where}) => where.siteDomain === "flatkey.ai" ? keywords.map(keyword => ({ keyword, keywordId: keyword.id, topic: keyword.topic, origin: "PLANNED", targetUrls: [], active: true, topicId: "topic-1", sourceUrl: null })) : [] },
  keyword: { findMany: async ({where}) => ["rackrate.org", "modelfit.cc"].includes(where.siteLinks?.some?.siteDomain) ? [] : keywords.filter(keyword => !where.id?.in || where.id.in.includes(keyword.id)) },
  rankingImport: {
    findUnique: async ({ where }) =>
      batches.find((batch) => batch.requestId === where.requestId) ?? null,
    findFirst: async () =>
      [...batches].sort((a, b) => b.importedAt - a.importedAt)[0] ?? null,
  },
  topic: {
    findMany: async () => [
      {
        id: "topic-1",
        text: "Claude",
        type: "MAIN",
        parentId: null,
        childEdges: [],
        active: true,
      },
    ],
  },
  syncRun: {
    findFirst: async () => null,
    updateMany: async () => ({ count: 0 }),
  },
  $executeRaw: async () => 0,
  $queryRaw: async (strings, ...values) =>
    db.keywordObservation.findMany({
      where: strings.join("").includes('"rankReported"')
        ? { rankReported: true, source: values[1], siteDomain: values[0] }
        : { source: "ahrefs", volume: { not: null } },
      distinct: ["keywordId", "region"],
    }),
  keywordObservation: {
    findMany: async ({ where, distinct }) => {
      const rows = observations
        .filter(
          (row) =>
            (!where.rankReported || row.rankReported) &&
            (!where.siteDomain || row.siteDomain === where.siteDomain) &&
            (!where.volume || row.volume != null) &&
            (!where.source || row.source === where.source),
        )
        .sort(
          (a, b) =>
            b.collectedAt - a.collectedAt || b.importedAt - a.importedAt,
        );
      const seen = new Set();
      return rows.filter((row) => {
        const key = distinct.map((field) => row[field]).join(":");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  },
  $transaction: async (callback) => {
    const stagedBatches = [],
      stagedRows = [];
    const result = await callback({
      $executeRaw: db.$executeRaw,
      $queryRaw: async () => keywords,
      seoSite: { findUniqueOrThrow: async ({where}) => db.seoSite.findUnique({where}), update: async () => ({}) },
      rankingCapture: {
        findUnique: async ({where}) => captures.find(c => c.id === where.id) ?? null,
        upsert: async ({where,create}) => { if (!captures.some(c => c.id === where.id)) captures.push(create); return create; },
        update: async ({where,data}) => Object.assign(captures.find(c => c.id === where.id),data),
      },
      weeklyTraffic: { createMany: async ({data}) => trafficRows.push(...data) },
      siteKeyword: db.siteKeyword,
      rankingImport: {
        findUnique: db.rankingImport.findUnique,
        create: async ({ data }) => {
          if (batches.some((batch) => batch.requestId === data.requestId))
            throw new Prisma.PrismaClientKnownRequestError("duplicate", {
              code: "P2002",
              clientVersion: "6.12.0",
            });
          const batch = {
            ...data,
            id: `batch-${batches.length}`,
            importedAt: new Date(),
          };
          stagedBatches.push(batch);
          return batch;
        },
      },
      keywordObservation: {
        createMany: async ({ data }) => {
          if (failWrite) throw new Error("simulated write failure");
          stagedRows.push(
            ...data.map((row) => ({ ...row, importedAt: new Date() })),
          );
        },
      },
    });
    batches.push(...stagedBatches);
    observations.push(...stagedRows);
    return result;
  },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { prisma: db },
};
const route = require("../src/app/api/rankings/import/route.ts");
const dashboard = require("../src/app/api/dashboard/route.ts");
const collectedAt = "2026-10-10T02:30:00Z";
const gsc = {
  keyword: "claude api",
  region: "US",
  source: "gsc",
  collectedAt,
  rank: 12.4,
  clicks: 2,
  impressions: 20,
  ctr: 0.1,
  periodStart: "2026-09-10",
  periodEnd: "2026-10-09",
};
const batch = (rows = [gsc]) => ({
  requestId: "daily-2026-10-10-gsc",
  targetDomain: "flatkey.ai",
  observations: rows,
});
const request = (body, token = "test-import-key") =>
  new Request("https://flatkey.test/api/rankings/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  batches = [];
  observations = [];
  captures = [];
  trafficRows = [];
  failWrite = false;
  delete process.env.CRON_SECRET;
  delete process.env.LOGIN_PWD;
  process.env.DATABASE_URL = "postgresql://unused";
  process.env.RANKING_IMPORT_SECRET = "test-import-key";
  process.env.SEO_TARGET_DOMAIN = "flatkey.ai";
});

test("GSC preserves fractional rank and rejects missing statistical period", () => {
  assert.equal(rankingImportSchema.parse(batch()).observations[0].rank, 12.4);
  assert.equal(
    rankingImportSchema.safeParse(batch([{ ...gsc, periodEnd: undefined }]))
      .success,
    false,
  );
  assert.equal(
    rankingImportSchema.safeParse(batch([{ ...gsc, volume: 20 }])).success,
    false,
  );
  assert.equal(
    rankingImportSchema.safeParse(batch([{ ...gsc, rank: undefined }])).success,
    false,
  );
});
test("Ahrefs accepts volume-only and explicit no-rank rows, rejects decimal rank", () => {
  const row = {
    keyword: "claude api",
    region: "JP",
    source: "ahrefs",
    collectedAt,
    volume: 0,
  };
  assert.equal(rankingImportSchema.safeParse(batch([row])).success, true);
  assert.equal(
    rankingImportSchema.safeParse(batch([{ ...row, rank: null }])).success,
    true,
  );
  assert.equal(
    rankingImportSchema.safeParse(batch([{ ...row, rank: 1.2 }])).success,
    false,
  );
});
test("invalid dates, duplicate market/source, unknown fields and impossible metrics fail", () => {
  for (const rows of [
    [gsc, gsc],
    [{ ...gsc, periodEnd: "2026-02-30" }],
    [{ ...gsc, periodStart: "2026-10-10" }],
    [{ ...gsc, impressions: 1 }],
    [{ ...gsc, ctr: 10 }],
    [{ ...gsc, region: "GB" }],
    [{ ...gsc, garbage: true }],
  ])
    assert.equal(rankingImportSchema.safeParse(batch(rows)).success, false);
});
test("secret is required and matches only exact Bearer credentials", () => {
  assert.equal(importSecretMatches("Bearer key", "key"), true);
  for (const token of [null, "Bearer ke", "Bearer keyx", "Basic key"])
    assert.equal(importSecretMatches(token, "key"), false);
  assert.equal(importSecretMatches("Bearer ", ""), false);
});
test("unconfigured or invalid credentials cannot write", async () => {
  assert.equal((await route.POST(request(batch(), "wrong"))).status, 401);
  delete process.env.RANKING_IMPORT_SECRET;
  assert.equal((await route.POST(request(batch()))).status, 503);
  assert.equal(batches.length, 0);
});
test("import is atomic and retries are idempotent", async () => {
  const first = await route.POST(request(batch()));
  assert.equal(first.status, 201);
  assert.equal(observations[0].rank, 12.4);
  assert.equal(observations[0].rankReported, true);
  const retry = await route.POST(request(batch()));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).duplicate, true);
  assert.equal(batches.length, 1);
  assert.equal(observations.length, 1);
  assert.equal(
    (await route.POST(request(batch([{ ...gsc, rank: 15 }])))).status,
    409,
  );
  assert.equal(observations.length, 1);
});
test("mixed GSC/Ahrefs batches preserve volume-only status and data dates", async () => {
  const response = await route.POST(
    request(
      batch([
        gsc,
        {
          keyword: "claude api",
          region: "US",
          source: "ahrefs",
          collectedAt,
          volume: 1000,
        },
      ]),
    ),
  );
  assert.equal(response.status, 201);
  assert.equal(observations.length, 2);
  const volume = observations.find((row) => row.source === "ahrefs");
  assert.equal(volume.volume, 1000);
  assert.equal(volume.rankReported, false);
  assert.equal(
    observations.find((row) => row.source === "gsc").periodEnd.toISOString(),
    "2026-10-09T00:00:00.000Z",
  );
});
test("wrong domain and unknown keywords reject the entire batch", async () => {
  assert.equal(
    (await route.POST(request({ ...batch(), targetDomain: "other.ai" })))
      .status,
    400,
  );
  assert.equal(
    (await route.POST(request(batch([gsc, { ...gsc, keyword: "unknown" }]))))
      .status,
    422,
  );
  assert.equal(batches.length, 0);
  assert.equal(observations.length, 0);
});
test("failed row writes roll back batch metadata", async () => {
  failWrite = true;
  assert.equal((await route.POST(request(batch()))).status, 500);
  assert.equal(batches.length, 0);
  failWrite = false;
  assert.equal((await route.POST(request(batch()))).status, 201);
});
test("work-list GET requires the import key", async () => {
  assert.equal(
    (await route.GET(new Request("https://flatkey.test/api/rankings/import")))
      .status,
    401,
  );
  const response = await route.GET(
    new Request("https://flatkey.test/api/rankings/import", {
      headers: { authorization: "Bearer test-import-key" },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).keywords, [
    { id: "keyword-1", keyword: "claude api", topic: "Claude", origin: "PLANNED", targetUrls: [] },
  ]);
});
test("body size is bounded even without Content-Length", async () => {
  await assert.rejects(
    readImportJson(
      new Request("https://flatkey.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(2000001),
      }),
    ),
    (error) => error.status === 413,
  );
  await assert.rejects(
    readImportJson(
      new Request("https://flatkey.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    ),
    (error) => error.status === 400,
  );
});
test("display tiers handle all boundaries and cumulative statistics", () => {
  assert.deepEqual(
    [1, 10, 10.1, 30, 31, 50, 51, 100, 101, null, undefined].map(
      (rank) => displayBucket(rank).key,
    ),
    [
      "TOP_10",
      "TOP_10",
      "TOP_30",
      "TOP_30",
      "TOP_50",
      "TOP_50",
      "TOP_100",
      "TOP_100",
      "NOT_FOUND",
      "NOT_FOUND",
      "NOT_FOUND",
    ],
  );
  const stats = rankingStats(
    [1, 20, 40, 70, 120, null].map((rank) => ({
      latestRanks: { US: { rank } },
    })),
    "US",
  );
  assert.deepEqual(
    stats.thresholds.map((row) => row.count),
    [1, 2, 3, 4],
  );
  assert.equal(stats.ranked, 4);
  assert.equal(stats.unranked, 2);
  assert.equal(
    stats.buckets.reduce((sum, row) => sum + row.count, 0),
    6,
  );
  assert.equal(rankingStats([], "US").percent(0), 0);
});

test("dashboard shows imported GSC fractions, independent zero volume, and ignores older backfills", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  await route.POST(
    request(
      batch([
        gsc,
        {
          keyword: "claude api",
          region: "US",
          source: "ahrefs",
          collectedAt,
          volume: 0,
        },
      ]),
    ),
  );
  let data = await (await dashboard.GET(new Request("https://flatkey.test/api/dashboard?source=gsc"))).json();
  assert.equal(data.keywords[0].latestRanks.US.rank, 12.4);
  assert.equal(data.keywords[0].latestRanks.US.source, "gsc");
  assert.equal(data.keywords[0].latestRanks.US.periodEnd, "2026-10-09");
  assert.equal(data.keywords[0].marketVolumes.US, 0);
  assert.equal(data.keywords[0].latestRanks.JP, null);
  assert.ok(data.latestImportAt);
  await route.POST(
    request({
      ...batch([
        {
          ...gsc,
          rank: 80,
          collectedAt: "2026-10-09T02:30:00Z",
          periodEnd: "2026-10-08",
        },
      ]),
      requestId: "backfill-001",
    }),
  );
  now += 6000;
  data = await (await dashboard.GET(new Request("https://flatkey.test/api/dashboard?source=gsc"))).json();
  assert.equal(data.keywords[0].latestRanks.US.rank, 12.4);
  assert.equal(
    data.keywords[0].lastSyncedAt,
    new Date(collectedAt).toISOString(),
  );
  await route.POST(
    request({
      ...batch([
        {
          ...gsc,
          rank: null,
          collectedAt: "2026-10-11T02:30:00Z",
          periodEnd: "2026-10-10",
        },
      ]),
      requestId: "daily-2026-10-11",
    }),
  );
  now += 6000;
  data = await (await dashboard.GET(new Request("https://flatkey.test/api/dashboard?source=gsc"))).json();
  assert.equal(data.keywords[0].latestRanks.US.rank, null);
  assert.equal(data.keywords[0].latestRanks.US.source, "gsc");
});

test("import credential never bypasses authentication on other APIs", async () => {
  const { NextRequest } = require("next/server");
  const { proxy } = require("../src/proxy.ts");
  process.env.LOGIN_PWD = "page-password";
  try {
    const blocked = await proxy(
      new NextRequest("https://flatkey.test/api/keywords", {
        headers: { authorization: "Bearer test-import-key" },
      }),
    );
    assert.equal(blocked.status, 401);
    const passed = await proxy(
      new NextRequest("https://flatkey.test/api/rankings/import", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    assert.equal(passed.headers.get("x-middleware-next"), "1");
    assert.equal((await route.POST(request(batch(), "wrong"))).status, 401);
  } finally {
    delete process.env.LOGIN_PWD;
  }
});

test("derived import keys are separate from page and cron credentials", async () => {
  const { getRankingImportSecret } = require("../src/lib/import-credential.ts");
  delete process.env.RANKING_IMPORT_SECRET;
  process.env.LOGIN_PWD = "existing-page-password";
  const derived = getRankingImportSecret();
  assert.match(derived, /^[a-f0-9]{64}$/);
  assert.notEqual(derived, process.env.LOGIN_PWD);
  assert.equal((await route.POST(request(batch(), derived))).status, 201);
  assert.equal(
    (await route.POST(request(batch(), process.env.LOGIN_PWD))).status,
    401,
  );
  process.env.CRON_SECRET = "existing-cron-secret";
  assert.notEqual(getRankingImportSecret(), derived);
  process.env.RANKING_IMPORT_SECRET = "override";
  assert.equal(getRankingImportSecret(), "override");
});
test("credential endpoint is private and never works with page login disabled", async () => {
  const { NextRequest } = require("next/server");
  const credential = require("../src/app/api/rankings/credential/route.ts");
  const { getAuthToken } = require("../src/lib/auth.ts");
  assert.equal(
    (
      await credential.GET(
        new NextRequest("https://flatkey.test/api/rankings/credential"),
      )
    ).status,
    401,
  );
  process.env.LOGIN_PWD = "existing-page-password";
  assert.equal(
    (
      await credential.GET(
        new NextRequest("https://flatkey.test/api/rankings/credential", {
          headers: { authorization: "Bearer test-import-key" },
        }),
      )
    ).status,
    401,
  );
  const token = await getAuthToken();
  const response = await credential.GET(
    new NextRequest("https://flatkey.test/api/rankings/credential", {
      headers: { cookie: `seo_rank_auth=${token}` },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).secret, "test-import-key");
});

const { weeklyPeriods, registrationRate, relativeChange } = require("../src/lib/weekly-traffic.ts");
const { compareCaptures } = require("../src/lib/daily-changes.ts");
test("weekly reporting uses adjacent completed Tuesday-Monday periods in Shanghai", () => {
  assert.deepEqual(weeklyPeriods(new Date("2026-10-14T02:30:00Z")), { current: { start: "2026-10-06", end: "2026-10-12" }, previous: { start: "2026-09-29", end: "2026-10-05" } });
  assert.equal(weeklyPeriods(new Date("2026-10-12T15:59:00Z")).current.end, "2026-10-05");
  assert.equal(weeklyPeriods(new Date("2026-10-12T16:00:00Z")).current.end, "2026-10-12");
  assert.equal(registrationRate(0, 0), null);
  assert.equal(registrationRate(100, 20), 0.2);
  assert.equal(relativeChange(20, 0), null);
  assert.equal(relativeChange(0, 20), -1);
});
test("traffic imports enforce 7 days, same property, distinct signup users and closed weeks", () => {
  const row = { periodStart: "2026-10-06", periodEnd: "2026-10-12", timezone: "Asia/Shanghai", newUsers: 100, newRegistrations: 20, ga4PropertyId: "123456", scope: "all_users", registrationMetric: "sign_up_distinct_users", collectedAt: "2026-10-14T02:30:00Z" };
  const traffic = (rows) => ({ requestId: "week-1", targetDomain: "flatkey.ai", traffic: rows });
  assert.equal(rankingImportSchema.safeParse(traffic([row])).success, true);
  for (const invalid of [{ ...row, periodStart: "2026-10-05" }, { ...row, registrationMetric: "sign_up_events" }, { ...row, newUsers: -1 }, { ...row, periodEnd: "2026-10-19", periodStart: "2026-10-13" }]) assert.equal(rankingImportSchema.safeParse(traffic([invalid])).success, false);
  assert.equal(rankingImportSchema.safeParse(traffic([row, { ...row, periodStart: "2026-09-29", periodEnd: "2026-10-05", ga4PropertyId: "999" }])).success, false);
});
test("daily comparison excludes zero/unknown volumes and distinguishes missing from confirmed loss", () => {
  const row = (keywordId, rank, rankStatus = rank == null ? "no_data" : rank <= 100 ? "ranked" : "outside_top100") => ({keywordId,rank,rankStatus});
  const previous = [row("a",10),row("b",99),row("c",50),row("d",20)];
  const current = [row("a",5),row("b",110),row("c",null),row("e",100),row("zero",1)];
  const result = compareCaptures(current,previous,new Set(["a","b","c","d","e"]));
  assert.equal(result.count,2);
  assert.deepEqual(result.entered,["e"]);
  assert.deepEqual(result.lost,["b"]);
  assert.deepEqual(result.missing,["c","d"]);
  assert.equal(result.detectedReduction,3);
  assert.equal(result.net,-2);
  assert.equal(compareCaptures(current,null,new Set(["a"])).net,null);
});
test("rank URLs outside target site are rejected atomically", async () => {
  assert.equal((await route.POST(request(batch([{...gsc,url:"https://other.ai/blog"}])))).status,400);
  assert.equal(batches.length,0);
});
test("website and ranking-source filters cannot mix observations", async () => {
  await route.POST(request(batch()));
  const ahrefs = await (await dashboard.GET(new Request("https://flatkey.test/api/dashboard?site=flatkey.ai&source=ahrefs"))).json();
  assert.equal(ahrefs.keywords[0].latestRanks.US,null);
  const other = await (await dashboard.GET(new Request("https://flatkey.test/api/dashboard?site=rackrate.org&source=gsc"))).json();
  assert.equal(other.keywords.length,0);
});

test("partial captures must be explicitly sealed and a completed capture rejects new writes", async () => {
  const capture = { id: "site-2026-10-10", date: "2026-10-10", region: "US", source: "gsc", coverage: "site_top100", complete: false };
  assert.equal((await route.POST(request({...batch(),capture}))).status,201);
  assert.equal(captures[0].status,"PARTIAL");
  assert.equal((await route.POST(request({requestId:"capture-seal",targetDomain:"flatkey.ai",capture:{...capture,complete:true}}))).status,201);
  assert.equal(captures[0].status,"COMPLETE");
  assert.equal((await route.POST(request({...batch(),requestId:"capture-late",capture}))).status,409);
  assert.equal((await route.POST(request({...batch(),capture}))).status,200);
});
test("weekly traffic can be imported without rankings and retransmission is idempotent", async () => {
  const body = { requestId: "traffic-week1", targetDomain: "flatkey.ai", traffic: [{ periodStart: "2026-10-06", periodEnd: "2026-10-12", timezone: "Asia/Shanghai", scope: "all_users", registrationMetric: "sign_up_distinct_users", ga4PropertyId: "123456", newUsers: 100, newRegistrations: 20, collectedAt: "2026-10-14T02:30:00Z" }] };
  assert.equal((await route.POST(request(body))).status,201);
  assert.equal(trafficRows[0].newRegistrations,20);
  assert.equal(trafficRows[0].periodStart.toISOString().slice(0,10),"2026-10-06");
  assert.equal((await route.POST(request(body))).status,200);
  assert.equal(trafficRows.length,1);
});

test("bulk inventory preserves multiple topic assignments and unions planned URLs without invented volume", async (t) => {
  const topics = [], savedKeywords = [], memberships = [], assignments = [], volumes = [];
  t.mock.method(db, "$transaction", async callback => callback({
    $executeRaw: async () => 0, $queryRaw: async () => [],
    rankingImport: { findUnique: async () => null, create: async ({data}) => ({ ...data, id:"inventory-batch", importedAt:new Date() }) },
    topic: { findMany: async () => [], createMany: async ({data}) => topics.push(...data) },
    siteTopic: { createMany: async () => ({count:0}) }, topicRelation: { createMany: async () => ({count:0}) },
    keyword: { createMany: async ({data}) => savedKeywords.push(...data) },
    siteKeyword: { findMany: async () => [], createMany: async ({data}) => memberships.push(...data) },
    siteKeywordTopic: { createMany: async ({data}) => assignments.push(...data) },
    keywordVolume: { createMany: async ({data}) => volumes.push(...data) },
  }));
  const body = { requestId:"library-bulk", targetDomain:"flatkey.ai", inventory:[
    { keyword:"new gpu keyword", topic:"GPU Cost", targetUrls:["https://flatkey.ai/blog/cost"], marketVolumes:{US:0} },
    { keyword:"new gpu keyword", topic:"GPU Sizing", targetUrls:["https://flatkey.ai/blog/sizing"] },
  ] };
  assert.equal((await route.POST(request(body))).status,201);
  assert.equal(savedKeywords.length,1);
  assert.equal(memberships.length,1);
  assert.equal(assignments.length,2);
  assert.deepEqual(memberships[0].targetUrls,["https://flatkey.ai/blog/cost","https://flatkey.ai/blog/sizing"]);
  assert.equal(volumes.length,1);
  assert.equal(volumes[0].volume,0);
  assert.equal(volumes[0].region,"US");
});

test("case variants prefer the website's tracked keyword rather than an unassigned legacy label", async (t) => {
  const transaction = db.$transaction;
  t.mock.method(db, "$transaction", callback => transaction(async tx => {
    tx.$queryRaw = async () => [keywords[0], { ...keywords[0], id:"legacy-label", text:"CLAUDE API", topicId:null }];
    tx.siteKeyword = { findMany: async () => [{ keywordId:"keyword-1", active:true, topicId:"topic-1", origin:"PLANNED", targetUrls:[], sourceUrl:null }] };
    return callback(tx);
  }));
  assert.equal((await route.POST(request(batch([{...gsc,keyword:"CLAUDE API"}])))).status,201);
  assert.equal(observations[0].keywordId,"keyword-1");
});

test("overview uses full site keyword inventory without a fixed 500 cap", async () => {
  const data = await (await dashboard.GET(new Request("https://flatkey.test/api/dashboard?site=all&source=ahrefs"))).json();
  assert.equal(data.keywords.length, 1);
  assert.equal(data.keywords[0].siteName, "Flatkey");
});

const { retryDatabaseRead, settleReads } = require("../src/lib/database-read.ts");
test("database reads retry transient connection errors but never schema or validation errors", async () => {
  let attempts=0;
  assert.equal(await retryDatabaseRead(async()=>{if(++attempts===1)throw Object.assign(new Error("cold connection"),{code:"P1001"});return 42;}),42);
  assert.equal(attempts,2);
  attempts=0;
  await assert.rejects(retryDatabaseRead(async()=>{attempts++;throw Object.assign(new Error("missing table"),{code:"P2021"});}));
  assert.equal(attempts,1);
});
test("failed read groups finish outstanding reads before surfacing the failure", async () => {
  let completed=false;
  await assert.rejects(settleReads([Promise.reject(new Error("failed")),new Promise(resolve=>setTimeout(()=>{completed=true;resolve(1);},10))]));
  assert.equal(completed,true);
});
