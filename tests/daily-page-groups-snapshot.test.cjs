const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), priorLoad = Module._load, React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
let cacheReads = 0;
Module._load = function(name, parent, ...rest) {
  if (name === "react") return { ...React, useState: value => [typeof value === "function" ? value() : value, () => {}], useRef: () => ({ current: null }), useEffect: effect => { effect(); } };
  if (name === "@/lib/client-read-cache") return { clientReadCache: { peek() { cacheReads++; throw Error("snapshot_cache_read"); }, read() { cacheReads++; throw Error("snapshot_network_read"); } } };
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, key) => String(key) });
  return priorLoad.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
for (const ext of [".ts", ".tsx"]) require.extensions[ext] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
const { DailySeoPageGroups, pageGroupReadUrl, slicePageGroupSnapshot } = require("../src/components/DailySeoPageGroups.tsx");
const point = (date, totalUsers) => ({ date, totalUsers, pageViews: totalUsers + 1, totalUsersCollectedAt: "2026-11-19T12:00:00Z", pageViewsCollectedAt: "2026-11-19T12:00:00Z", totalUsersSources: [], pageViewsSources: [], funnel: null, collectedAt: "2026-11-19T12:00:00Z", revisions: 1, missingReason: null });
const snapshot = { kind: "daily-seo-page-groups", siteDomain: "flatkey.ai", timezone: "America/Los_Angeles", ga4PropertyId: "541304395", trafficScope: "organic_search", channelName: "Organic Search", channelDimension: "firstUserPrimaryChannelGroup", ruleVersion: 1, funnelRule: { closed: true, sameDay: true }, start: "2026-11-11", end: "2026-11-19", groups: ["gpu_compute", "model_list", "model_detail", "prompts"].map(key => ({ key, name: key, scope: "保存的范围", points: [point("2026-11-11", 77777), point("2026-11-18", 12345), point("2026-11-19", 99999)], coverage: { days: 9, totalUsersDays: 3, pageViewsDays: 3, funnelDays: 0 } })) };

test("frozen page-group values render without cache, provider requests or polling and clip to report dates", () => {
  const before = JSON.stringify(snapshot);
  assert.equal(pageGroupReadUrl("2026-11-12", "2026-11-18", snapshot), null);
  assert.match(pageGroupReadUrl("2026-11-12", "2026-11-18"), /start=2026-11-12&end=2026-11-18/);
  const sliced = slicePageGroupSnapshot(snapshot, "2026-11-12", "2026-11-18");
  assert.deepEqual(sliced.groups[0].points.map(p => p.date), ["2026-11-18"]);
  assert.equal(sliced.groups[0].coverage.days, 7);
  const html = renderToStaticMarkup(React.createElement(DailySeoPageGroups, { start: "2026-11-12", end: "2026-11-18", snapshot }));
  assert.match(html, /12,345/); assert.doesNotMatch(html, /77,777|99,999/);
  assert.equal(cacheReads, 0); assert.equal(JSON.stringify(snapshot), before);
});
