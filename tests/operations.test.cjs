const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
let calls = 0, session = false;
mock("src/lib/auth.ts", { AUTH_COOKIE_NAME: "seo_rank_auth", isAuthEnabled: () => true, isValidAuthToken: async value => value === "valid-session" });
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => ({ get: () => session ? { value: "valid-session" } : undefined }) } };
mock("src/lib/prisma.ts", { prisma: {
  serpMonitorConfig: { findUnique: async () => { calls++; return { paidEnabled: false, nextDueAt: null }; } },
  dataForSeoConnection: { findUnique: async input => { assert.deepEqual(input.select, { scheduleEnabled: true }); return { scheduleEnabled: false }; } },
  schedulerCheck: { findMany: async () => [] },
  serpMonitorRun: { findMany: async () => [{ id: "existing", scope: "SAMPLE", periodKey: "2026-10-2", periodLabel: "2026年10月第2期", status: "COMPLETED", queryCount: 152, startedAt: new Date("2026-10-16T01:00Z"), completedAt: new Date("2026-10-16T02:00Z") }] },
  dataForSeoRun: { findMany: async () => [] }, weeklyTraffic: { findMany: async () => [] },
  collectorRun:{findMany:async()=>[]},
  seoWorkflowRecord:{findMany:async()=>[]},
} });
const { schedulerState, plannedRankingTime, operationStateLabels, configuredAutomationPlans, nextAutomationTime } = require("../src/lib/operations.ts");
const { loadOperationsStatus } = require("../src/lib/services/operations.ts");
mock("src/lib/seo-analytics-access.ts", { analyticsLocalPreview: () => false });
const { GET } = require("../src/app/api/operations/route.ts");
test("configured schedule and unfinished heartbeat cannot masquerade as successful execution", () => {
  const now = new Date("2026-10-19T08:00:00Z");
  assert.equal(schedulerState(null, now), "UNCONFIRMED");
  const last = { startedAt: new Date("2026-10-19T07:45:00Z"), completedAt: null, status: "RUNNING" };
  assert.equal(schedulerState(last, now), "UNCONFIRMED");
  assert.equal(schedulerState({ ...last, completedAt: now, status: "COMPLETED" }, now), "HEALTHY");
  assert.equal(schedulerState({ ...last, startedAt: new Date("2026-10-19T06:00:00Z"), completedAt: now, status: "COMPLETED" }, now), "OVERDUE");
  assert.equal(schedulerState({ ...last, status: "NEEDS_REVIEW" }, now), "ERROR");
  const priorRun = { startedAt: new Date("2026-11-16T15:55:00Z"), completedAt: new Date("2026-11-16T15:56:00Z"), status: "COMPLETED" };
  assert.equal(schedulerState(priorRun, new Date("2026-11-17T02:09:59Z")), "HEALTHY");
  assert.equal(schedulerState(priorRun, new Date("2026-11-18T02:09:59Z")), "OVERDUE");
  assert.equal(schedulerState(priorRun, new Date("2026-11-17T03:26:00Z")), "OVERDUE");
  assert.equal(plannedRankingTime(now, null), "2026-10-20T02:30:00.000Z");
  assert.equal(plannedRankingTime(now, new Date("2026-11-03T02:30:00Z")), "2026-11-05T00:00:00.000Z");
  const due = new Date("2026-10-20T02:30:00Z");
  assert.equal(plannedRankingTime(now, due, ["2026-10-20"]), "2026-11-05T00:00:00.000Z");
  assert.equal(due.toISOString(), "2026-10-20T02:30:00.000Z", "displaying the next slot cannot move the unfinished worker cursor");
  assert.equal(plannedRankingTime(now, new Date("2026-11-03T02:30:00Z"), ["2026-10-20"]), "2026-11-05T00:00:00.000Z");
  assert.equal(operationStateLabels.WAITING_FOR_DISCOVERY, "等待新词发现完成");
});
test("operational view reads metadata only and distinguishes online ranking from external collectors", async t => {
  process.env.DATABASE_URL = "postgresql://unused.invalid/operations";
  delete process.env.DATAFORSEO_SERP_PAID_ENABLED; delete process.env.DATAFORSEO_DISCOVERY_PAID_ENABLED;
  t.mock.method(globalThis, "fetch", async () => { throw new Error("opening plans must never call a provider"); });
  const status = await loadOperationsStatus(new Date("2026-10-19T08:00:00Z"));
  assert.equal(status.scheduler.state, "UNCONFIRMED");
  assert.equal(status.plans[0].state, "自动付费未启用");
  assert.equal(status.plans[0].nextAt, "2026-10-20T02:30:00.000Z");
  const localCollection = status.plans.find(row => row.id === "seo-16-00-ga4-search-console");
  assert.equal(localCollection.cadence, "候选唤醒：每日 09:00、15:00、16:00");
  assert.equal(localCollection.location, "Codex · 本机在线执行");
  assert.ok(!status.plans.some(row => row.id === "10-30-seo"));
  const actualPlan = configuredAutomationPlans(new Date("2026-10-19T08:00:00Z")).find(row => row.id === "automation");
  assert.equal(status.plans.find(row => row.id === "automation").state, actualPlan.state);
  assert.equal(status.plans.find(row => row.id === "automation").nextAt, actualPlan.nextAt);
  assert.equal(status.automationConfigurationVerifiedAt, require("../src/lib/data/seo-automation-config.json").verifiedAt);
  assert.match(status.records[0].name, /第1期/);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  for (const secret of ["encryptedCredentials", "LOGIN_PWD", "CRON_SECRET", "rawResponse", "configJson"]) assert.ok(!JSON.stringify(status).includes(secret));
});
test("actual Codex configuration keeps paused tasks unscheduled and first-weekday rules respect weekends", () => {
  const rules = configuredAutomationPlans(new Date("2026-11-10T00:30:00Z"));
  assert.ok(!rules.some(row => row.id === "10-30-seo"));
  assert.ok(!rules.some(row => row.id === "seo-09-30"));
  assert.equal(rules.find(row => row.id === "seo-09-10-flatkey").nextAt, "2026-11-10T01:15:00.000Z");
  assert.equal(rules.find(row => row.id === "seo-16-25").nextAt, "2026-11-10T01:25:00.000Z");
  assert.equal(rules.find(row => row.id === "seo-14-00").nextAt, "2026-11-11T07:30:00.000Z");
  assert.equal(nextAutomationTime("FREQ=DAILY;BYHOUR=16;BYMINUTE=0", new Date("2026-09-18T09:00Z"), "ACTIVE", true), "2026-09-20T08:00:00.000Z");
  assert.ok(!rules.some(row => row.id === "seo-14-30"));
  const afterFriday = configuredAutomationPlans(new Date("2026-11-20T15:16:00Z"));
  assert.equal(afterFriday.find(row => row.id === "flatkey-5").nextAt, "2026-11-23T02:15:00.000Z");
  assert.equal(rules.find(row => row.id === "seo-10-00-2").nextAt, null);
  assert.equal(rules.find(row => row.id === "seo-3").nextAt, null);
  for (const row of rules.filter(row => row.state === "配置已暂停")) assert.equal(row.nextAt, null);
  assert.equal(nextAutomationTime("FREQ=WEEKLY;BYDAY=FR;BYHOUR=16;BYMINUTE=30", new Date("2026-11-10T08:00:00Z"), "ACTIVE"), "2026-11-13T08:30:00.000Z");
  assert.equal(nextAutomationTime("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1;BYHOUR=15;BYMINUTE=0", new Date("2026-10-31T08:00:00Z"), "ACTIVE"), "2026-11-02T07:00:00.000Z");
  assert.equal(nextAutomationTime("FREQ=DAILY;BYHOUR=18;BYMINUTE=0", new Date(), "PAUSED"), null);
});
test("operations API needs a real session; denied reads never touch the database", async () => {
  calls = 0; session = false;
  assert.equal((await GET(new Request("https://platform.example/api/operations"))).status, 401); assert.equal(calls, 0);
  session = true;
  const response = await GET(new Request("https://platform.example/api/operations"));
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /private, no-store/);
});

test("the rescheduled DataForSEO metadata displays 16:00 while a paused schedule remains unconfigured", async t => {
  const { prisma } = require("../src/lib/prisma.ts");
  const { readonlyAutomationPlans } = require("../src/lib/seo-automation-schedule.ts");
  const config = { paidEnabled: false, authorizationVersion: 0, nextDueAt: new Date("2026-12-03T02:10:00Z"), maxRunCostMicros: 123000, maxMonthCostMicros: 456000 };
  t.mock.method(prisma.serpMonitorConfig, "findUnique", async () => structuredClone(config));
  t.mock.method(globalThis, "fetch", async () => assert.fail("metadata reads must not call the provider"));
  const status = await loadOperationsStatus(new Date("2026-11-20T02:00:00Z"));
  const ranking = readonlyAutomationPlans(status).find(row => row.id === "rankings");
  assert.equal(ranking.cadence, "隔周周四 16:00");
  assert.equal(ranking.nextAt, "2026-12-03T08:00:00.000Z");
  assert.equal(ranking.configurationState, "paused"); assert.equal(ranking.nextConfiguredAt, null);
  assert.equal(status.controls.enabled, false);
  assert.equal(status.controls.maxRunCostMicros, config.maxRunCostMicros); assert.equal(status.controls.maxMonthCostMicros, config.maxMonthCostMicros);
  assert.equal(config.nextDueAt.toISOString(), "2026-12-03T02:10:00.000Z");
});

test("an advanced unfinished round is separate from the next automatic date", async t => {
  const {prisma} = require("../src/lib/prisma.ts");
  const due = new Date("2026-10-20T02:30:00Z");
  t.mock.method(prisma.serpMonitorConfig, "findUnique", async () => ({paidEnabled:true,authorizationVersion:1,nextDueAt:due}));
  t.mock.method(prisma.dataForSeoConnection, "findUnique", async () => ({scheduleEnabled:true}));
  t.mock.method(prisma.dataForSeoRun, "findMany", async input => {
    assert.equal(input.where.siteDomain, "flatkey.ai");
    return ["US","JP","ES","BR"].map(region => ({requestId:`discovery-2026-10-20-flatkey-ai-${region}`,siteDomain:"flatkey.ai",status:"COMPLETED",createdAt:new Date("2026-10-19T07:00Z"),completedAt:new Date("2026-10-19T07:10Z")}));
  });
  const result = await loadOperationsStatus(new Date("2026-10-19T08:00Z"));
  assert.equal(result.plans[0].nextAt, "2026-11-05T00:00:00.000Z");
  assert.match(result.plans[0].currentExecution, /4\/4 国已完成，实际排名待开始/);
  assert.equal(result.controls.discoveryMaxCostMicros, 528000);
  assert.equal(due.toISOString(), "2026-10-20T02:30:00.000Z");
});

test("local collection metadata displays partial coverage and keeps historical GitHub records", async t => {
 const {prisma}=require("../src/lib/prisma.ts"),{collectionReceipt}=require("../scripts/server-seo-receipt.cjs");
 const {record}=collectionReceipt({runId:"123",sha:"a".repeat(40),startedAt:"2026-11-11T08:00:00Z",completedAt:"2026-11-11T08:10:00Z",result:{imported:20,expected:21,missing:0,failures:0,unavailable:1,windows:[]}});
 const local = { ...record, id: "local-seo-collection-test", owner: "Codex · 本机" };
 t.mock.method(prisma.seoWorkflowRecord,"findMany",async()=>[
  {payload:{...local,version:1,updatedAt:local.completedAt,recordedAt:local.completedAt}},
  {payload:{...record,version:1,updatedAt:record.completedAt,recordedAt:record.completedAt}},
  {payload:null}
 ]);
 const status=await loadOperationsStatus(new Date("2026-11-11T09:00:00Z"));
 assert.equal(status.records.find(row=>row.id===local.id).name,"Codex · 五站本机采集");
 assert.equal(status.records.find(row=>row.id===record.id).name,"GitHub Actions · 五站采集");
 assert.match(status.plans.find(row=>row.id==="seo-16-00-ga4-search-console").currentExecution,/部分完成/);
});
