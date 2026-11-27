const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), originalLoad = Module._load;
const React = require("react"), { renderToStaticMarkup: render } = require("react-dom/server");
const fixtures = new Map();
const overviewReads = new Map();
const overviewRange = { start: "2026-11-17", end: "2026-11-23" };
let rangeReady = true, automaticRange = true;
let activeRange = overviewRange;
let listQuery = "";
let listRead;
let lastTrafficUrl;
let applyListRange;
let nextWeekClick;
Module._load = function(name, parent, ...rest) {
  if (name === "react/jsx-runtime" && parent?.filename.endsWith("/SeoWorkWorkspace.tsx")) {
    const runtime = originalLoad.call(this, name, parent, ...rest);
    return { ...runtime, jsx(type, props, key) {
      if (type === "button" && props.children === "下周排期") nextWeekClick = props.onClick;
      return runtime.jsx(type, props, key);
    } };
  }
  if (name === "./AppLink" || name === "@/components/AppLink") return { __esModule:true, default:({ children,prefetch,...props }) => React.createElement("a",props,children) };
  if (name === "./PageHeader" || name === "./UiSelect" || name === "./FeedbackButton") return { PageHeader:()=>React.createElement("nav",{ "aria-label":"主导航" }), UiSelect:()=>null, FeedbackButton:()=>null };
  if (name === "./SeoDateControl") return { useSeoRange:()=>({ range:activeRange, comparison:null, ready:rangeReady, isDefault:automaticRange }),
    SeoDateControl:({pending,value})=>React.createElement("button",{"aria-label":"选择时间", "aria-busy":pending||undefined}, value.range.start + " — " + value.range.end),
    useSeoListDateRange:()=>({ preset:new URLSearchParams(listQuery).get("range") ?? "week", range:activeRange, apply:applyListRange }),
    SeoListDateControl:({pending})=>React.createElement("button",{"aria-label":"筛选日期", "aria-busy":pending||undefined}) };
  if (name === "next/navigation") return { useSearchParams:()=>new URLSearchParams(listQuery) };
  if (name === "next/link") return { useLinkStatus:()=>({pending:false}) };
  if (name === "./useFeedbackRouter") return { useFeedbackRouter:()=>({}) };
  if (name === "./useSeoCountry") return { useSeoCountry:()=>["all"] };
  if (name === "./RankingTrend") return { RankingTrend:()=>null };
  if (name === "./useSeoAnalytics") return { useSeoRead:(url,_options) => {
    if (parent?.filename.endsWith("/TrafficRegistrationSummary.tsx") ) lastTrafficUrl=url;
    return { data:fixtures.get(url) ?? null, error:null, loading:false, retry() {}, ...(url?.includes("workList=1") ? listRead : overviewReads.get(url)) };
  }, useOverviewRead:url => ({ data:null, error:null, loading:false, retry() {}, ...overviewReads.get(url) }), numberText:String, shanghaiStamp:String, analyticsUrl:(range,urls,country) => `/api/seo/analytics?start=${range.start}&end=${range.end}${country!=="all"?`&country=${country}`:""}` };
  if (name.endsWith(".module.css")) return new Proxy({}, {get:(_,key)=>key === "__esModule"?false:String(key)});
  return originalLoad.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest);
};
for(const extension of [".ts",".tsx"]) require.extensions[extension]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
const { keywordCircleLayout } = require("../src/components/growth-network-layout.ts");
const { GoalPlot, LinePlot } = require("../src/components/OverviewCharts.tsx");
const { OverviewGoalCharts } = require("../src/components/OverviewGrowthCharts.tsx");
const { summarizeOverviewKeywords } = require("../src/lib/overview-summary.ts");
const { GrowthTopicWorkspace } = require("../src/components/GrowthTopicWorkspace.tsx");
const { SeoOverview } = require("../src/components/SeoOverview.tsx");
const { SeoWorkWorkspace } = require("../src/components/SeoWorkWorkspace.tsx");
const { PageHeader } = require("../src/components/PageHeader.tsx");
const { PreviewModeProvider } = require("../src/components/PreviewMode.tsx");

test("credentials follow schedule in the main menu and logout is an independent sidebar action",()=>{
  const html=render(React.createElement(PageHeader,{active:"credentials",marketControl:false}));
  const nav=html.match(/<nav[^>]+aria-label="主导航"[^>]*>[\s\S]*?<\/nav>/)[0];
  assert.match(nav,/定时任务[\s\S]*?aria-label="工具与设置"[\s\S]*?href="\/credentials"[\s\S]*?接入凭证/);
  assert.doesNotMatch(nav,/退出登录/);
  assert.match(html,/<form[^>]+action="\/api\/auth\/logout"[^>]*>[\s\S]*?退出登录/);
  assert.doesNotMatch(html,/GA4 全渠道实时报告|数据基础|<details/);
  const preview=render(React.createElement(PreviewModeProvider,{enabled:true},React.createElement(PageHeader,{active:"overview"})));
  assert.doesNotMatch(preview,/退出登录/);
});

test("traffic reads stay in their own panel and goal failures have independent retry",()=> {
  const strategyUrl="/api/seo/growth/strategy?view=overview-goal";
  const trafficUrl="/api/seo/analytics?view=traffic-overview";
  overviewReads.set(strategyUrl,{loading:true});
  try {
    const rankingPending=render(React.createElement(SeoOverview));
    assert.doesNotMatch(rankingPending,/data-page-loading|\sinert=/);
    assert.match(rankingPending,/正在读取季度流量目标/);
    overviewReads.set(trafficUrl,{loading:true});
    const pending=render(React.createElement(SeoOverview));
    assert.doesNotMatch(pending,/data-page-loading|\sinert=/);
    assert.match(pending,/正在读取流量与注册归档/);
    assert.match(pending,/加载关系图/);
    overviewReads.delete(trafficUrl);
    overviewReads.set(strategyUrl,{error:"数据读取超时，请重试"});
    const settled=render(React.createElement(SeoOverview));
    assert.doesNotMatch(settled,/data-page-loading|\sinert=/);
    assert.match(settled,/role="alert"><span>数据读取超时，请重试<\/span><button[^>]*>重新加载/);
  } finally {
    overviewReads.clear();
  }
});

test("the trends and the module chart follow their shared date control",()=>{
  rangeReady=false;
  try {
    const initial=render(React.createElement(SeoOverview));
    assert.equal(lastTrafficUrl,null);
    assert.doesNotMatch(initial,/data-page-loading|\sinert=/);
    assert.match(initial,/正在读取流量与注册归档/);
    rangeReady=true;
    automaticRange=false;
    activeRange={start:"2026-11-19",end:"2026-11-20"};
    const previous={...overviewRange,automatic:true,completeWeekEnd:overviewRange.end,
      daily:[{date:"2026-11-23",site:{totalSessions:1094,organicSessions:317,totalRegistrations:70,organicRegistrations:20}}],
      modules:{sessions:{blog:40,models:60},complete:true},moduleDays:[{date:"2026-11-23",sessions:{blog:40,models:60}}]};
    const currentUrl=`/api/seo/analytics?view=traffic-overview&start=${activeRange.start}&end=${activeRange.end}`;
    overviewReads.set(currentUrl,{previousData:previous,loading:true,pending:true,hasSettled:true});
    const pending=render(React.createElement(SeoOverview));
    assert.doesNotMatch(pending,/data-page-loading|\sinert=/);
    assert.match(pending,/aria-label="选择时间" aria-busy="true">2026-11-17 — 2026-11-23/);
    assert.equal((pending.match(/本期 2026-11-17—2026-11-23/g)||[]).length,3);
    for (const title of ["Flatkey 流量趋势","Flatkey 注册趋势","总会话","自然搜索会话","总注册","自然搜索注册"]) assert.ok(pending.includes(title));
    assert.match(pending,/博客[\s\S]*?40\.0%/);
    assert.doesNotMatch(pending,/100\.0%|2026-11-19—2026-11-20/);
    overviewReads.set(currentUrl,{data:{...previous,...activeRange,automatic:false,
      daily:[{date:"2026-11-19",site:{totalSessions:null,organicSessions:null,totalRegistrations:null,organicRegistrations:null}}],
      modules:{sessions:{blog:35},complete:false},moduleDays:[]}});
    const partial=render(React.createElement(SeoOverview));
    assert.equal((partial.match(/本期 2026-11-19—2026-11-20/g)||[]).length,3);
    assert.match(partial,/所选周期暂无已归档的有效数据/);
    assert.match(partial,/页面入口数据尚未归档齐全/);
    assert.doesNotMatch(partial,/40\.0%|100\.0%/);
    assert.equal(lastTrafficUrl,currentUrl);
  } finally {rangeReady=true;automaticRange=true;activeRange=overviewRange;overviewReads.clear();}
});

test("work date filtering keeps the filters interactive and only retains stale rows while the list loads",()=>{
  listQuery="range=custom";
  listRead={hasSettled:true,pending:true,loading:true,previousUrl:"/api/seo/workflow?range=week",previousData:{storage:"database",pagination:{page:1,pageSize:10,total:1,pageCount:1},tasks:[{id:"original-task",title:"原任务标题",siteDomain:"flatkey.ai",displayStatus:"scheduled",owner:"Codex"}]}};
  try {
    const html=render(React.createElement(SeoWorkWorkspace));
    assert.match(html,/aria-label="筛选日期" aria-busy="true"/);
    assert.match(html,/<div inert="">[\s\S]*?原任务标题/);
    assert.doesNotMatch(html,/data-page-loading|正在读取工作任务/);
    assert.match(html,/每页 10 项/);
  } finally {listQuery="";listRead=undefined;}
});

test("the work board shortcut applies next week through the date control", () => {
  const calls = [];
  applyListRange = (...args) => calls.push(args);
  try {
    const html = render(React.createElement(SeoWorkWorkspace));
    assert.match(html, /<button type="button"[^>]*>下周排期<\/button>/);
    nextWeekClick();
    assert.deepEqual(calls, [["nextWeek"]]);
    listQuery = "range=nextWeek";
    assert.doesNotMatch(render(React.createElement(SeoWorkWorkspace)), /<button[^>]*>下周排期<\/button>/);
  } finally { applyListRange = undefined; nextWeekClick = undefined; listQuery = ""; }
});

test("work board shows the saved business-week plan without counting language gaps twice", () => {
  listRead = { data: { storage: "database", pagination: { page: 1, pageSize: 10, total: 0, pageCount: 1 }, tasks: [],
    workBoardPlan: { range: { start: "2026-11-27", end: "2026-12-03" }, plan: { id: "original-plan", version: 1, taskIds: ["friday", "thursday"],
      gaps: [{ category: "optimizedPages", count: 10 }, { category: "clusterLanding", count: 7 }, { category: "blogEn", count: 3 }],
      notes: "11/30 核对旧文\n12/01 核对 <待定> 落地页", datedGaps: [
        { date: "2026-11-30", gaps: [{ category: "optimizedPages", count: 2, siteDomain: "flatkey.ai" }] },
      ] } } } };
  try {
    const html = render(React.createElement(SeoWorkWorkspace));
    assert.match(html, /aria-label="业务周正式排期"[\s\S]*?2026-11-27 — 2026-12-03[\s\S]*?已排 (?:<!-- -->)?2(?:<!-- -->)? 项[\s\S]*?17(?:<!-- -->)? 项交付缺口/);
    assert.match(html, /aria-label="排期缺口"[\s\S]*?Flatkey 常规优化[\s\S]*?RackRate／ModelFit 落地页[\s\S]*?英文源文/);
    assert.match(html, /<details[^>]*><summary>每日交付缺口<\/summary>/);
    assert.match(html, /aria-label="按日登记的排期缺口"[\s\S]*?<time dateTime="2026-11-30">2026-11-30<\/time>[\s\S]*?Flatkey 常规优化 2/);
    assert.doesNotMatch(html, /<time dateTime="2026-12-01">/);
  } finally { listRead = undefined; }
});
test("1600-word graph is complete, deterministic across reorder/rank updates, and bounded by one circle",()=>{
  const topics=Array.from({length:64},(_,i)=>({id:`topic:${i}`,site:"flatkey.ai",topicId:`t${i}`,name:`Topic ${i}`}));
  const targets=Array.from({length:1600},(_,i)=>({id:`w${i}`,keyword:`keyword ${i}`,site:"flatkey.ai",topicId:`t${i%64}`,rank:i%100+1}));
  const first=keywordCircleLayout([...targets,{...targets[4],id:"zz-alias",keyword:"KEYWORD 4"}],topics);
  const second=keywordCircleLayout([...targets].reverse().map(row=>({...row,rank:null})),[...topics].reverse());
  assert.equal(first.points.length,1600);assert.equal(first.clusters.length,64);
  assert.deepEqual(first.points.map(p=>[p.target.id,p.x,p.y]),second.points.map(p=>[p.target.id,p.x,p.y]));
  assert.ok(first.points.every(p=>Math.hypot(p.x-300,p.y-300)+p.radius<285));
  for(const p of first.points){const cluster=first.clusters.find(c=>c.id===p.clusterId);assert.ok(Math.hypot(p.x-cluster.x,p.y-cluster.y)<cluster.radius);}
});
test("goal cards omit scale-zero captions while preserving a verified zero",()=>{
  const missing=render(React.createElement(GoalPlot,{label:"流量",value:null,goal:3000,unit:"次"}));
  assert.match(missing,/暂缺有效数值/);
  assert.doesNotMatch(missing,/fill="#4285dc"|>0 次<|<strong>—<small>/);
  const zero=render(React.createElement(GoalPlot,{label:"流量",value:0,goal:3000,unit:"次"}));
  assert.match(zero,/<strong>0<small>次<\/small><\/strong>/);
  assert.doesNotMatch(zero,/>0 次</);
});
test("the daily goal displays concise observation dates in LA and exact keyword denominators",()=>{
  const traffic={mode:"rolling",daysRemaining:71,period:{start:"2026-11-17",end:"2026-11-23"},sessions:1558,fallback:null};
  const ranked={id:"ranked",keyword:"gpu rental",site:"flatkey.ai",country:"US",language:"en",wordLanguage:"en",rank:35,rankEligible:true,languageStatus:"match",rankSource:"serp",captureState:"ranked",rankUrl:"https://flatkey.ai/gpu",checkedAt:"2026-11-23T01:00:00Z",workState:"completed"};
  const data={generatedAt:"2026-11-25T01:00:00Z",targets:[ranked,{...ranked,id:"another",rankEligible:false,keyword:"another term",workState:"planned"}],markets:[],reconciliation:{sources:[]}};
  const keywords=summarizeOverviewKeywords(data);
  const html=render(React.createElement(OverviewGoalCharts,{traffic,keywords}));
  assert.match(html,/最新滚动7日/);
  assert.match(html,/流量截至 11月23日 · 排名截至 11月22日/);
  assert.match(html,/1,558/);
  assert.match(html,/1 \/ 2 词/);
  assert.doesNotMatch(html,/>0 %</);
  assert.doesNotMatch(JSON.stringify(keywords),/gpu rental|another term|https:/);
  ranked.checkedAt="2026-11-23T10:00:00Z";
  assert.match(render(React.createElement(OverviewGoalCharts,{traffic,keywords:summarizeOverviewKeywords(data)})),/数据截至 11月23日/);
  data.reconciliation.sources.push({name:"最近14天的已存SERP",available:false});
  const missing=summarizeOverviewKeywords(data);
  assert.equal(missing.ranking,null);
  assert.equal(missing.coverage,null);
  assert.equal(missing.total,2);
});
test("the overview displays the verified prior whole window while the latest window is pending",()=>{
  const traffic={mode:"rolling",daysRemaining:70,period:{start:"2026-11-19",end:"2026-11-25"},sessions:null,
    fallback:{start:"2026-11-18",end:"2026-11-24",sessions:1603}};
  const overview=()=>render(React.createElement(OverviewGoalCharts,{traffic,keywords:null}));
  const initial=overview();
  assert.match(initial,/最近已核验滚动7日/);
  assert.match(initial,/流量截至 11月24日/);
  assert.match(initial,/1,603/);
  assert.match(initial,/洛杉矶 11月25日 截止窗口待采，当前显示 11月18日–11月24日 的整段会话/);
  traffic.fallback.sessions=0;
  assert.match(overview(),/会话：0次，目标3000次/);
  traffic.fallback=null;
  assert.match(overview(),/窗口待采/);
  assert.doesNotMatch(overview(),/会话：0次|流量截至 11月24日/);
  traffic.mode="final";
  assert.doesNotMatch(overview(),/最近已核验滚动7日|窗口待采/);
});
test("daily chart preserves missing-day gaps rather than joining through or filling zero",()=>{
  const html=render(React.createElement(LinePlot,{unit:"次会话",rows:[{label:"11-01",value:8},{label:"11-02",value:null},{label:"11-03",value:12}]}));
  assert.equal((html.match(/<circle /g)||[]).length,2);assert.match(html,/d="M42,[^ ]+ {2}M558,/);assert.match(html,/缺失日期保留断点/);
  const empty=render(React.createElement(LinePlot,{unit:"人",rows:[{label:"11-01",value:null}]}));
  assert.match(empty,/缺口未记为0/);assert.doesNotMatch(empty,/<circle /);
});
test("hotspot topics open the saved original terms, evidence and task links without the quarter review editor",()=>{
  const base={version:"growth-hotspots-v9",generatedAt:"2026-11-24T00:00:00Z",businessWeek:{start:"2026-11-20",end:"2026-11-26"}};
  const topic={key:"flatkey.ai:topic:gpu",topicId:"gpu",title:"已保存 GPU 话题",site:"flatkey.ai",keywordCount:1,taskCount:1,latestEventAt:"2026-11-24T00:00:00Z"};
  const item={id:"hot-1",title:"官方新模型",keyword:"new model gpu",site:"flatkey.ai",country:"US",language:"en",topicId:"gpu",stage:"scheduled",directionId:"direction1",taskIds:["original-id"],officialEvidence:[{reference:"https://example.com/launch",supports:"官方发布时间"}],demandEvidence:[{reference:"https://example.com/demand"}],tasks:[{id:"original-id",title:"原热点博客",status:"planned",dueAt:"2026-11-25T08:00:00Z"}],admission:{status:"scheduled",reason:"已追加原当周计划"}};
  fixtures.set("/api/seo/growth/hotspots?view=topics&page=1",{...base,kind:"topics",topics:[topic],pagination:{page:1,total:12,pageCount:2}});
  fixtures.set("/api/seo/growth/hotspots?view=topics&page=1&topic=flatkey.ai%3Atopic%3Agpu",{...base,kind:"keywords",topic,items:[item],pagination:{page:1,total:1,pageCount:1}});
  try {
    const list=render(React.createElement(GrowthTopicWorkspace,{initialTab:"hotspots"}));
    assert.match(list,/季度关键词/);assert.match(list,/近期热点词/);assert.match(list,/第 1 \/ 2 页/);
    assert.match(list,/href="\/opportunities\?tab=hotspots&amp;hotspotTopic=flatkey.ai%3Atopic%3Agpu"[^>]*>已保存 GPU 话题/);
    assert.doesNotMatch(list,/new model gpu|\/work\/original-id|查看季度审核与方向决定|业务词库关系图/);
    const detail=render(React.createElement(GrowthTopicWorkspace,{initialTab:"hotspots",hotspotTopic:topic.key}));
    assert.match(detail,/href="\/opportunities\?tab=hotspots"[^>]*>.*返回热点话题/);
    assert.match(detail,/new model gpu/);assert.match(detail,/href="https:\/\/example.com\/launch"/);
    assert.match(detail,/href="\/work\/original-id"/);assert.match(detail,/原交付日.*2026-11-25/);
    assert.doesNotMatch(detail,/查看季度审核与方向决定|业务词库关系图|规划外机会/);
  } finally { fixtures.clear(); }
});

test("both traffic charts have focusable date detail targets and the unsupported attribution panel is gone", () => {
  const trafficUrl="/api/seo/analytics?view=traffic-overview";
  const daily=[
    {date:"2026-11-17",site:{totalSessions:11,organicSessions:9,totalRegistrations:4,organicRegistrations:1}},
    {date:"2026-11-18",site:{totalSessions:0,organicSessions:0,totalRegistrations:0,organicRegistrations:0}},
    {date:"2026-11-19",site:{totalSessions:8,organicSessions:5,totalRegistrations:2,organicRegistrations:null}},
  ];
  overviewReads.set(trafficUrl,{data:{...overviewRange,automatic:true,completeWeekEnd:overviewRange.end,
    daily,modules:{sessions:{blog:9},complete:true},moduleDays:[{date:"2026-11-17",sessions:{blog:9}}],
    comparison:{previous:{start:"2026-11-10",end:"2026-11-16"},totalSessions:{current:19,previous:20},organicSessions:{current:14,previous:10},totalRegistrations:{current:5,previous:4},organicRegistrations:{current:2,previous:3}}}});
  try {
    const html=render(React.createElement(SeoOverview));
    assert.match(html,/tabindex="0" aria-label="总会话与自然搜索会话每日明细/);
    assert.match(html,/tabindex="0" aria-label="总注册与自然搜索注册每日明细/);
    for (const { date } of daily) assert.equal(html.split(`data-chart-date="${date}"`).length - 1, 2);
    assert.match(html,/博客 · 2026-11-17—2026-11-23/);
    assert.match(html,/本期总会话 <strong>19<\/strong> 次[\s\S]*?环比 -5\.0%/);
    assert.match(html,/自然搜索会话 <strong>14<\/strong> 次[\s\S]*?环比 \+40\.0%/);
    assert.match(html,/自然搜索注册 <strong>2<\/strong> 人[\s\S]*?环比 -33\.3%/);
    assert.match(html,/本期总注册 <strong>5<\/strong> 人[\s\S]*?环比 \+25\.0%/);
    assert.match(html,/上期 2026-11-10—2026-11-16 · 4 人/);
    assert.ok(html.indexOf("2026 收官季目标进度") < html.indexOf("Flatkey 流量与注册"));
    assert.doesNotMatch(html,/品牌词与非品牌词自然搜索会话|搜索词未归因|点击|新用户|流量板块/);
  } finally { overviewReads.clear(); }
});
