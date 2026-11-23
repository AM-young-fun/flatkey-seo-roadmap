const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const React = require("react"), { renderToReadableStream, renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, ".."), load = Module._load;
const body = "**已审完整周报**\n\n业务与搜索表现：注册78人。\n\n<script>not executable</script>";
const report = { id: "seo-digest:2026-11-19:0123456789abcdef", date: "2026-11-19", kind: "weekly", title: "已审完整周报", generatedAt: "2026-11-19T11:00:00Z",
  text: body, detailText: body, reviewedBody: { version: 1, recordOnly: true },
  counts: { originals: 999123, landingPages: 999123, optimizedPages: 999123 }, coverage: {},
  organicRegistrations: { current: 999123 }, registrationCoverageNote: "stale registration coverage", registrationCorrection: true };
let selectedReport = report;
Module._load = function (name, parent, ...rest) {
  // Match Next's App Router compiler alias and exercise its real lazy/Suspense
  // implementation. Plain Node's next/dynamic defaults to the Pages runtime.
  if (name === "next/dynamic") return load.call(this, "next/dist/shared/lib/app-dynamic.js", parent, ...rest);
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
async function renderReport() {
  const stream = await renderToReadableStream(React.createElement(SeoDigestReports));
  await stream.allReady;
  return new Response(stream).text();
}
test("available reviewed snapshots render their exact safe body immediately without a second loading boundary", () => {
  const html = renderToStaticMarkup(React.createElement(SeoDigestReports));
  assert.match(html, /已审周报完整正文/); assert.match(html, /注册78人/);
  assert.doesNotMatch(html, /正在读取报告正文/);
  assert.doesNotMatch(html, /<script|not executable/);
  assert.doesNotMatch(html, /999123|stale registration coverage|事后修订|待审页面版本|SEO 注册人数/);
});


test("a pending weekly review preserves other modules with concise plans and the monthly optimization entry", async () => {
  const nextTask = {id:"next-blog",weekStart:"2026-11-23",siteDomain:"flatkey.ai",scheduled:true,kind:"blog",title:"知识蒸馏成本比较",keyword:"知識蒸留",country:"JP",language:"ja",status:"ready",dueAt:"2026-11-23T02:00:00Z",pageUrl:null,action:"先读 /Users/private/research.md，然后执行完整内部制作说明"};
  const optimized = (id, before, latest) => ({url:"https://flatkey.ai/blog/"+id,title:id,day:"2026-11-10",change:"optimization",cohort:"previous",
    before:{date:"2026-11-09",property:"sc-domain:flatkey.ai",clicks:before,impressions:100},
    latest:{date:"2026-11-17",property:"sc-domain:flatkey.ai",clicks:latest,impressions:200},beforeVisits:null,latestVisits:null});
  selectedReport = { ...report, reviewedBody: undefined, draftBody: { pendingReview: true },
    reportPeriod: {start:"2026-11-12",end:"2026-11-18",timezone:"America/Los_Angeles"},
    pagePerformance: [], recentPages: [optimized("Small gain",1,2),optimized("Large gain",10,30)], rankingNotes: [],
    githubSection:["GitHub 提示词渠道","• [Prompt repo](https://github.com/example/prompts)","  Stars 1；Forks 0"],
    businessSection:["GA4 行为与转化","• 自然搜索归因：2026-11-12—2026-11-18","  注册成功：80 → 81"],
    dashboard: {detailText:"周报\n\n关键词实测\n旧期关键词不应占位\n\n数据与执行情况\n旧工作记录不应重现",attributionText:"具体上涨页面与来源分析，下降页面按同一周期核对。",technicalText:"技术检查：本批99项检查完成。覆盖范围尚不包含完整孤立页。",sourceEvidenceSha256:"a".repeat(64)},
    currentWorkPlan: {weekStart:"2026-11-16",status:"scheduled",tasks:[]},
    workPlan: {weekStart:"2026-11-23",status:"scheduled",tasks:[nextTask]},
    counts: {originals:21,translations:63,backfillTranslations:0,landingPages:0,optimizedPages:9},
    organicRegistrations:{current:81,previous:80}, organicRegistrationCanCompare:true,
  };
  try {
    const html=await renderReport();
    for(const title of ["新增博客页面","新增落地页","已上线优化","待审页面版本","SEO 注册人数","自然搜索","流量上涨与下跌原因","模块流量占比","GitHub 提示词渠道","GA4 行为与转化","SEO 技术质检","暂无问题","本周计划进度","下周工作计划","下周优先关注","2026-11-16","2026-11-23","知识蒸馏成本比较","JP / ja","待领取","近一个月优化效果","查看全部优化效果"]) assert.ok(html.includes(title),title);
    assert.match(html,/href="\/optimization-effects"/);
    assert.match(html,/href="https:\/\/flatkey-seo-roadmap\.vercel\.app\/work\/next-blog\?week=2026-11-23"/);
    assert.ok(html.indexOf("Large gain") < html.indexOf("Small gain"));
    assert.doesNotMatch(html,/四个页面组流量|四页面组流量|工作记录与排名明细|旧工作记录不应重现|旧期关键词不应占位|\/Users\/|research\.md|完整内部制作说明|stale registration coverage|已核实，台账未齐|阶段值，整周覆盖待核验/);
  } finally {selectedReport=report;}
});
