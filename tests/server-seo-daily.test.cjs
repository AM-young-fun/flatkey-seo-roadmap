const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { collectionReceipt } = require("../scripts/server-seo-receipt.cjs");

async function exercise(ga4, options = {}) {
  const file = fs.readFileSync(path.join(__dirname, "../scripts/server-seo-daily.cjs"), "utf8");
  const requests = [];
  const logs = [];
  const receipts = [];
  const context = vm.createContext({
    process: { env: { SEO_IMPORT_TOKEN: "test", SEO_GOOGLE_SERVICE_ACCOUNT_JSON: "test" } },
    CLUSTER_SITES: [],
    collectionStartedAt: "2026-11-11T00:30:00Z", receiptAttempted: false,
    saveCollectionReceipt: async input => receipts.push(collectionReceipt({ ...input, runId: "123", attempt: "1", sha: "a".repeat(40) })),
    seoToday: () => "2026-11-11",
    collectionDateRange: () => ({ start: "2026-10-27", end: "2026-11-09" }),
    shiftDay: () => "2026-11-09",
    fetchGa4Organic: ga4,
    fetchGscDateCoverage: async () => options.dates ?? ({}),
    fetchGscDailyPages: async () => ({ state: "unavailable" }),
    fetchGscDailyPageQueries: async () => { throw Object.assign(new Error("missing report"), { code: "unavailable" }); },
    analyticsStorageKind: (kind, country) => kind + (country ? ":" + country : ""),
    clusterDomainForProperty: () => undefined,
    fetch: async (url, options) => {
      requests.push({ url, method: options.method });
      return { ok: true, json: async () => ({ rows: [] }) };
    },
    URLSearchParams, AbortSignal,
    console: { log: value => logs.push(JSON.parse(value)), error: value => logs.push(JSON.parse(value)) },
  });
  // Exercise the orchestration without credentials, real Google calls or imports.
  const source = file.slice(file.indexOf('const endpoint ='));
  vm.runInContext(source.slice(0, source.lastIndexOf('run().catch')) + 'globalThis.done = run();', context);
  await context.done;
  return { logs, requests, receipts, exitCode: context.process.exitCode };
}

test("empty Google results remain missing without marking the collector broken", async () => {
  const result = await exercise(async () => ({ daily: [] }));
  assert.equal(result.exitCode, undefined);
  assert.equal(result.requests.length, 2);
  assert.equal(result.requests[0].method, "GET");
  assert.deepEqual(result.logs.at(-1), { imported: 0, failures: 0, unavailable: 10, expected: 0, missing: 0 });
  assert.equal(result.logs.filter(row => row.status === "no_source_data").length, 10);
  assert.equal(result.receipts.length, 1); assert.equal(result.receipts[0].record.status, "partial");
});

test("permission failures still fail the run and are not treated as empty data", async () => {
  const result = await exercise(async () => { throw Object.assign(new Error("access denied"), { code: "forbidden" }); });
  assert.equal(result.exitCode, 1);
  assert.equal(result.requests.length, 2);
  assert.deepEqual(result.logs.at(-1), { imported: 0, failures: 5, unavailable: 5, expected: 0, missing: 0 });
  assert.equal(result.logs.filter(row => row.status === "failed" && row.reason === "forbidden").length, 5);
  assert.equal(result.receipts[0].record.status, "failed");
});

test("source-backed dates missing from production fail the final coverage check", async () => {
 const result = await exercise(async () => ({ daily: [] }), { dates: { "2026-11-07": { clicks: 1, impressions: 4, position: 5 } } });
 assert.equal(result.exitCode, 1);
 assert.equal(result.logs.at(-1).missing, 15);
 assert.equal(result.logs.at(-1).expected, 15);
 assert.equal(result.logs.at(-1).failures, 6);
});
