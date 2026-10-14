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
let batches, observations, failWrite;
const keywords = [
  {
    id: "keyword-1",
    text: "claude api",
    topic: { text: "Claude" },
    type: "LONG_TAIL",
    topicId: "topic-1",
    parentId: null,
    childEdges: [],
    active: true,
    snapshots: [],
    diffs: [],
    volumes: [],
    lastSyncedAt: null,
    defaultVolume: 0,
  },
];
const db = {
  keyword: { findMany: async () => keywords },
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
  $queryRaw: async (strings) =>
    db.keywordObservation.findMany({
      where: strings.join("").includes('"rankReported"')
        ? { rankReported: true }
        : { source: "ahrefs", volume: { not: null } },
      distinct: ["keywordId", "region"],
    }),
  keywordObservation: {
    findMany: async ({ where, distinct }) => {
      const rows = observations
        .filter(
          (row) =>
            (!where.rankReported || row.rankReported) &&
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
      rankingImport: {
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
    { id: "keyword-1", keyword: "claude api", topic: "Claude" },
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

test("dashboard shows imported GSC fractions, independent zero volume, and ignores older backfills", async () => {
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
  let data = await (await dashboard.GET()).json();
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
  data = await (await dashboard.GET()).json();
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
  data = await (await dashboard.GET()).json();
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
