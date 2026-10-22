const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const mock = (relative, exports) => { const file = path.join(root, relative); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
let rows = [];
mock("src/lib/prisma.ts", { prisma: { weeklyTraffic: { findMany: async () => rows }, weeklyReportDraft: { findUnique: async () => null } } });
mock("src/lib/database-read.ts", { settleReads: promises => Promise.all(promises) });
mock("src/lib/read-profile.ts", { timedRead: (_, read) => read() });
mock("src/lib/services/weekly-serp.ts", { loadWeeklySerp: async () => ({ ranking: { baseline: true }, comparison: null }) });
mock("src/lib/weekly-report-diagnosis.ts", { diagnoseWeeklyReport: async () => ({ significant: false, findings: [] }) });
const { reportPeriods } = require("../src/lib/weekly-traffic.ts");
const { buildWeeklyReport } = require("../src/lib/services/weekly-report.ts");
const pageVisitors = { metric: "totalUsers", eventName: "page_view", ruleVersion: 1, sourceUrl: "https://analytics.google.com/analytics/web/", groups: [{ key: "models", users: { current: 60, previous: null } }, { key: "prompts", users: { current: 20, previous: null } }] };
const current = () => ({ siteDomain: "flatkey.ai", periodStart: new Date("2026-10-20"), periodEnd: new Date("2026-10-26"), collectedAt: new Date("2026-10-27T10:30:00Z"), newUsers: 50, newRegistrations: 5, timezone: "America/Los_Angeles", ga4PropertyId: "541304395", registrationMetric: "sign_up_success_distinct_users", analysis: { complete: true, totals: { current: { newUsers: 50, newRegistrations: 5 }, previous: { newUsers: 40, newRegistrations: 4 } }, channels: [{ name: "Direct", newUsers: { current: 50, previous: 40 }, registrations: { current: 5, previous: 4 } }], sources: ["https://analytics.google.com/analytics/web/"], pageVisitors } });

test("page visitors survive a missing prior full-site import without borrowing the prior week's evidence", async () => {
  rows = [current()];
  const report = await buildWeeklyReport(reportPeriods("2026-10-20"));
  assert.equal(report.evidence, null);
  assert.equal(report.traffic.comparable, false);
  assert.deepEqual(report.pageVisitors, pageVisitors);
  assert.equal((await buildWeeklyReport(reportPeriods("2026-10-27"))).pageVisitors, null);
});

test("page visitor counts are hidden when their parent totals or weekly period do not match", async () => {
  rows = [current()]; rows[0].newUsers = 51;
  assert.equal((await buildWeeklyReport(reportPeriods("2026-10-20"))).pageVisitors, null);
  rows = [current()]; rows[0].periodEnd = new Date("2026-10-25");
  assert.equal((await buildWeeklyReport(reportPeriods("2026-10-20"))).pageVisitors, null);
});
