const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), originalLoad = Module._load;
Module._load = function (name, parent, ...rest) {
  if (name === "./useSeoAnalytics") return { numberText: value => String(value), shanghaiStamp: String, useSeoRead() { throw Error("unexpected_read"); } };
  if (name === "next/navigation") return {};
  if (name === "./UiSelect" || name === "./ReportLoading") return {};
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  return originalLoad.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const { SearchTraffic, ReportWorkPlan } = require("../src/components/SeoDigestReports.tsx");
const { parseReportComparisons } = require("../src/lib/seo-report-comparisons.ts");
const dates = Array.from({ length: 7 }, (_, index) => `2026-11-${12 + index}`);
function render({ completeWeekRequired = true, full = false, registrationComparable = false, delta } = {}) {
  const annotation = delta ?? (full ? "+100.0%" : "阶段值，不计算周环比");
  const groups = parseReportComparisons([`• flatkey.ai：自然会话 50→100（${annotation}；2026-11-05—11 → 2026-11-12—18；同星期 ${full ? 7 : 6}/7 天）`]);
  const rankings = [{ source: "GA4", flatkey: { periodDays: 7, comparisonDates: full ? dates : dates.slice(0, 6), modules: [{ id: "home", current: 20, previous: 10 }] } }];
  return renderToStaticMarkup(React.createElement(SearchTraffic, {
    groups, countries: null, rankings, completeWeekRequired,
    organicRegistrations: { current: 3, previous: 2 },
    organicRegistrationCanCompare: registrationComparable,
    registrationCoverageNote: "SEO 注册覆盖 2026-11-12—2026-11-17（America/Los_Angeles）",
  }));
}

test("partial Los Angeles weeks display values and source coverage without recomputing percentage changes", () => {
  const html = render();
  assert.match(html, /<strong>100<\/strong>/);
  assert.match(html, /<strong>20<\/strong>/);
  assert.match(html, /<strong>3<\/strong>/);
  assert.match(html, /同星期已核对 6\/7 天/);
  assert.match(html, /SEO 注册覆盖 2026-11-12—2026-11-17/);
  assert.doesNotMatch(html, /100\.0%|50\.0%|data-tone=/);
});

test("complete weeks honor the backend total delta and verified module and registration coverage", () => {
  const html = render({ full: true, registrationComparable: true, delta: "+7.2%" });
  assert.match(html, /\+7\.2%/);
  assert.match(html, /\+100\.0%/);
  assert.match(html, /\+50\.0%/);
});

test("a missing registration comparison flag stays uncomparable for new weekly reports", () => {
  const html = render({ full: true });
  assert.match(html, /\+100\.0%/);
  assert.doesNotMatch(html, /\+50\.0%/);
  assert.match(html, /SEO 注册覆盖/);
});

test("historical reports retain their original comparison rendering", () => {
  const html = render({ completeWeekRequired: false });
  assert.match(html, /\+100\.0%/);
  assert.match(html, /\+50\.0%/);
});

test("refresh stays in original work progress and is excluded from the ordinary optimization group", () => {
  const task = { id: "refresh-original", weekStart: "2026-11-23", siteDomain: "modelfit.cc", kind: "optimization", workClass: "content_refresh", title: "原文翻新任务", pageUrl: "https://modelfit.cc/blog/gguf", country: "US", language: "en", keyword: "gguf", dueAt: "2026-11-24T14:00:00+08:00", status: "verified", scheduled: true, action: "原任务观察" };
  const html = renderToStaticMarkup(React.createElement(ReportWorkPlan, { weekly: false, day: "2026-11-24", plan: { weekStart: "2026-11-23", status: "scheduled", targets: { optimizedPages: 10, contentRefreshPages: 10 }, tasks: [task] } }));
  assert.match(html, /当日工作进度/); assert.match(html, /内容刷新/); assert.match(html, /已验收 1 \/ 1/);
  assert.equal((html.match(/原文翻新任务/g) ?? []).length, 1);
  assert.match(html, /rangeStart=2026-11-24/); assert.doesNotMatch(html, /rangeStart=2026-11-23/);
});
