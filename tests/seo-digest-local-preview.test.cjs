const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { spawnSync } = require("node:child_process");

function preview(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-local-preview-"));
  try {
    fs.mkdirSync(path.join(dir, "analytics"));
    fs.writeFileSync(path.join(dir, "workflow.json"), JSON.stringify({ tasks: [], approvals: [], publications: [], historicalImports: [], optimizations: [], issues: [], generatedAt: "2026-11-10T01:00:00Z" }));
    for (const date of ["2026-11-08", "2026-11-09"]) fs.writeFileSync(path.join(dir, "analytics", date + ".json"), JSON.stringify({
      kind: "ga4-site", property: "541304395", source: "google-api", scope: "session-organic-search", hostScope: "production-hosts-v1",
      date, observedAt: "2026-11-10T01:00:00Z", sessions: 123456, registrations: 0, complete: true, ...extra,
    }));
    const child = spawnSync(process.execPath, ["scripts/seo-digest-preview.cjs", "--date=2026-11-10", "--kind=daily", "--analytics-dir=" + path.join(dir, "analytics"), "--workflow=" + path.join(dir, "workflow.json"), "--out=" + path.join(dir, "out")], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(fs.readFileSync(path.join(dir, "out", "2026-11-10.daily.json"), "utf8")).report.detailText;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("local archived preview masks legacy synthetic registration zero without dropping scoped sessions", () => {
  const text = preview({});
  assert.match(text, /可归属注册 待更新/); assert.doesNotMatch(text, /可归属注册 0→0/);
  assert.match(text, /123456→123456/);
});
test("local archived preview retains an explicitly reported registration zero and browser-export zero", () => {
  assert.match(preview({ registrationEvidence: "reported_daily_row" }), /可归属注册 0→0/);
  assert.match(preview({ source: "browser-export" }), /可归属注册 0→0/);
});
test("local archived preview does not present unscoped main-property totals", () => {
  const text = preview({ hostScope: undefined, registrationEvidence: "reported_daily_row" });
  assert.doesNotMatch(text, /123456/); assert.match(text, /可归属注册 待更新/);
});
