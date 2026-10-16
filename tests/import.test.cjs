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
const { displayBucket, rankingStats, matchesRanking } = require("../src/lib/rank-display.ts");
const { compareRankingObservations, matchesWeeklyRanking, isDailyRanking } = require("../src/lib/ranking-evidence.ts");
const { Prisma } = require("@prisma/client");
let batches, observations, pageObservations, failWrite, captures, trafficRows, dailyRows, pageAuditSnapshots;
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
  keywordCurationAudit: { findFirst: async () => null },
  keywordSourceRow: { findMany: async ({where}) => pageAuditSnapshots.filter(row => row.siteDomain === where.siteDomain && row.sourceId === where.sourceId && where.rowKey.in.includes(row.rowKey)) },
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
  $queryRaw: async (query, ...args) => {
    const sql = Array.isArray(query) ? query.join("") : query.sql;
    const values = query.values ?? args;
    if (sql.includes("ranking-period:recent-query-reports")) return observations.filter(row => row.source === "gsc" && row.rankReported && row.periodStart && row.periodEnd
      && row.periodEnd.getTime() - row.periodStart.getTime() === 6 * 86400000 && row.periodEnd.toISOString().slice(0,10) >= values[0] && row.periodEnd.toISOString().slice(0,10) <= values[1])
      .map(row => ({siteDomain:row.siteDomain,text:keywords.find(keyword=>keyword.id === row.keywordId)?.text ?? "",periodStart:row.periodStart,periodEnd:row.periodEnd}));
    if (sql.includes("dashboard:topics")) return values.includes("flatkey.ai") ? [{siteDomain:"flatkey.ai",id:"topic-1",text:"Claude",type:"MAIN",parentId:null,parentIds:[]}] : [];
    if (sql.includes("dashboard:keywords")) return values.includes("flatkey.ai") ? keywords.map(k=>({...k,siteDomain:"flatkey.ai",parentIds:[],topicText:k.topic.text,topicTexts:[],origin:"PLANNED",targetUrls:[]})) : [];
    if (sql.includes("dashboard:ranks")) {
      const source = values.find(value=>["combined","gsc","ahrefs"].includes(value));
      const dates = values.filter(value=>typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
      const period = sql.includes("dashboard:weekly") ? {start:dates[0],end:dates[1]} : null;
      const rows = observations.filter(row=>values.includes(row.siteDomain) && row.rankReported && (source === "combined" || row.source === source) &&
        (!period || matchesWeeklyRanking(row,period) || isDailyRanking(row,period))).sort((a,b)=>compareRankingObservations(b,a));
      const seen=new Set();return rows.filter(row=>{const key=`${row.siteDomain}:${row.keywordId}:${row.region}:${row.source}:${period && isDailyRanking(row,period) ? row.periodEnd.toISOString() : ""}`;if(seen.has(key))return false;seen.add(key);return true;});
    }
    if (sql.includes("dashboard:pages")) {
      const source = values.find(value=>["combined","gsc","ahrefs"].includes(value));
      const dates = values.filter(value=>typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
      const period = sql.includes("dashboard:weekly") ? {start:dates[0],end:dates[1]} : null;
      return pageObservations.filter(row=>values.includes(row.siteDomain) && (source === "combined" || row.source === source) &&
        (!period || matchesWeeklyRanking(row,period) || isDailyRanking(row,period)));
    }
    if (sql.includes("dashboard:volumes")) {
      const rows=await db.keywordObservation.findMany({where:{source:"ahrefs",volume:{not:null}},distinct:["keywordId","region"]});
      return rows.map(row=>({...row,fetchedAt:row.collectedAt}));
    }
    return db.keywordObservation.findMany({where:sql.includes('"rankReported"') ? {rankReported:true,source:values[1],siteDomain:values[0]} : {source:"ahrefs",volume:{not:null}},distinct:["keywordId","region"]});
  },
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
      stagedRows = [], stagedPages = [];
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
      dailyRankingReport: { createMany: async ({data}) => dailyRows.push(...data) },
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
      keywordPageObservation: {
        createMany: async ({ data }) => {
          if (failWrite) throw new Error("simulated write failure");
          stagedPages.push(...data.map(row=>({...row, importedAt:new Date()})));
        },
      },
    });
    batches.push(...stagedBatches);
    observations.push(...stagedRows);
    pageObservations.push(...stagedPages);
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
  pageAuditSnapshots = [];
  batches = [];
  observations = [];
  pageObservations = [];
  captures = [];
  trafficRows = [];
  dailyRows = [];
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
test("long exported queries are preserved and oversized UTF-8 keys fail before writing", () => {
  const keyword = "a".repeat(1092);
  assert.equal(rankingImportSchema.parse(batch([{ ...gsc, keyword }])).observations[0].keyword, keyword);
  assert.equal(rankingImportSchema.safeParse(batch([{ ...gsc, keyword: "a".repeat(2000) }])).success, true);
  for (const keyword of ["a".repeat(2001), "词".repeat(667)]) {
    assert.equal(rankingImportSchema.safeParse(batch([{ ...gsc, keyword }])).success, false);
    assert.equal(rankingImportSchema.safeParse({ ...batch([]), inventory: [{keyword,topic:"发现词"}] }).success, false);
  }
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
  const worklist = await response.json();
  assert.deepEqual(worklist.keywords, []);
  assert.deepEqual(worklist.candidates, [
    { id: "keyword-1", keyword: "claude api", topic: "Claude", origin: "PLANNED", targetUrls: [], latestPageAuditVerdict: null },
  ]);
});

test("collector worklist returns latest page verdict and holds an old READY target after an inconclusive audit", async (t) => {
  t.mock.method(db.siteKeyword,"findMany",async()=>[{siteDomain:"flatkey.ai",keywordId:"keyword-1",keyword:keywords[0],topic:{text:"Claude"},origin:"PLANNED",pool:"FORMAL",mappingStatus:"READY",targetUrls:["https://flatkey.ai/claude"]}]);
  pageAuditSnapshots = [{siteDomain:"flatkey.ai",sourceId:"page_audit",rowKey:"keyword:keyword-1",snapshot:{keywordId:"keyword-1",verdict:"REVIEW",reason:"HTTP403暂时无法核验正文",checkedAt:"2026-10-16T06:00:00Z"}}];
  const url="https://flatkey.test/api/rankings/import?site=flatkey.ai";
  let result=await (await route.GET(new Request(url,{headers:{Authorization:"Bearer test-import-key"}}))).json();
  assert.deepEqual(result.keywords,[]);
  assert.equal(result.candidates[0].latestPageAuditVerdict,"REVIEW");
  assert.equal(result.candidates[0].mappingStatus,"READY");
  pageAuditSnapshots[0].snapshot.verdict="VERIFIED";
  result=await (await route.GET(new Request(url,{headers:{Authorization:"Bearer test-import-key"}}))).json();
  assert.equal(result.keywords.length,1);
  assert.equal(result.keywords[0].latestPageAuditVerdict,"VERIFIED");
  assert.deepEqual(result.candidates,[]);
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
  assert.equal(stats.pending, 1);
  assert.equal(stats.outside, 1);
  assert.equal(stats.checked, 5);
  assert.equal(
    stats.buckets.reduce((sum, row) => sum + row.count, 0),
    5,
    "pending terms are not included in the confirmed no-ranking bucket",
  );
  assert.equal(rankingStats([], "US").percent(0), 0);
});

test("overview pending includes missing and no-data evidence while confirmed outside remains separate", () => {
  const stats = rankingStats([
    { latestRanks: { US: null } },
    { latestRanks: { US: { rank: null, rankStatus: "no_data" } } },
    { latestRanks: { US: { rank: null, rankStatus: "outside_top100" } } },
    { latestRanks: { US: { rank: 110, rankStatus: "outside_top100" } } },
    { latestRanks: { US: { rank: 15, rankStatus: "ranked" } } },
  ], "US");
  assert.equal(stats.total, 5);
  assert.equal(stats.ranked, 1);
  assert.equal(stats.pending, 2);
  assert.equal(stats.outside, 2);
  assert.equal(stats.unranked, 4);
});

test("dashboard preserves GSC fractions, keeps zero volume and selects latest source data including no_data", async (t) => {
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
  let data = await (await dashboard.GET(new Request("https://flatkey.test/api/dashboard?source=gsc&period=history"))).json();
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
  now += 31000;
  data = await (await dashboard.GET(new Request("https://flatkey.test/api/dashboard?source=gsc&period=history"))).json();
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
  now += 31000;
  data = await (await dashboard.GET(new Request("https://flatkey.test/api/dashboard?source=gsc&period=history"))).json();
  // The latest report is shown as unknown, rather than reviving a historical rank.
  assert.equal(data.keywords[0].latestRanks.US.rank, null);
  assert.equal(data.keywords[0].latestRanks.US.rankStatus, "no_data");
  assert.equal(data.keywords[0].latestRanks.US.source, "gsc");
  assert.equal(data.keywords[0].rankingEvidence.US[0].periodEnd, "2026-10-10");
  await route.POST(request({
    ...batch([{...gsc,rank:1,collectedAt:"2026-10-12T02:30:00Z",periodEnd:"2026-10-08"}]),
    requestId:"old-report-read-later",
  }));
  now += 31000;
  data = await (await dashboard.GET(new Request("https://flatkey.test/api/dashboard?source=gsc&period=history"))).json();
  assert.equal(data.keywords[0].latestRanks.US.rank, null);
  assert.equal(data.keywords[0].latestRanks.US.periodEnd, "2026-10-10");
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

const { weeklyPeriods, reportPeriods, registrationRate, relativeChange } = require("../src/lib/weekly-traffic.ts");
const { compareCaptures } = require("../src/lib/daily-changes.ts");
test("weekly reporting uses adjacent completed Tuesday-Monday periods in Shanghai", () => {
  assert.deepEqual(weeklyPeriods(new Date("2026-10-14T02:30:00Z")), { current: { start: "2026-10-06", end: "2026-10-12" }, previous: { start: "2026-09-29", end: "2026-10-05" } });
  assert.equal(weeklyPeriods(new Date("2026-10-12T15:59:00Z")).current.end, "2026-10-05");
  assert.equal(weeklyPeriods(new Date("2026-10-12T16:00:00Z")).current.end, "2026-10-12");
  assert.equal(registrationRate(0, 0), null);
  assert.equal(registrationRate(100, 20), 0.2);
  assert.equal(relativeChange(20, 0), null);
  assert.equal(relativeChange(0, 20), -1);
  assert.equal(weeklyPeriods(new Date("2026-10-13T02:30:00Z"), "America/Los_Angeles").current.end, "2026-10-05");
  assert.deepEqual(reportPeriods("2026-09-29"), {current:{start:"2026-09-29",end:"2026-10-05"},previous:{start:"2026-09-22",end:"2026-09-28"}});
  assert.throws(()=>reportPeriods("2026-09-30"));
  assert.throws(()=>reportPeriods("2026-02-30"));
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

test("dashboard keeps latest GSC and Ahrefs reports independent even when the newest source has no_data", async () => {
  assert.equal((await route.POST(request(batch([
    gsc,
    {keyword:"claude api",region:"US",source:"ahrefs",collectedAt,rank:40,dataUpdatedAt:"2026-10-08T12:00:00Z"},
  ])))).status,201);
  let data = await loadDashboard("flatkey.ai","combined","history");
  assert.deepEqual(data.keywords[0].rankingEvidence.US.map(row=>[row.source,row.rank]),[["gsc",12.4],["ahrefs",40]]);
  assert.equal(data.keywords[0].latestRanks.US.source,"gsc");
  assert.equal((await route.POST(request({
    ...batch([{...gsc,rank:null,rankStatus:"no_data",periodEnd:"2026-10-10",collectedAt:"2026-10-11T02:30:00Z"}]),
    requestId:"source-no-data",
  }))).status,201);
  data = await loadDashboard("flatkey.ai","combined","history");
  assert.deepEqual(data.keywords[0].rankingEvidence.US.map(row=>[row.source,row.rank]),[["gsc",null],["ahrefs",40]]);
  assert.equal(data.keywords[0].latestRanks.US.rankStatus,"no_data");
  const ahrefsOnly = await loadDashboard("flatkey.ai","ahrefs","history");
  assert.equal(ahrefsOnly.keywords[0].rankingEvidence.US.length,1);
  assert.equal(ahrefsOnly.keywords[0].latestRanks.US.rank,40);
});

test("dashboard joins exact-period page evidence while pages-only imports cannot invent a query rank", async () => {
  assert.equal((await route.POST(request({
    ...batch(),pages:[{...gsc,url:"https://flatkey.ai/claude",rank:18.6,impressions:8,clicks:1}],
  }))).status,201);
  let data = await loadDashboard("flatkey.ai","gsc","history");
  const query = data.keywords[0].rankingEvidence.US.find(row=>row.scope==="query");
  assert.equal(query.rank,12.4);
  assert.equal(query.pages[0].rank,18.6);
  assert.equal(query.pages[0].impressions,8);
  assert.equal(query.url,null);
  assert.equal((await route.POST(request({
    requestId:"pages-jp-only",targetDomain:"flatkey.ai",
    pages:[{...gsc,region:"JP",url:"https://flatkey.ai/jp/claude",rank:4.8}],
  }))).status,201);
  data = await loadDashboard("flatkey.ai","combined","history");
  assert.equal(data.keywords[0].latestRanks.JP,null);
  assert.equal(data.keywords[0].rankingEvidence.JP[0].scope,"pages");
  assert.equal(data.keywords[0].rankingEvidence.JP[0].pages[0].rank,4.8);
});

test("default dashboard uses the recent imported seven-day report despite publication delay and rejects longer or daily substitutes", async () => {
  observations.push(
    {...gsc,keywordId:"keyword-1",siteDomain:"flatkey.ai",rankReported:true,rankStatus:"ranked",periodStart:new Date("2026-10-08"),periodEnd:new Date("2026-10-14"),collectedAt:new Date("2026-10-15T01:30:00Z"),importedAt:new Date("2026-10-15T01:31:00Z")},
    {...gsc,keywordId:"keyword-1",siteDomain:"flatkey.ai",rank:1,rankReported:true,rankStatus:"ranked",periodStart:new Date("2026-09-17"),periodEnd:new Date("2026-10-14"),collectedAt:new Date("2026-10-15T02:30:00Z"),importedAt:new Date("2026-10-15T02:31:00Z")},
    {...gsc,keywordId:"keyword-1",siteDomain:"flatkey.ai",rank:5,rankReported:true,rankStatus:"ranked",periodStart:new Date("2026-10-12"),periodEnd:new Date("2026-10-12"),collectedAt:new Date("2026-10-15T02:30:00Z"),importedAt:new Date("2026-10-15T02:31:00Z")},
  );
  const data = await loadDashboard("flatkey.ai","gsc","week",new Date("2026-10-16T06:30:00Z"));
  assert.equal(data.reportingPeriod.start,"2026-10-08");
  assert.equal(data.reportingPeriod.end,"2026-10-14");
  assert.match(data.reportingPeriod.label,/最近已导入7天/);
  assert.equal(data.keywords[0].latestRanks.US.rank,12.4);
  assert.equal(data.keywords[0].rankingEvidence.US[0].daily[0].rank,5);
  const history = await loadDashboard("flatkey.ai","gsc","history");
  assert.equal(history.keywords[0].latestRanks.US.rank,1);
  observations.splice(0,1);
  const noWeeklyReport = await loadDashboard("flatkey.ai","gsc","week",new Date("2026-10-16T06:30:00Z"));
  assert.equal(noWeeklyReport.reportingPeriod.start,"2026-10-09");
  assert.equal(noWeeklyReport.reportingPeriod.end,"2026-10-15");
  assert.equal(noWeeklyReport.keywords[0].latestRanks.US,null);
  assert.equal(noWeeklyReport.keywords[0].rankingEvidence.US[0].scope,"daily");
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

const { assembleDashboard, loadDashboard } = require("../src/lib/services/dashboard-data.ts");
test("bulk dashboard keeps shared keywords and topics separate across sites and preserves every region", () => {
  const topic = {id:"topic",text:"Shared topic",type:"MAIN",parentId:null,parentIds:[]};
  const keyword = {id:"shared",text:"shared keyword",type:"MAIN",topicId:"topic",topicText:"Shared topic",topicTexts:["Second topic"],parentId:null,parentIds:[],origin:"DISCOVERED",targetUrls:[],defaultVolume:100,lastSyncedAt:null};
  const rank = {keywordId:"shared",region:"US",rank:5,source:"gsc",periodStart:new Date("2026-10-01"),periodEnd:new Date("2026-10-14"),url:"https://flatkey.ai/",collectedAt:new Date(collectedAt),dataUpdatedAt:null,rankStatus:"ranked"};
  const value=assembleDashboard("all",["flatkey.ai","rackrate.org"].map(siteDomain=>({...topic,siteDomain})),["flatkey.ai","rackrate.org"].map(siteDomain=>({...keyword,siteDomain})),[{...rank,siteDomain:"flatkey.ai"},{...rank,siteDomain:"rackrate.org",rank:101,rankStatus:"outside_top100",url:"https://rackrate.org/"}],[{keywordId:"shared",region:"US",volume:0,fetchedAt:new Date(collectedAt)},{keywordId:"shared",region:"JP",volume:12,fetchedAt:new Date(collectedAt)}],null,null,[],null,"combined");
  assert.equal(value.keywords.length,2);
  assert.equal(new Set(value.keywords.map(row=>row.id)).size,2);
  assert.equal(value.keywords[0].latestRanks.US.rank,5);
  assert.equal(value.keywords[1].latestRanks.US.rank,101);
  assert.equal(value.keywords[0].marketVolumes.US,0);
  assert.equal(value.keywords[1].marketVolumes.JP,12);
  assert.equal(value.keywords[0].marketVolumes.BR,null);
  assert.equal(value.keywords[0].latestRanks.JP,null);
  assert.equal(value.topics[0].marketVolumes.JP,12);
  assert.equal(value.topics[1].marketVolumes.JP,12);
});

test("summary bulk read does not repeat queries per site or retrieve a legacy sync run", async (t) => {
  let reads=0;
  const original=db.$queryRaw;
  t.mock.method(db,"$queryRaw",async(...args)=>{reads++;return original(...args);});
  t.mock.method(db.syncRun,"findFirst",async()=>{throw new Error("unneeded sync read");});
  const value=await loadDashboard("all","combined");
  assert.equal(value.keywords.length,1);
  assert.equal(reads,6);
});

const { createDashboardStore } = require("../src/lib/dashboard-client.ts");
test("dashboard navigation shares pending reads, reuses fresh data and refreshes after expiry", async () => {
  let requests=0, now=100000, release;
  const body=JSON.stringify({keywords:[],targetDomain:"all"});
  const store=createDashboardStore(async()=>{requests++;if(requests===1)await new Promise(resolve=>{release=resolve;});return new Response(body);},()=>now);
  const a=store.read("all","combined"), b=store.read("all","combined");
  assert.equal(requests,1);release();
  const [first,second]=await Promise.all([a,b]);
  assert.equal(first,second);
  assert.equal(await store.read("all","combined"),first);
  assert.equal(requests,1);
  now+=31000;
  assert.equal(await store.read("all","combined"),first);
  assert.equal(requests,2);
  await store.read("all","combined",true);
  assert.equal(requests,3);
});

test("dashboard authentication failure clears cached data and never retries", async () => {
  let requests=0;
  const store=createDashboardStore(async()=>++requests===1 ? new Response(JSON.stringify({keywords:[]})) : new Response("{}",{status:401}));
  await store.read("all","combined");
  await assert.rejects(store.read("all","combined",true),error=>error.status===401);
  assert.equal(store.peek("all","combined"),null);
  assert.equal(requests,2);
});

test("tab cache displays the full inventory while a fresh read is pending and expires after fifteen minutes", async () => {
  const oldBody=JSON.stringify({keywords:[{id:"old"}],topics:[]});
  const newBody=JSON.stringify({keywords:[{id:"new"}],topics:[]});
  let release,now=100000;
  const persistence={load:async()=>({body:oldBody,savedAt:99000}),save:async()=>{},clear:()=>{}};
  const store=createDashboardStore(async()=>{await new Promise(resolve=>{release=resolve;});return new Response(newBody);},()=>now,persistence);
  const pending=store.read("all","combined");
  const cached=await store.hydrate("all","combined");
  assert.equal(cached.keywords[0].id,"old");
  assert.equal(store.peek("all","combined"),cached);
  release();await pending;
  assert.equal(store.peek("all","combined").keywords[0].id,"new");
  now+=16*60000;
  const expired=createDashboardStore(fetch,()=>now,persistence);
  assert.equal(await expired.hydrate("all","combined"),null);
});

test("logout during a pending cache restore cannot resurrect old data", async () => {
  let release;
  const persistence={load:async()=>{await new Promise(resolve=>{release=resolve;});return {body:JSON.stringify({keywords:[],topics:[]}),savedAt:Date.now()};},save:async()=>{},clear:()=>{}};
  const store=createDashboardStore(fetch,Date.now,persistence);
  const pending=store.hydrate("all","combined");
  store.clear();release();
  assert.equal(await pending,null);
  assert.equal(store.peek("all","combined"),null);
});

const { databaseErrorCode, databaseErrorCategory, databaseReadPhase, retryDatabaseRead, settleReads } = require("../src/lib/database-read.ts");
test("Prisma initialization diagnostics preserve safe errorCode without leaking connection text", () => {
  assert.equal(databaseErrorCode({name:"PrismaClientInitializationError",errorCode:"P1001",message:"connection to private database failed"}),"P1001");
  assert.equal(databaseErrorCode({code:"postgresql://secret@example.test/private",message:"initialization failed"}),"UNKNOWN");
});
test("database reads retry transient connection errors but never schema or validation errors", async () => {
  let attempts=0;
  assert.equal(await retryDatabaseRead(async()=>{if(++attempts===1)throw Object.assign(new Error("cold connection"),{code:"P1001"});return 42;}),42);
  assert.equal(attempts,2);
  attempts=0;
  assert.equal(await retryDatabaseRead(async()=>{if(++attempts===1)throw new Error("server closed the connection unexpectedly");return 7;}),7);
  assert.equal(attempts,2);
  attempts=0;
  await assert.rejects(retryDatabaseRead(async()=>{attempts++;throw new Error("invalid schema");}));
  assert.equal(attempts,1);
  attempts=0;
  await assert.rejects(retryDatabaseRead(async()=>{attempts++;throw Object.assign(new Error("missing table"),{code:"P2021"});}));
  assert.equal(attempts,1);
});
test("failed read groups finish outstanding reads before surfacing the failure", async () => {
  let completed=false;
  await assert.rejects(settleReads([Promise.reject(new Error("failed")),new Promise(resolve=>setTimeout(()=>{completed=true;resolve(1);},10))]));
  assert.equal(completed,true);
});
test("read diagnostics identify the failing phase without exposing database text", async () => {
  const failure = new Error("failed deserialization postgresql://secret@example.test/private");
  await assert.rejects(settleReads([Promise.resolve([]), Promise.reject(failure)], ["topics", "volumes"]), error => error === failure);
  assert.equal(databaseReadPhase(failure), "volumes");
  assert.equal(databaseErrorCategory(failure), "RESULT_DESERIALIZATION");
  assert.equal(databaseErrorCategory({meta:{code:"42P10"}}), "SQLSTATE_42P10");
  assert.equal(databaseErrorCategory({meta:{code:"postgresql://secret@example.test/private"}}), null);
  const capacity = Object.assign(new Error("FATAL: (EMAXCONNSESSION) max clients reached in session mode - pool_size: 15"), {name:"PrismaClientUnknownRequestError"});
  assert.equal(databaseErrorCode(capacity), "CONNECTION_LIMIT");
  assert.equal(databaseErrorCategory(capacity), "CONNECTION_LIMIT");
});

test("ranking filters preserve fractional boundaries and separate unknown from confirmed outside top100", () => {
  assert.equal(matchesRanking({rank:10}, "TOP10"),true);
  assert.equal(matchesRanking({rank:10.5}, "TOP10"),false);
  assert.equal(matchesRanking({rank:10.5}, "11_30"),true);
  assert.equal(matchesRanking({rank:30.5}, "31_50"),true);
  assert.equal(matchesRanking({rank:100}, "TOP100"),true);
  assert.equal(matchesRanking({rank:100.1}, "TOP100"),false);
  assert.equal(matchesRanking({rank:100.1}, "OUTSIDE"),true);
  assert.equal(matchesRanking(null, "OUTSIDE"),false);
  assert.equal(matchesRanking(null, "UNKNOWN"),true);
  assert.equal(matchesRanking({rank:null,rankStatus:"outside_top100"}, "UNKNOWN"),false);
  assert.equal(matchesRanking({rank:null,rankStatus:"outside_top100"}, "OUTSIDE"),true);
});

test("GA4 imports preserve original report timezone and the actual success event's distinct-user metric", () => {
  const row = {periodStart:"2026-10-06",periodEnd:"2026-10-12",timezone:"America/Los_Angeles",newUsers:2572,newRegistrations:417,scope:"all_users",registrationMetric:"sign_up_success_distinct_users",ga4PropertyId:"541304395",collectedAt:"2026-10-14T02:30:00Z"};
  assert.equal(rankingImportSchema.safeParse({...batch([]),traffic:[row]}).success,true);
  assert.equal(rankingImportSchema.safeParse({...batch([]),traffic:[{...row,collectedAt:"2026-10-13T02:30:00Z"}]}).success,false);
  assert.equal(rankingImportSchema.safeParse({...batch([]),traffic:[{...row,timezone:"invalid/timezone"}]}).success,false);
});

const { trendRange, dailyReportPoints, recentTrendRange, snapshotTrendPoints, inventoryTrendByDay } = require("../src/lib/ranking-trends.ts");
const { compareWeeklyRankings } = require("../src/lib/weekly-keywords.ts");
test("trend ranges reject pre-October8, invalid, reversed and future dates", () => {
  const now = new Date("2026-10-15T02:00:00Z");
  assert.deepEqual(trendRange("2026-10-08","2026-10-15",now),{start:"2026-10-08",end:"2026-10-15"});
  for (const pair of [["2026-10-07","2026-10-15"],["2026-10-15","2026-10-08"],["2026-10-08","2026-10-16"],["2026-02-30","2026-10-15"]]) assert.throws(()=>trendRange(...pair,now));
});
test("daily series keeps corrections, uses a stable source, and leaves missing site days empty", () => {
  const row=(site,date,count,source="gsc")=>({siteDomain:site,date:new Date(date),source,top10:count,top30:0,top50:0,top100:0});
  const points=dailyReportPoints([row("a","2026-10-08",3),row("a","2026-10-08",1),row("a","2026-10-08",90,"ahrefs"),row("b","2026-10-08",2),row("a","2026-10-09",4)],"2026-10-08","2026-10-10");
  assert.equal(points.length,1); assert.equal(points[0].counts[0],5);
});
test("overview week rolls at Shanghai midnight and always contains at most seven days", () => {
  assert.deepEqual(recentTrendRange(new Date("2026-10-14T15:59:00Z")), {start:"2026-10-08",end:"2026-10-14"});
  assert.deepEqual(recentTrendRange(new Date("2026-10-14T16:00:00Z")), {start:"2026-10-09",end:"2026-10-15"});
});
test("full snapshot trends count confirmed ranks, retain explicit outside results, and leave unobserved days absent", () => {
  const rows=[{date:"2026-10-14",siteDomain:"flatkey.ai",source:"gsc",rank:5},{date:"2026-10-14",siteDomain:"flatkey.ai",source:"gsc",rank:10.5},{date:"2026-10-14",siteDomain:"flatkey.ai",source:"gsc",rank:101}];
  assert.deepEqual(snapshotTrendPoints(rows),[{date:"2026-10-14",counts:[1,1,0,0],sites:["flatkey.ai"],sources:["gsc"]}]);
  assert.deepEqual(snapshotTrendPoints([]),[]);
});
test("inventory totals carry history through quiet days and rolling weeks without inventing a pre-baseline", () => {
  const point=(date,counts)=>({date,counts,sites:["flatkey.ai"],sources:["gsc"]});
  const base=point("2026-10-14",[464,267,72,116]);
  const days=inventoryTrendByDay([base],"2026-10-09","2026-10-15");
  assert.deepEqual(days.map(row=>[row.date,row.counts.reduce((a,b)=>a+b,0),row.asOf]),[["2026-10-14",919,"2026-10-14"],["2026-10-15",919,"2026-10-14"]]);
  assert.equal(inventoryTrendByDay([base],"2026-10-20","2026-10-26").length,7);
  const updated=inventoryTrendByDay([base,point("2026-10-16",[463,268,72,115])],"2026-10-14","2026-10-17");
  assert.deepEqual(updated.map(row=>row.counts.reduce((a,b)=>a+b,0)),[919,919,918,918]);
  assert.equal(updated.at(-1).asOf,"2026-10-16");
  assert.deepEqual(inventoryTrendByDay([],"2026-10-09","2026-10-15"),[]);
  assert.deepEqual(base.counts,[464,267,72,116]);
});
test("historical daily imports validate full detail counts and do not overwrite current rankings", async () => {
  const row={date:"2026-10-08",region:"US",source:"gsc",top10:1,top30:1,top50:0,top100:0,totalKeywords:2,rankings:[{keyword:"claude api",rank:10},{keyword:"second",rank:10.5}],complete:true,sourceUrl:"https://search.google.com/search-console/performance/search-analytics",collectedAt};
  const body={requestId:"historical-daily",targetDomain:"flatkey.ai",dailyRankings:[row]};
  assert.equal((await route.POST(request(body))).status,201);assert.equal(dailyRows.length,1);assert.equal(observations.length,0);
  assert.equal((await route.POST(request(body))).status,200);assert.equal(dailyRows.length,1);
  for(const invalid of [{...row,complete:false},{...row,top10:2},{...row,totalKeywords:1},{...row,date:"2026-10-20"},{...row,sourceUrl:"https://other.example/report"}]) assert.equal(rankingImportSchema.safeParse({...body,dailyRankings:[invalid]}).success,false);
});
test("keyword period comparison uses the two exact Monday endpoints and preserves country eligibility", () => {
  const row=(date,rank,region="US",source="gsc")=>({siteDomain:"flatkey.ai",region,source,date:new Date(date),rankings:[{keyword:"claude api",rank}]});
  const reports=[row("2026-10-12",5),row("2026-10-06",100),row("2026-10-05",110),row("2026-10-12",1,"JP")];
  const result=compareWeeklyRankings(reports,new Set(["flatkey.ai:US:claude api"]),"2026-10-05","2026-10-12");
  assert.equal(result.daily.entered.length,1);assert.equal(result.daily.net,1);assert.equal(result.daily.siteCaptures.length,1);assert.equal(result.daily.previousDate,"2026-10-05");
  assert.equal(compareWeeklyRankings(reports.filter(row=>row.date.toISOString().slice(0,10)!=="2026-10-05"),new Set(),"2026-10-05","2026-10-12").daily,null);
});

test("weekly keyword publication is separate from daily imports and only accepts Tuesday publication of Monday endpoints", () => {
  const row={date:"2026-10-12",publishForWeek:"2026-10-06",region:"US",source:"gsc",top10:0,top30:0,top50:0,top100:0,totalKeywords:0,rankings:[],complete:true,sourceUrl:"https://search.google.com/search-console/performance/search-analytics",collectedAt:"2026-10-13T10:30:00Z"};
  const body=(r)=>({requestId:"weekly-publish",targetDomain:"flatkey.ai",dailyRankings:[r]});
  assert.equal(rankingImportSchema.safeParse(body(row)).success,true);
  assert.equal(rankingImportSchema.safeParse(body({...row,date:"2026-10-05"})).success,true);
  for(const invalid of [{...row,date:"2026-10-06"},{...row,collectedAt:"2026-10-14T10:30:00Z"},{...row,publishForWeek:"2026-10-13"}]) assert.equal(rankingImportSchema.safeParse(body(invalid)).success,false);
});

const { postImportBatch } = require("../src/lib/import-client.ts");
test("source and page audit imports use their own endpoints and preserve preview receipts", async () => {
  for (const [kind, endpoint, summary] of [["source-sync", "/api/keywords/source-sync", {sourceSummary:{changedRows:1}}], ["page-audit", "/api/keywords/page-audit", {pageSummary:{verified:1}}]]) {
    const batch = {kind, requestId:`${kind}-preview`, targetDomain:"flatkey.ai", action:"preview", rows:[]};
    const response = {imported:1,duplicate:false,stateHash:"a".repeat(64),action:"preview",...summary};
    const result = await postImportBatch(batch,{fetch:async(url, options)=>{
      assert.equal(url,endpoint); assert.deepEqual(JSON.parse(options.body),batch);
      return new Response(JSON.stringify(response),{status:200});
    }});
    assert.deepEqual(result,response);
  }
});
test("import replays the exact batch after a lost commit response and confirms a duplicate without a second write", async () => {
  const bodies=[];let writes=0;
  const result=await postImportBatch({requestId:"lost-response",targetDomain:"flatkey.ai",observations:[]},{delay:async()=>{},fetch:async(_url,options)=>{
    bodies.push(options.body);
    if (bodies.length===1) {writes++;throw new TypeError("connection lost after commit");}
    return new Response(JSON.stringify({imported:1,duplicate:true}),{status:200});
  }});
  assert.equal(writes,1);assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);assert.equal(result.duplicate,true);
});
test("manual import retries only transient failures with a fixed limit and never retries validation errors", async () => {
  let attempts=0;const delays=[];
  await assert.rejects(postImportBatch({requestId:"temporary"},{delay:async(ms)=>delays.push(ms),fetch:async()=>{attempts++;return new Response(JSON.stringify({message:"temporarily unavailable",retryable:true}),{status:503});}}));
  assert.equal(attempts,3);assert.deepEqual(delays,[1000,2000]);
  attempts=0;
  await assert.rejects(postImportBatch({requestId:"invalid"},{delay:async()=>{},fetch:async()=>{attempts++;return new Response(JSON.stringify({message:"invalid batch",retryable:true}),{status:422});}}));
  assert.equal(attempts,1);
});
test("import API exposes safe transient diagnostics and preserves the original requestId", async () => {
  const original=db.seoSite.findUnique;
  db.seoSite.findUnique=async()=>{throw Object.assign(new Error("private connection details"),{name:"PrismaClientInitializationError",errorCode:"P1001"});};
  try {
    const response=await route.POST(request(batch()));const body=await response.json();
    assert.equal(response.status,503);assert.equal(body.code,"P1001");assert.equal(body.retryable,true);assert.equal(body.requestId,batch().requestId);
    assert.equal(response.headers.get("Retry-After"),"2");assert.ok(!JSON.stringify(body).includes("private connection"));assert.ok(!body.message.includes("整批未写入"));
    assert.equal(batches.length,0);
  } finally {db.seoSite.findUnique=original;}
});

test("Labs import requires explicit status, integer rank and true hit URL without GSC period or metrics", () => {
  const labs={keyword:"claude api",source:"dataforseo_labs",region:"US",rank:12,rankStatus:"ranked",url:"https://flatkey.ai/claude",collectedAt:"2026-10-15T02:30:00Z",dataUpdatedAt:"2026-10-01T00:00:00Z"};
  assert.equal(rankingImportSchema.safeParse(batch([labs])).success,true);
  assert.equal(rankingImportSchema.safeParse(batch([{...labs,rank:null,rankStatus:"no_data",url:undefined,dataUpdatedAt:undefined}])).success,true);
  for(const patch of [{rank:12.4},{rankStatus:undefined},{url:undefined},{periodStart:"2026-10-01",periodEnd:"2026-10-14"},{clicks:1},{rank:null,rankStatus:"outside_top100"},{rank:null,rankStatus:"no_data"}])
    assert.equal(rankingImportSchema.safeParse(batch([{...labs,...patch}])).success,false,JSON.stringify(patch));
});
test("Labs observations round-trip through the existing importer with real SERP date and idempotent request identity", async () => {
  const payload=rankingImportSchema.parse(batch([{keyword:"claude api",source:"dataforseo_labs",region:"US",rank:12,rankStatus:"ranked",url:"https://flatkey.ai/claude",collectedAt:"2026-10-15T02:30:00Z",dataUpdatedAt:"2026-10-01T00:00:00Z"}]));
  const firstResponse=await route.POST(request(payload));assert.equal(firstResponse.status,201);const first=await firstResponse.json();assert.equal(first.duplicate,false);assert.equal(observations[0].source,"dataforseo_labs");
  assert.equal(observations[0].dataUpdatedAt.toISOString(),"2026-10-01T00:00:00.000Z");assert.equal(observations[0].periodStart,null);
  assert.equal((await (await route.POST(request(payload))).json()).duplicate,true);assert.equal(observations.length,1);
});
