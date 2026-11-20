const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, ".."), load = Module._load;
const body = "**已审完整周报**\n\n业务与搜索表现：注册78人。\n\n<script>not executable</script>";
const report = { id: "seo-digest:2026-11-19:0123456789abcdef", date: "2026-11-19", kind: "weekly", title: "已审完整周报", generatedAt: "2026-11-19T11:00:00Z",
  text: body, detailText: body, reviewedBody: { version: 1, recordOnly: true },
  counts: { originals: 999123, landingPages: 999123, optimizedPages: 999123 }, coverage: {},
  organicRegistrations: { current: 999123 }, registrationCoverageNote: "stale registration coverage", registrationCorrection: true };
let selectedReport = report;
Module._load = function (name, parent, ...rest) {
  if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams("period=weekly&date=2026-11-19"), useRouter: () => ({ push() {} }) };
  if (name === "next/link") return { __esModule: true, default: props => React.createElement("a", { href: props.href }, props.children) };
  if (name === "./useSeoAnalytics") return { numberText: String, shanghaiStamp: String, useSeoRead: () => ({ data: { report: selectedReport, dates: [selectedReport.date] }, retry() {} }) };
  if (name === "./ReportTrafficPanels") return { ReportPageGroupTraffic: () => React.createElement("section", null, "四个页面组流量"), ReportModuleShares: () => React.createElement("section", null, "模块流量占比") };
  if (name === "./UiSelect") return { UiSelect: () => null };
  if (name === "./ReportLoading") return { ReportLoading: () => null };
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  return load.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
for (const ext of [".ts", ".tsx"]) require.extensions[ext] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, file);
const { SeoDigestReports } = require("../src/components/SeoDigestReports.tsx");
test("reviewed snapshots show the exact safe body without stale structured metrics or dynamic correction text", () => {
  const html = renderToStaticMarkup(React.createElement(SeoDigestReports));
  assert.match(html, /已审周报完整正文/); assert.match(html, /注册78人/);
  assert.doesNotMatch(html, /<script|not executable/);
  assert.doesNotMatch(html, /999123|stale registration coverage|事后修订|待审页面版本|SEO 注册人数/);
});


test("a pending weekly review retains the original complete dashboard and its bound current and next plans", () => {
  selectedReport = { ...report, reviewedBody: undefined, draftBody: { pendingReview: true },
    reportPeriod: {start:"2026-11-12",end:"2026-11-18",timezone:"America/Los_Angeles"},
    pagePerformance: [], recentPages: [], rankingNotes: [],
    dashboard: {detailText:"周报\n\n关键词实测\n旧期关键词不应占位",attributionText:"具体上涨页面与来源分析，下降页面按同一周期核对。",sourceEvidenceSha256:"a".repeat(64)},
    currentWorkPlan: {weekStart:"2026-11-16",status:"scheduled",tasks:[]},
    workPlan: {weekStart:"2026-11-23",status:"scheduled",tasks:[]},
    counts: {originals:21,translations:63,backfillTranslations:0,landingPages:0,optimizedPages:9},
    organicRegistrations:{current:81,previous:80}, organicRegistrationCanCompare:true,
  };
  try {
    const html=renderToStaticMarkup(React.createElement(SeoDigestReports));
    for(const title of ["新增博客页面","自然搜索","流量上涨与下跌原因","四个页面组流量","模块流量占比","本周计划进度","下周工作计划","2026-11-16","2026-11-23"]) assert.ok(html.includes(title),title);
    assert.doesNotMatch(html,/旧期关键词不应占位|stale registration coverage|已核实，台账未齐|阶段值，整周覆盖待核验/);
  } finally {selectedReport=report;}
});
