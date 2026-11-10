const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

let rankings;
let discovery = [];
const prisma = {
  serpMonitorRun: { findUnique: async ({ where }) => {
    assert.equal(where.periodKey_scope.scope, "SCHEDULED");
    return where.periodKey_scope.periodKey === "2026-11-17" ? rankings : null;
  } },
  dataForSeoRun: { findMany: async () => discovery },
  serpMonitorTask: { count: async () => 5 },
};
const originalLoad = Module._load;
const originalTs = require.extensions[".ts"];
Module._load = function (request, ...args) {
  if (request === "@/lib/prisma") return { prisma };
  if (request === "@/lib/keyword-cycle") return {
    keywordCyclePlan: (_now, key) => ({
      period: require("../src/lib/serp-periods.ts").serpPeriodFromKey(key),
      jobs: ["US", "JP", "ES", "BR"].map(requestId => ({ requestId })),
    }),
  };
  if (request.startsWith("@/")) {
    request = path.join(__dirname, "../src", request.slice(2) + ".ts");
  }
  return originalLoad.call(this, request, ...args);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
const { readRankingNotice } = require("../src/lib/services/ranking-notice.ts");
Module._load = originalLoad;
require.extensions[".ts"] = originalTs;

const due = new Date("2026-11-19T00:00:00Z");
const later = new Date("2026-11-19T02:00:00Z");
const result = {
  id: "scheduled-run",
  startedAt: due,
  status: "COMPLETED",
  queryCount: 5,
  actualCostMicros: 30_000,
  tasks: [{ id: "actual-provider-receipt" }],
};

test("only reports due periods with proof of actual execution", async () => {
  rankings = result;
  assert.equal(await readRankingNotice(new Date(due.getTime() - 1)), null);
  rankings = { ...result, startedAt: new Date(due.getTime() - 1) };
  assert.equal(await readRankingNotice(later), null);
  rankings = { ...result, tasks: [] };
  assert.equal(await readRankingNotice(later), null);
  rankings = { ...result, status: "RUNNING" };
  assert.equal(await readRankingNotice(later), null);
  rankings = result;
  discovery = Array.from({ length: 4 }, () => ({ createdAt: due, actualCostMicros: 100_000 }));
  assert.match((await readRankingNotice(later)).text, /完成.*5\/5 次.*\$0\.43/);
  rankings = { ...result, status: "UNKNOWN" };
  assert.match((await readRankingNotice(later)).text, /需处理.*费用待结算/);
});

test("reports discovery failure only when an actual supplier request was attempted", async () => {
  rankings = null;
  discovery = [{ createdAt: due, status: "UNKNOWN", errorCode: "DISCOVERY_PRECHECK_FAILED" }];
  assert.equal(await readRankingNotice(later), null);
  discovery[0].errorCode = "DISCOVERY_RESPONSE_UNCONFIRMED";
  assert.match((await readRankingNotice(later)).text, /新词采集需处理，排名未开始/);
});
