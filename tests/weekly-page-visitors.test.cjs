const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { PILLAR_PAGE_GROUPS, weeklyPageVisitorsSchema, pageVisitorRows } = require("../src/lib/weekly-page-visitors.ts");
const { weeklyEvidenceSchema } = require("../src/lib/weekly-evidence-schema.ts");
const sample = () => ({ metric: "totalUsers", eventName: "page_view", ruleVersion: 1, sourceUrl: "https://analytics.google.com/analytics/web/", groups: [
  { key: "models", users: { current: 120, previous: 100 } }, { key: "prompts", users: { current: 40, previous: null } },
] });

test("page scope includes every language, and model prompt details belong only to prompts", () => {
  for (const prefix of ["", "/en", "/zh", "/es", "/fr", "/pt", "/ru", "/ja", "/vi", "/de", "/id"]) {
    for (const [path, expected] of [["/models/gpt-image-2", "models"], ["/prompts", "prompts"], ["/prompts/image/poster", "prompts"], ["/prompts/video", "prompts"], ["/prompts/model/seedance-2", "prompts"], ["/models/gpt-image-2/prompts/poster", "prompts"]]) {
      assert.deepEqual(PILLAR_PAGE_GROUPS.filter(group => new RegExp(group.pathPattern).test(prefix + path)).map(group => group.key), [expected], prefix + path);
    }
  }
  for (const path of ["/models", "/models/", "/models-fake", "/prompts-fake", "/blog/models", "/api/prompts", "/models/a/pricing", "/not-a-locale/models"]) {
    assert.equal(PILLAR_PAGE_GROUPS.some(group => new RegExp(group.pathPattern).test(path)), false, path);
  }
});

test("page visitor evidence accepts missing baselines but rejects wrong metrics, sources and duplicate groups", () => {
  assert.equal(weeklyPageVisitorsSchema.safeParse(sample()).success, true);
  for (const mutate of [value => value.metric = "newUsers", value => value.metric = "screenPageViews", value => value.eventName = "first_visit", value => value.groups.pop(), value => value.groups[1].key = "models", value => value.groups[0].users.current = -1, value => value.groups[0].users.current = 1.2, value => value.sourceUrl = "https://search.google.com/", value => value.ruleVersion = 2]) {
    const value = sample(); mutate(value); assert.equal(weeklyPageVisitorsSchema.safeParse(value).success, false);
  }
});

test("missing visitors stay null, real zero is retained, and incomplete weeks never claim a change", () => {
  assert.ok(pageVisitorRows().every(row => row.current === null && row.previous === null && row.delta === null));
  const value = sample();
  let rows = pageVisitorRows(value, true);
  assert.equal(rows[0].delta, 20); assert.equal(rows[0].rate, 0.2);
  assert.equal(rows[1].previous, null); assert.equal(rows[1].delta, null);
  assert.ok(pageVisitorRows(value, false).every(row => row.delta === null && row.rate === null));
  value.groups[0].users = { current: 0, previous: 100 };
  value.groups[1].users = { current: 40, previous: 0 };
  rows = pageVisitorRows(value, true);
  assert.equal(rows[0].current, 0); assert.equal(rows[0].rate, -1);
  assert.equal(rows[1].newTraffic, true); assert.equal(rows[1].rate, null);
});

test("weekly imports retain pillar visitors without changing new-user totals or breaking historical evidence", () => {
  const evidence = { complete: true, totals: { current: { newUsers: 10, newRegistrations: 2 }, previous: { newUsers: 8, newRegistrations: 1 } }, channels: [{ name: "Direct", newUsers: { current: 10, previous: 8 }, registrations: { current: 2, previous: 1 } }], sources: ["https://analytics.google.com/analytics/web/"] };
  assert.equal(weeklyEvidenceSchema.safeParse(evidence).success, true);
  assert.deepEqual(weeklyEvidenceSchema.parse({ ...evidence, pageVisitors: sample() }).pageVisitors, sample());
});
