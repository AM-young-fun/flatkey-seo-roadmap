const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const lib = require("../src/lib/daily-seo-page-groups.ts");
const { DAILY_SEO_TRAFFIC_DEFAULTS: defaults } = require("../src/lib/daily-seo-traffic.ts");
const source = "https://analytics.google.com/analytics/web/";
const sample = () => ({ kind: "daily-seo-page-groups", requestId: "fictional-page-groups-v1", ...defaults, ruleVersion: 1,
  collectedAt: "2026-11-03T03:00:00Z", sources: [source], groups: [{ key: "model_list", points: [
    { date: "2026-11-01", totalUsers: 0, pageViews: null, funnel: { entrants: 0, registrations: 0, collectedAt: "2026-11-03T02:30:00Z", sources: [source] } },
  ] }] });

test("versioned entry groups use exact main-site routes and the verified GPU price whitelist", () => {
  for (const [key, url] of [
    ["gpu_compute", "/compute"], ["gpu_compute", "/ja/compute/prices/h100?tab=all"], ["gpu_compute", "/en/compute/prices/"],
    ["model_list", "/models?provider=openai"], ["model_list", "/zh/models/"], ["model_detail", "/models/gpt-5"],
    ["prompts", "/prompts"], ["prompts", "/es/prompts/image/cat"], ["prompts", "/prompts/model/test"],
    ["prompts", "/prompts/use-case/art"], ["prompts", "/models/test/prompts/123"],
  ]) assert.equal(lib.matchesDailySeoPageGroupUrl(key, `https://flatkey.ai${url}`), true, `${key} ${url}`);
  for (const [key, url] of [
    ["gpu_compute", "/cloud"], ["gpu_compute", "/gpu"], ["gpu_compute", "/compute/h100"], ["gpu_compute", "/compute/prices/made-up"],
    ["gpu_compute", "/compute/market"], ["model_list", "/models/gpt-5"], ["model_detail", "/models"],
    ["model_detail", "/models/prompts"], ["model_detail", "/models/test/prompts/123"],
    ["prompts", "/models/test"], ["prompts", "/models/test/prompts"], ["prompts", "/prompts/unknown/deep"],
  ]) assert.equal(lib.matchesDailySeoPageGroupUrl(key, `https://flatkey.ai${url}`), false, `${key} ${url}`);
  for (const origin of ["https://console.flatkey.ai", "https://flatkey.ai.evil.example", "http://flatkey.ai", "https://flatkey.ai:8443"]) {
    assert.equal(lib.matchesDailySeoPageGroupUrl("gpu_compute", `${origin}/compute`), false);
  }
  assert.equal(lib.DAILY_SEO_PAGE_GROUP_FUNNEL_RULE.entryFilterScope, "first_step_only");
  assert.deepEqual(lib.DAILY_SEO_PAGE_GROUP_FUNNEL_RULE.entryHostnames, ["flatkey.ai", "www.flatkey.ai"]);
  const detail = lib.DAILY_SEO_PAGE_GROUPS.find(group => group.key === "model_detail");
  for (const url of ["https://flatkey.ai/models/prompts", "https://www.flatkey.ai/en/models/prompts?ref=search"]) {
    const match = new RegExp(detail.pageLocationPattern).test(url) && !new RegExp(detail.excludePageLocationPattern).test(url);
    assert.equal(match, false); assert.equal(match, lib.matchesDailySeoPageGroupUrl("model_detail", url));
  }
  const valid = "https://flatkey.ai/models/gpt-5?ref=search";
  assert.equal(new RegExp(detail.pageLocationPattern).test(valid) && !new RegExp(detail.excludePageLocationPattern).test(valid), true);
});

test("imports distinguish zero, missing visitors and an absent funnel without accepting other cohorts or legacy combined groups", () => {
  assert.equal(lib.dailySeoPageGroupsSchema.safeParse(sample()).success, true);
  for (const patch of [{ trafficScope: "all_users" }, { channelDimension: "firstUserDefaultChannelGroup" }, { channelName: "Paid Search" }, { ruleVersion: 2 }, { timezone: "UTC" }]) {
    assert.equal(lib.dailySeoPageGroupsSchema.safeParse({ ...sample(), ...patch }).success, false);
  }
  const input = sample(); input.groups[0].key = "models";
  assert.equal(lib.dailySeoPageGroupsSchema.safeParse(input).success, false);
  input.groups[0].key = "model_list"; input.groups[0].points[0].funnel = null;
  assert.equal(lib.dailySeoPageGroupsSchema.safeParse(input).success, true);
  for (const patch of [{ entrants: 0, registrations: 1 }, { entrants: null, registrations: 0 }, { entrants: -1, registrations: 0 }, { entrants: 1.5, registrations: 0 }]) {
    input.groups[0].points[0].funnel = { ...sample().groups[0].points[0].funnel, ...patch };
    assert.equal(lib.dailySeoPageGroupsSchema.safeParse(input).success, false);
  }
});

test("each metric's capture must follow its closed LA date and precede the batch timestamp", () => {
  const input = sample(); input.groups[0].points[0].collectedAt = "2026-11-02T07:30:00Z"; // Still 11/01 in LA after DST.
  assert.equal(lib.dailySeoPageGroupsSchema.safeParse(input).success, false);
  delete input.groups[0].points[0].collectedAt;
  input.groups[0].points[0].funnel.collectedAt = "2026-11-03T04:00:00Z";
  assert.equal(lib.dailySeoPageGroupsSchema.safeParse(input).success, false);
  input.groups[0].points[0].funnel.collectedAt = "invalid-date";
  assert.equal(lib.dailySeoPageGroupsSchema.safeParse(input).success, false);
  for (const bad of ["bad-url", "https://secret@analytics.google.com/", "https://analytics.google.com:8443/", "https://search.google.com/"]) {
    assert.equal(lib.dailySeoPageGroupsSchema.safeParse({ ...sample(), sources: [bad] }).success, false);
  }
  const duplicate = sample(); duplicate.groups.push(structuredClone(duplicate.groups[0]));
  assert.equal(lib.dailySeoPageGroupsSchema.safeParse(duplicate).success, false);
  duplicate.groups.pop(); duplicate.groups[0].points.push(structuredClone(duplicate.groups[0].points[0]));
  assert.equal(lib.dailySeoPageGroupsSchema.safeParse(duplicate).success, false);
});

test("four groups always expose thirty closed dates; missing days never become zero or use whole-site counts", () => {
  const query = lib.parseDailySeoPageGroupsQuery(new URLSearchParams(), new Date("2026-11-03T03:00:00Z"));
  const history = lib.buildDailySeoPageGroupsHistory(query, []);
  assert.equal(history.start, "2026-10-03"); assert.equal(history.end, "2026-11-01"); assert.equal(history.groups.length, 4);
  assert.deepEqual(history.groups.map(group => group.key), ["gpu_compute", "model_list", "model_detail", "prompts"]);
  assert.ok(history.groups.every(group => group.points.length === 30 && group.points.every(point => point.totalUsers === null && point.pageViews === null && point.funnel === null)));
  for (const params of ["channelDimension=firstUserDefaultChannelGroup", "ruleVersion=2", "start=2026-11-01&end=2026-11-02"]) {
    assert.throws(() => lib.parseDailySeoPageGroupsQuery(new URLSearchParams(params), new Date("2026-11-03T03:00:00Z")));
  }
});

test("traffic metrics choose actual capture times while closed funnel pairs remain atomic across revisions", () => {
  const query = { ...defaults, ruleVersion: 1, start: "2026-11-01", end: "2026-11-01" };
  const row = (id, trafficTime, totalUsers, pageViews, entrants, registrations, funnelTime, overrides = {}) => ({
    date: "2026-11-01", groupKey: "model_list", totalUsers, pageViews, trafficCollectedAt: trafficTime, trafficSources: [`${source}${id}-traffic`],
    funnelEntrants: entrants, funnelRegistrations: registrations, funnelCollectedAt: funnelTime, funnelSources: [`${source}${id}-funnel`],
    importBatch: { ...defaults, requestId: id, ruleVersion: 1, collectedAt: "2026-11-03T04:00:00Z", importedAt: "2026-11-03T04:10:00Z", ...overrides },
  });
  const rows = [row("old", "2026-11-02T08:00:00Z", 10, 20, 10, 8, "2026-11-02T09:00:00Z"),
    row("fresh", "2026-11-03T01:00:00Z", 0, null, 3, 0, "2026-11-03T01:10:00Z"),
    row("late-old", "2026-11-02T08:30:00Z", 99, 99, null, null, null),
    row("wrong-rule", "2026-11-03T02:00:00Z", 999, 999, 999, 99, "2026-11-03T02:00:00Z", { ruleVersion: 2 }),
    row("partial-pair", "2026-11-03T02:00:00Z", null, null, 1, null, "2026-11-03T02:00:00Z")];
  const history = lib.buildDailySeoPageGroupsHistory(query, rows), point = history.groups[1].points[0];
  assert.equal(point.totalUsers, 0); assert.equal(point.pageViews, 99);
  assert.equal(point.totalUsersCollectedAt, "2026-11-03T01:00:00.000Z");
  assert.equal(point.pageViewsCollectedAt, "2026-11-02T08:30:00.000Z");
  assert.equal(point.funnel.entrants, 3); assert.equal(point.funnel.registrations, 0);
  assert.equal(point.funnel.collectedAt, "2026-11-03T01:10:00.000Z");
  assert.equal(point.revisions, 4);
  assert.ok(history.groups[0].points.every(point => point.totalUsers === null));
});
