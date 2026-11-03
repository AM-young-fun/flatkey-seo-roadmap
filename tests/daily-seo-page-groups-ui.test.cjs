const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
require.extensions[".tsx"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
let cachedHistory = null;
const originalLoad = Module._load;
Module._load = function (request, parent, main) {
  if (request === "@/lib/client-read-cache") return {
    ClientReadError: class extends Error {},
    clientReadCache: { peek: () => cachedHistory, read: () => assert.fail("static page-group rendering must never fetch data") },
  };
  if (request.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
  return originalLoad.call(this, request, parent, main);
};
const { DailySeoPageGroups } = require(path.resolve(__dirname, "../src/components/DailySeoPageGroups.tsx"));
const collectedAt = "2026-11-01T08:00:00Z";
const source = "https://analytics.google.com/analytics/web/";
function sample() {
  const point = (date, known) => ({
    date, totalUsers: known ? 0 : null, pageViews: known ? 0 : null,
    totalUsersCollectedAt: known ? collectedAt : null, pageViewsCollectedAt: known ? collectedAt : null,
    totalUsersSources: known ? [source] : [], pageViewsSources: known ? [source] : [],
    funnel: known ? { entrants: 0, registrations: 0, collectedAt, sources: [source] } : null,
    collectedAt: known ? collectedAt : null, revisions: known ? 1 : 0, missingReason: known ? null : "当日漏斗尚未核对",
  });
  return {
    kind: "daily-seo-page-groups", ruleVersion: 1, siteDomain: "flatkey.ai", trafficScope: "organic_search", channelName: "Organic Search",
    funnelRule: { closed: true, sameDay: true },
    channelDimension: "firstUserPrimaryChannelGroup", ga4PropertyId: "541304395", timezone: "America/Los_Angeles",
    start: "2026-10-30", end: "2026-10-31", collectedAt, sources: [source],
    groups: ["gpu_compute", "model_list", "model_detail", "prompts"].map(key => ({
      key, name: key, scope: "独立页面组，含各语言版本", pathPattern: `^/${key}/?$`,
      coverage: { days: 2, totalUsersDays: 1, pageViewsDays: 1, funnelDays: 1 },
      points: [point("2026-10-30", true), point("2026-10-31", false)],
    })),
  };
}
const render = history => {
  cachedHistory = history;
  return renderToStaticMarkup(React.createElement(DailySeoPageGroups));
};

test("page-group UI keeps four separate cards and renders real zero distinctly from uncollected daily metrics", () => {
  const html = render(sample());
  for (const name of ["GPU 页面", "模型列表", "模型详情", "提示词库"]) assert.ok(html.includes(`aria-label="${name}每日自然搜索数据"`));
  assert.equal((html.match(/<article /g) ?? []).length, 4);
  assert.equal((html.match(/<td>0<\/td><td>0<\/td><td>0<\/td><td>0<\/td>/g) ?? []).length, 4);
  assert.equal((html.match(/<td>待补采<\/td><td>待补采<\/td><td>待补采<\/td><td>待补采<\/td>/g) ?? []).length, 4);
  for (const text of ["漏斗入口", "访问后当日注册"]) assert.ok(html.includes(text));
  assert.ok(html.includes("America/Los_Angeles"));
  assert.ok(html.includes("firstUserPrimaryChannelGroup"));
  assert.ok(html.includes(source));
  assert.ok(html.includes("同一人可访问多个组"));
  assert.ok(html.includes("组间人数和每日人数均不相加"));
});

test("an old all-channel cached response cannot be shown under the SEO page-group labels", () => {
  const history = sample(); history.trafficScope = "all_users";
  const html = render(history);
  assert.equal((html.match(/<article /g) ?? []).length, 4);
  assert.equal(html.includes("<table>"), false);
  assert.equal(html.includes(source), false);
});

test("cached funnel data with more registrations than entrants is not presented as a valid same-day sequence", () => {
  const history = sample();
  history.groups[0].points[0].funnel = { entrants: 1, registrations: 2, collectedAt, sources: [source] };
  const html = render(history);
  assert.equal(html.includes("<table>"), false);
  assert.equal(html.includes("查看每日数据、来源与采集记录"), false);
});
