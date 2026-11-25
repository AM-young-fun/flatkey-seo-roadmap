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
let selectedKind = "weekly";
let archivePage = 1, selectedId, quarterSnapshot, archiveHasNext = false;
Module._load = function (name, parent, ...rest) {
  // Match Next's App Router compiler alias and exercise its real lazy/Suspense
  // implementation. Plain Node's next/dynamic defaults to the Pages runtime.
  if (name === "next/dynamic") return load.call(this, "next/dist/shared/lib/app-dynamic.js", parent, ...rest);
  if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams({period:selectedKind,date:"2026-11-19",archivePage:String(archivePage),...(selectedId ? {reportId:selectedId} : {})}) };
  if (name === "next/link") return { __esModule: true, useLinkStatus: () => ({ pending: false }), default: props => React.createElement("a", { href: props.href }, props.children) };
  if (name === "./useSeoAnalytics") return { numberText: String, shanghaiStamp: String, useSeoRead: url => ({ data: url.includes("/growth/strategy")
    ? {snapshot:quarterSnapshot} : {report:selectedReport,dates:[selectedReport.date],archiveHasNext}, retry() {} }) };
  if (name === "./ReportTrafficPanels") return { ReportPageGroupTraffic: () => React.createElement("section", null, "四个页面组流量"), ReportModuleShares: () => React.createElement("section", null, "模块流量") };
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

test("archive navigation stays in a compact date disclosure next to refresh and keeps exact snapshot routing", () => {
  archivePage=2; selectedId=report.id; archiveHasNext=true;
  try {
    const html=renderToStaticMarkup(React.createElement(SeoDigestReports));
    const header=html.match(/<header[\s\S]*?<\/header>/)[0];
    assert.match(header,/<details[^>]*>[\s\S]*?报告周次[\s\S]*?报告归档分页[\s\S]*?archivePage=3[\s\S]*?reportId=seo-digest%3A2026-11-19%3A0123456789abcdef[\s\S]*?下一页[\s\S]*?<\/details>[\s\S]*?刷新/);
    assert.match(html,/查看最新详情/);
    assert.doesNotMatch(html,/报告筛选|生成于|业务日期|来源看板待归档/);
  } finally {archivePage=1;selectedId=undefined;archiveHasNext=false;}
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
    dashboard: {detailText:"周报\n\n关键词实测\n旧期关键词不应占位\n\n数据与执行情况\n旧工作记录不应重现",attributionText:"本周主要贡献：\n\n- **上涨文章**：[Gemini](https://flatkey.ai/zh/blog/gemini-api-pricing)点击25→85（+60）。\n- **下降文章**：[Free LLM](https://flatkey.ai/blog/free-llm-apis-2026)点击146→62（−84）；[vLLM](https://flatkey.ai/blog/vllm-expert-parallel-deployment)点击31→2。",technicalText:"技术检查：本批99项检查完成。覆盖范围尚不包含完整孤立页。",sourceEvidenceSha256:"a".repeat(64)},
    currentWorkPlan: {weekStart:"2026-11-16",status:"scheduled",tasks:[]},
    workPlan: {weekStart:"2026-11-23",status:"scheduled",tasks:[nextTask]},
    counts: {originals:21,translations:63,backfillTranslations:0,landingPages:0,optimizedPages:9},
    organicRegistrations:{current:81,previous:80}, organicRegistrationCanCompare:true,
  };
  try {
    const html=await renderReport();
    for(const title of ["2026 收官季","新增博客页面","新增落地页","已上线优化","待审页面版本","SEO 注册人数","自然搜索","流量上涨与下跌原因","SEO 技术质检","暂无问题","本周计划进度","下周工作计划","已排任务","博客关键词 1","2026-11-16","2026-11-23","近一个月优化效果","查看全部优化效果"]) assert.ok(html.includes(title),title);
    assert.match(html,/<dl[^>]+aria-label="本周进度与下周计划"/);
    assert.match(html,/<h4>上涨文章<\/h4>[\s\S]*?gemini-api-pricing[\s\S]*?点击25→85/);
    assert.match(html,/<h4>下降文章<\/h4>[\s\S]*?free-llm-apis-2026[\s\S]*?146→62[\s\S]*?<li><a[^>]+vllm-expert-parallel-deployment/);
    assert.doesNotMatch(html,/GitHub 提示词渠道|https:\/\/github.com\/example\/prompts/);
    assert.match(html,/href="\/optimization-effects"/);
    assert.match(html,/href="\/work\?range=custom[^"]*rangeStart=2026-11-23/);
    assert.ok(html.indexOf("Large gain") < html.indexOf("Small gain"));
    assert.doesNotMatch(html,/模块流量|下周优先关注|知识蒸馏成本比较|四个页面组流量|四页面组流量|工作记录与排名明细|旧工作记录不应重现|旧期关键词不应占位|\/Users\/|research\.md|完整内部制作说明|stale registration coverage|已核实，台账未齐|阶段值，整周覆盖待核验/);
  } finally {selectedReport=report;}
});

test("older weekly dashboard clearly dates current quarter metrics when the archived report lacks a quarter snapshot", () => {
  const {unavailableGrowthReportSnapshot}=require('../src/lib/growth-strategy.ts');
  const snapshot=unavailableGrowthReportSnapshot({start:'2026-11-12',end:'2026-11-18'},new Date('2026-11-25T01:00:00Z'));
  Object.assign(snapshot.goals,{trafficScope:{label:'Flatkey'},trafficPeriod:{start:'2026-11-17',end:'2026-11-23'},weeklySessions:1558,trafficComplete:true,trafficGap:1442,latestRankAt:'2026-11-23T02:00:00Z',baselineCount:1600,coverage:null,rankedCount:null});
  snapshot.directions=[{id:'future',title:'当前方向不混入历史周报',drivers:[],taskIds:[]}];
  quarterSnapshot=snapshot;
  selectedReport={...report,reviewedBody:undefined,dashboard:{detailText:"周报"},pagePerformance:[],recentPages:[]};
  try {
    const html=renderToStaticMarkup(React.createElement(SeoDigestReports));
    assert.match(html,/2026 收官季[\s\S]*?当前季度 · 流量截至 2026-11-23 · 排名截至 2026-11-22/);
    assert.match(html,/1,558/);
    assert.match(html,/排名待齐/);
    assert.doesNotMatch(html,/当前方向不混入历史周报|<strong>0\.0%/);
  } finally {selectedReport=report;quarterSnapshot=undefined;}
});

test("daily report presents only its day in progress and optimization metrics",async()=>{
 selectedKind="daily";
 const task=(title,day)=>({id:title,kind:"blog",title,siteDomain:"flatkey.ai",scheduled:true,status:"ready",dueAt:day+"T10:00:00+08:00",country:"US",language:"en",pageUrl:null,action:""});
 selectedReport={...report,kind:"daily",reviewedBody:undefined,reportPeriod:{start:"2026-11-18",end:"2026-11-18",timezone:"America/Los_Angeles"},counts:{originals:0,landingPages:0,optimizedPages:0},recentPages:[],pagePerformance:[],dashboard:{detailText:"SEO 技术质检\n\n暂无问题"},workPlan:{weekStart:"2026-11-16",periodStart:"2026-11-13",periodEnd:"2026-11-19",status:"scheduled",tasks:[task("当天任务","2026-11-18"),task("其他日期任务","2026-11-17")]}};
 try {const html=await renderReport();assert.match(html,/当日优化效果|当日任务/);assert.match(html,/博客关键词 0 \/ 1/);assert.match(html,/rangeStart=2026-11-18/);assert.doesNotMatch(html,/当天任务|其他日期任务|明日优先关注|当日工作进度|近一个月优化效果|GA4 行为与转化|四个页面组流量|模块流量占比/);}finally{selectedKind="weekly";selectedReport=report;}
});
