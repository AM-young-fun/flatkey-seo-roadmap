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

let queryRows, queries;
const db = { $queryRaw: async query => { queries.push(query); return queryRows; } };
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const { selectRecentWeeklyReportPeriod, loadRecentRankingReportPeriod } = require("../src/lib/services/ranking-report-period.ts");
const { rankingReportingPeriod } = require("../src/lib/ranking-evidence.ts");

const now = new Date("2026-10-16T03:00:00Z");
const row = (start = "2026-10-08", end = "2026-10-14", overrides = {}) => ({ siteDomain: "flatkey.ai", text: "model api integration",
  periodStart: start == null ? null : new Date(`${start}T00:00:00Z`), periodEnd: end == null ? null : new Date(`${end}T00:00:00Z`), ...overrides });
const bounds = period => ({ start: period.start, end: period.end });

beforeEach(() => { queryRows = []; queries = []; });

test("October 16 uses the actual imported October 8–14 query week instead of manufacturing October 9–15 evidence", () => {
  const original = [row()];
  const before = structuredClone(original);
  const selected = selectRecentWeeklyReportPeriod(original, now);
  assert.deepEqual(bounds(selected), { start: "2026-10-08", end: "2026-10-14" });
  assert.match(selected.label, /最近已导入\s*7天/);
  assert.deepEqual(original, before);
  assert.deepEqual(bounds(rankingReportingPeriod(now)), { start: "2026-10-09", end: "2026-10-15" });
});

test("latest valid report end wins globally and result does not depend on input order or duplicate rows", () => {
  const rows = [row("2026-10-07", "2026-10-13"), row(), row("2026-10-09", "2026-10-15", { siteDomain: "modelfit.cc", text: "model gpu requirements" }), row()];
  const selected = selectRecentWeeklyReportPeriod(rows, now);
  assert.deepEqual(bounds(selected), { start: "2026-10-09", end: "2026-10-15" });
  assert.deepEqual(selectRecentWeeklyReportPeriod([...rows].reverse(), now), selected);
});

test("daily, 28-day, 6-day, 8-day, null and reversed reports cannot masquerade as complete seven-day reports", () => {
  for (const invalid of [
    row("2026-10-14", "2026-10-14"), row("2026-09-17", "2026-10-14"),
    row("2026-10-09", "2026-10-14"), row("2026-10-07", "2026-10-14"),
    row(null, "2026-10-14"), row("2026-10-08", null), row(null, null), row("2026-10-15", "2026-10-09"),
  ]) assert.deepEqual(selectRecentWeeklyReportPeriod([invalid], now), rankingReportingPeriod(now));
});

test("only recent completed report end dates are eligible, including the lower-bound end date", () => {
  assert.deepEqual(bounds(selectRecentWeeklyReportPeriod([row("2026-10-03", "2026-10-09")], now)), { start: "2026-10-03", end: "2026-10-09" });
  for (const invalid of [row("2026-10-02", "2026-10-08"), row("2026-10-10", "2026-10-16"), row("2026-10-11", "2026-10-17")]) {
    assert.deepEqual(selectRecentWeeklyReportPeriod([invalid], now), rankingReportingPeriod(now));
  }
});

test("unrelated query noise and unknown sites cannot move the global reporting window", () => {
  const noise = [row("2026-10-09", "2026-10-15", { text: "yes" }),
    row("2026-10-09", "2026-10-15", { text: "$20" }),
    row("2026-10-09", "2026-10-15", { siteDomain: "rackrate.org", text: '"compare the market"' }),
    row("2026-10-09", "2026-10-15", { siteDomain: "foreign.example", text: "model api" })];
  assert.deepEqual(selectRecentWeeklyReportPeriod(noise, now), rankingReportingPeriod(now));
  assert.deepEqual(bounds(selectRecentWeeklyReportPeriod([row(), ...noise], now)), { start: "2026-10-08", end: "2026-10-14" });
});

test("each supported business site and new model terms may supply the shared imported week", () => {
  for (const [siteDomain, text] of [["flatkey.ai", "new frontier model api"], ["rackrate.org", "gpu cloud cost"], ["modelfit.cc", "model gpu requirements"]]) {
    assert.deepEqual(bounds(selectRecentWeeklyReportPeriod([row(undefined, undefined, { siteDomain, text })], now)), { start: "2026-10-08", end: "2026-10-14" });
  }
});

test("no valid imported query week returns the unchanged calendar period and label", () => {
  assert.deepEqual(selectRecentWeeklyReportPeriod([], now), rankingReportingPeriod(now));
  assert.deepEqual(selectRecentWeeklyReportPeriod([row("2026-09-01", "2026-09-07"), row(null, null)], now), rankingReportingPeriod(now));
});

test("eligibility uses completed Shanghai days at the UTC 16:00 midnight boundary", () => {
  const beforeMidnight = new Date("2026-10-15T15:59:59Z");
  const afterMidnight = new Date("2026-10-15T16:00:00Z");
  const imported = [row("2026-10-09", "2026-10-15")];
  assert.deepEqual(selectRecentWeeklyReportPeriod(imported, beforeMidnight), rankingReportingPeriod(beforeMidnight));
  assert.deepEqual(bounds(selectRecentWeeklyReportPeriod(imported, afterMidnight)), { start: "2026-10-09", end: "2026-10-15" });
  assert.deepEqual(bounds(selectRecentWeeklyReportPeriod([], beforeMidnight)), { start: "2026-10-08", end: "2026-10-14" });
  assert.deepEqual(bounds(selectRecentWeeklyReportPeriod([], afterMidnight)), { start: "2026-10-09", end: "2026-10-15" });
});

test("loader selects one shared three-site query-report window using scoped active formal business inventory", async () => {
  queryRows = [row(), row("2026-10-09", "2026-10-15", { siteDomain: "rackrate.org", text: "gpu cloud cost" })];
  const selected = await loadRecentRankingReportPeriod(now);
  assert.deepEqual(bounds(selected), { start: "2026-10-09", end: "2026-10-15" });
  assert.equal(queries.length, 1);
  const query = queries[0], sql = query.sql.replace(/\s+/g, " ");
  assert.match(sql, /ranking-period:recent-query-reports/);
  assert.match(sql, /KeywordObservation/);
  assert.ok(!sql.includes("KeywordPageObservation"));
  assert.match(sql, /source\s*=\s*'gsc'/);
  assert.match(sql, /"rankReported"\s*=\s*true/i);
  assert.match(sql, /"periodEnd"\s*-\s*\w+\."periodStart"\s*=\s*6/);
  assert.match(sql, /\bsk\.active\s*=\s*true/i);
  assert.match(sql, /\bk\.active\s*=\s*true/i);
  assert.match(sql, /\b(?:s|site)\.active\s*=\s*true/i);
  assert.match(sql, /sk\."topicId"\s+IS\s+NOT\s+NULL/i);
  assert.match(sql, /sk\.pool\s*=\s*'FORMAL'/);
  assert.match(sql, /sk\."siteDomain"\s*=\s*o\."siteDomain"/);
  assert.match(sql, /sk\."keywordId"\s*=\s*o\."keywordId"/);
  assert.ok(!/\bregion\s*=|"region"\s*=|GROUP BY[^;]*region/i.test(sql));
  const representedSites = query.values.filter(value => ["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(value));
  for (const site of ["flatkey.ai", "rackrate.org", "modelfit.cc"]) assert.ok(representedSites.includes(site) || sql.includes(`'${site}'`), site);
  assert.ok(!query.values.includes("US") && !query.values.includes("JP"));
  const representedDates = query.values.map(value => value instanceof Date ? value.toISOString().slice(0, 10) : value);
  assert.ok(representedDates.includes("2026-10-09"));
  assert.ok(representedDates.includes("2026-10-15"));
});

test("loader fallback and Shanghai query bounds agree with the pure selector", async () => {
  queryRows = [];
  const beforeMidnight = new Date("2026-10-15T15:59:59Z");
  assert.deepEqual(await loadRecentRankingReportPeriod(beforeMidnight), rankingReportingPeriod(beforeMidnight));
  const dates = queries[0].values.map(value => value instanceof Date ? value.toISOString().slice(0, 10) : value);
  assert.ok(dates.includes("2026-10-08"));
  assert.ok(dates.includes("2026-10-14"));
});
