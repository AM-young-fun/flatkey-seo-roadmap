const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { CLUSTER_SITES, clusterDomainForProperty, rougeCueSourceReadiness, siteSourceReadiness } = require("../src/lib/seo-cluster-sites.ts");
const { analyticsObservationSchema, analyticsStorageKind } = require("../src/lib/seo-analytics.ts");
const { GROWTH_SITES } = require("../src/lib/growth-workspace.ts");

test("verified RougeCue property maps to its own source with LA timezone and unchanged existing zones", () => {
  const source = CLUSTER_SITES.find(site => site.domain === "rougecue.org");
  assert.equal(source.ga4, "565596386"); assert.equal(source.ga4TimeZone, "America/Los_Angeles"); assert.equal(source.gsc, "sc-domain:rougecue.org");
  assert.equal(clusterDomainForProperty(source.ga4), "rougecue.org");
  assert.equal(clusterDomainForProperty(source.gsc), "rougecue.org");
  assert.equal(analyticsStorageKind("ga4-site", "all", clusterDomainForProperty(source.ga4)), "ga4-site:rougecue.org");
  for (const domain of ["rackrate.org", "modelfit.cc"]) assert.equal(CLUSTER_SITES.find(site => site.domain === domain).ga4TimeZone, "Asia/Shanghai");
  const role = GROWTH_SITES.find(site => site.domain === "rougecue.org");
  assert.equal(role.dataOnly, true); assert.equal(role.execution, false); assert.equal(role.keywordGoals, false); assert.equal(role.trafficGoal, false);
  assert.deepEqual(GROWTH_SITES.filter(site => site.trafficGoal).map(site => site.domain), ["flatkey.ai"]);
  assert.equal(source.googleCollectionDeferred, false, "Latest user authorization allows normal read-only access without restoring schedules or adding a Flatkey goal dependency");
});

test("RougeCue observations preserve unknown registrations, accept only registered GSC and reject another site's page hosts", () => {
  const base = { date: "2026-11-22", observedAt: "2026-11-23T10:00:00Z", source: "google-api", property: "565596386", scope: "session-organic-search", complete: false };
  const row = analyticsObservationSchema.parse({ ...base, kind: "ga4-site", sessions: 5, registrations: null });
  assert.equal(row.registrations, null);
  assert.equal(analyticsObservationSchema.safeParse({ ...base, kind: "ga4-site", sessions: null, registrations: null }).success, false);
  const { scope: _scope, ...common } = base;
  const search = { ...common, kind: "gsc-site", property: "sc-domain:rougecue.org", clicks: 1, impressions: 12, position: 5 };
  assert.equal(analyticsObservationSchema.safeParse(search).success, true);
  assert.equal(analyticsObservationSchema.safeParse({ ...search, property: "sc-domain:console.rougecue.org" }).success, false);
  assert.equal(analyticsStorageKind("gsc-site", "all", clusterDomainForProperty(search.property)), "gsc-site:rougecue.org");
  const page = { ...base, kind: "ga4-pages", sessionsComplete: true, hostnameDimension: "hostName", rows: [{ hostname: "rougecue.org", path: "/", sessions: 5, registrations: null }] };
  assert.equal(analyticsObservationSchema.safeParse(page).success, true);
  page.rows[0].hostname = "www.rougecue.org"; assert.equal(analyticsObservationSchema.safeParse(page).success, true);
  page.rows[0].hostname = "console.rougecue.org"; assert.equal(analyticsObservationSchema.safeParse(page).success, false);
  page.rows[0].hostname = "flatkey.ai"; assert.equal(analyticsObservationSchema.safeParse(page).success, false);
});

test("visible Google setup does not masquerade as persistent configuration, API permission or archived data", () => {
  const missing = rougeCueSourceReadiness(null), mismatch = rougeCueSourceReadiness("123"), matched = rougeCueSourceReadiness("565596386");
  assert.equal(missing.ga4Configured, true); assert.equal(missing.collectorGa4Configured, true); assert.equal(missing.persistentGa4Configured, false); assert.equal(missing.persistedPropertyMatches, null); assert.match(missing.reason, /尚未持久登记/);
  assert.equal(mismatch.persistedPropertyMatches, false); assert.match(mismatch.reason, /不符/);
  assert.equal(matched.ga4Configured, true); assert.equal(matched.sourceTimezone, "America/Los_Angeles"); assert.equal(matched.apiPermissionVerified, false);
  assert.equal(matched.gscProperty, "sc-domain:rougecue.org");
  assert.match(matched.reason, /读取权限、注册事件及实际数据覆盖仍待核实/);
  for (const site of ["jev-llm.com", "mochichatbot.com"]) {
    const known = siteSourceReadiness(site, null);
    assert.equal(known.ga4Configured, true); assert.equal(known.persistentGa4Configured, false); assert.equal(known.configurationSource, "collector-registry"); assert.equal(known.metadataVerification, "collector-config-only");
  }
});

test("existing deployment seeds only the verified source and preserves conflicting nonempty properties", () => {
  const sql = fs.readFileSync(require.resolve("../prisma/ranking-import.sql"), "utf8");
  assert.match(sql, /VALUES \('rougecue\.org', 'RougeCue', '565596386'\)/);
  assert.match(sql, /ON CONFLICT \("domain"\) DO UPDATE SET "ga4PropertyId" = EXCLUDED\."ga4PropertyId"\s+WHERE "SeoSite"\."ga4PropertyId" IS NULL/);
});
