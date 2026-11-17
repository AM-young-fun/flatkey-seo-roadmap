#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const platform = "https://flatkey-seo-roadmap.vercel.app";
const source = "https://console.flatkey.ai/api/data/seo_account_registrations";
const shiftDay = (day, offset) => new Date(Date.parse(day + "T00:00:00Z") + offset * 86_400_000).toISOString().slice(0, 10);
const utcDay = /^\d{4}-\d{2}-\d{2}$/;

async function read(url, token) {
  const response = await fetch(url, {
    headers: { authorization: "Bearer " + token },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Error(new URL(url).pathname + " HTTP " + response.status);
  return response.json();
}

function accountCounts(snapshot, end) {
  assert.ok(snapshot && snapshot.version === 1 && snapshot.source === "flatkey-console-usage-report" &&
    snapshot.group === "all" && snapshot.timezone === "UTC", "account_source_scope_mismatch");
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(snapshot.observedAt) &&
    Date.parse(snapshot.observedAt) <= Date.now() + 300_000, "invalid_account_snapshot_time");
  assert.ok(Array.isArray(snapshot.days) && snapshot.days.length > 0 && snapshot.days.length <= 29, "invalid_account_days");
  const earliest = shiftDay(end, -28);
  const counts = new Map();
  for (const { date, registered } of snapshot.days) {
    assert.ok(utcDay.test(date) && shiftDay(date, 0) === date && date >= earliest && date <= end &&
      date < snapshot.observedAt.slice(0, 10) && !counts.has(date), "invalid_or_duplicate_account_day");
    assert.ok(Number.isInteger(registered) && registered >= 0 && registered <= 100_000_000, "invalid_account_count");
    counts.set(date, registered);
  }
  if (!counts.has(end)) throw Error("source_not_final_for_" + end);
  return counts;
}

async function main() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const requestedDate = process.argv.find(value => value.startsWith("--report-date="))?.split("=")[1];
  if (requestedDate && requestedDate !== today) {
    console.log("A historical report uses its archived account data.");
    return;
  }
  const reader = process.env.SEO_ACCOUNT_REGISTRATION_READ_TOKEN?.trim();
  const importer = process.env.SEO_IMPORT_TOKEN?.trim();
  assert.ok(/^[0-9a-f]{64}$/.test(reader ?? "") && importer, "missing_account_source_or_import_credential");

  const end = shiftDay(today, -1);
  if (end >= new Date().toISOString().slice(0, 10)) throw Error("source_not_final_for_" + end);
  const { data: snapshot } = await read(source, reader);
  const counts = accountCounts(snapshot, end);
  const directory = await mkdtemp(join(tmpdir(), "flatkey-account-registrations-"));
  try {
    const file = join(directory, "snapshot.json");
    await writeFile(file, JSON.stringify(snapshot), { mode: 0o600 });
    const imported = spawnSync(process.execPath, [join(__dirname, "import-flatkey-account-registrations.cjs"), file], {
      env: { ...process.env, SEO_ACCOUNT_REGISTRATION_READ_TOKEN: "", SEO_IMPORT_TOKEN: importer, SEO_PLATFORM_ORIGIN: platform },
      encoding: "utf8", timeout: 100_000,
    });
    if (imported.error || imported.status !== 0) throw Error(imported.stderr?.trim() || "account_registration_import_failed");
    const receipt = JSON.parse(imported.stdout);
    const friday = shiftDay(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 2) % 7));
    const windows = [
      { kind: "daily", date: today, start: end, end },
      { kind: "weekly", date: friday, start: shiftDay(friday, -7), end: shiftDay(friday, -1) },
    ];
    const reports = await Promise.all(windows.map(async (window) => {
      let users = 0;
      for (let day = window.start; day <= window.end; day = shiftDay(day, 1)) {
        assert.ok(counts.has(day), "source_week_missing_" + day);
        users += counts.get(day);
      }
      const url = platform + "/api/seo/digest?" + new URLSearchParams({ kind: window.kind, date: window.date });
      const { report } = await read(url, importer);
      assert.equal(report.kind, window.kind);
      assert.equal(report.date, window.date);
      assert.deepEqual(report.accountRegistrations, { start: window.start, end: window.end, users, missing: [], timezone: "UTC" }, window.kind + "_account_registration_mismatch");
      return { ...window, users, reportId: report.id };
    }));
    console.log(JSON.stringify({ sourceThrough: end, receipt, reports }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { accountCounts };
