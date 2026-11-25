const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), originalLoad = Module._load;
const React = require("react"), { renderToStaticMarkup: render } = require("react-dom/server");
const fixtures = new Map();
const overviewReads = new Map();
const overviewRange = { start: "2026-11-17", end: "2026-11-23" };
let rangeReady = true;
let activeRange = overviewRange;
let listQuery = "";
let listRead;
let lastTrafficUrl;
Module._load = function(name, parent, ...rest) {
  if (name === "./AppLink" || name === "@/components/AppLink") return { __esModule:true, default:({ children,prefetch,...props }) => React.createElement("a",props,children) };
  if (name === "./PageHeader" || name === "./UiSelect" || name === "./FeedbackButton") return { PageHeader:()=>React.createElement("nav",{ "aria-label":"主导航" }), UiSelect:()=>null, FeedbackButton:()=>null };
  if (name === "./SeoDateControl") return { useSeoRange:()=>({ range:activeRange, comparison:null, ready:rangeReady }),
    SeoDateControl:({pending})=>React.createElement("button",{"aria-label":"选择时间", "aria-busy":pending||undefined}),
    useSeoListDateRange:()=>({ preset:listQuery.includes("range=custom") ? "custom" : "week", range:activeRange }),
    SeoListDateControl:({pending})=>React.createElement("button",{"aria-label":"筛选日期", "aria-busy":pending||undefined}) };
  if (name === "next/navigation") return { useSearchParams:()=>new URLSearchParams(listQuery) };
  if (name === "next/link") return { useLinkStatus:()=>({pending:false}) };
  if (name === "./useFeedbackRouter") return { useFeedbackRouter:()=>({}) };
  if (name === "./useSeoCountry") return { useSeoCountry:()=>["all"] };
  if (name === "./RankingTrend") return { RankingTrend:()=>null };
  if (name === "./useSeoAnalytics") return { useSeoRead:(url,_options) => {
    if (parent?.filename.endsWith("/OverviewTrafficCharts.tsx")) lastTrafficUrl=url;
    return { data:fixtures.get(url) ?? null, error:null, loading:false, retry() {}, ...(url?.includes("workList=1") ? listRead : overviewReads.get(url)) };
  }, useOverviewRead:url => ({ data:null, error:null, loading:false, retry() {}, ...overviewReads.get(url) }), numberText:String, shanghaiStamp:String, analyticsUrl:(range,urls,country) => `/api/seo/analytics?start=${range.start}&end=${range.end}${country!=="all"?`&country=${country}`:""}` };
  if (name.endsWith(".module.css")) return new Proxy({}, {get:(_,key)=>key === "__esModule"?false:String(key)});
  return originalLoad.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest);
};
for(const extension of [".ts",".tsx"]) require.extensions[extension]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
const { keywordCircleLayout } = require("../src/components/growth-network-layout.ts");
const { GoalPlot, LinePlot } = require("../src/components/OverviewCharts.tsx");
const { ConversionCharts, OverviewGoalCharts, TopicComparison } = require("../src/components/OverviewGrowthCharts.tsx");
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

test("only the traffic read gates the page and growth failures have independent retry",()=> {
  const strategyUrl="/api/seo/growth/strategy?view=dashboard";
  const trafficUrl=`/api/seo/analytics?view=overview-traffic&start=${overviewRange.start}&end=${overviewRange.end}`;
  overviewReads.set(strategyUrl,{loading:true});
  try {
    const rankingPending=render(React.createElement(SeoOverview));
    assert.doesNotMatch(rankingPending,/data-page-loading|\sinert=/);
    assert.match(rankingPending,/正在重读季度目标/);
    overviewReads.set(trafficUrl,{loading:true});
    const pending=render(React.createElement(SeoOverview));
    assert.match(pending,/<nav aria-label="主导航"><\/nav><div[^>]+aria-busy="true"[^>]+inert=""/);
    assert.match(pending,/data-page-loading="local"[\s\S]*role="status">[\s\S]*正在加载页面数据/);
    overviewReads.delete(trafficUrl);
    overviewReads.set(strategyUrl,{error:"数据读取超时，请重试"});
    const settled=render(React.createElement(SeoOverview));
    assert.doesNotMatch(settled,/data-page-loading|\sinert=/);
    assert.match(settled,/role="alert"><span>数据读取超时，请重试<\/span><button[^>]*>重新加载/);
  } finally {
    overviewReads.clear();
  }
});

test("the overview date refresh preserves the prior traffic view without making the rest of the page inert",()=>{
  rangeReady=false;
  try {
    const initial=render(React.createElement(SeoOverview));
    assert.equal(lastTrafficUrl,null);
    assert.match(initial,/data-page-loading="local"/);
    rangeReady=true;
    activeRange={start:"2026-11-19",end:"2026-11-20"};
    const previousData={range:overviewRange, comparison:null, module:"all", country:"all", current:[{date:"2026-11-23",sessions:251}],previous:null,modules:{sessions:{blog:251},complete:true}};
    const currentUrl=`/api/seo/analytics?view=overview-traffic&start=${activeRange.start}&end=${activeRange.end}`;
    overviewReads.set(currentUrl,{previousData,loading:true,pending:true,hasSettled:true});
    const pending=render(React.createElement(SeoOverview));
    assert.doesNotMatch(pending,/data-page-loading|\sinert=/);
    assert.match(pending,/aria-label="选择时间" aria-busy="true"/);
    assert.match(pending,/本期 2026-11-17—2026-11-23/);
    assert.doesNotMatch(pending,/本期 2026-11-19—2026-11-20/);
    assert.equal(lastTrafficUrl,currentUrl);
  } finally {rangeReady=true;activeRange=overviewRange;overviewReads.clear();}
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
test("a duplicated page with ambiguous topics is not plotted as an invented topic contribution",()=>{
 const driver={title:'GPU page',url:'https://flatkey.ai/blog/gpu',module:'blog',topicId:'gpu',country:'US',language:'en',metric:'sessions',source:'GA4',previous:10,current:20,window:{start:'2026-11-12',end:'2026-11-18',previousStart:'2026-11-05',previousEnd:'2026-11-11',timezone:'America/Los_Angeles'}};
 const snapshot={period:{start:'2026-11-12',end:'2026-11-18',timezone:'America/Los_Angeles'},directions:[{drivers:[driver]},{drivers:[{...driver,topicId:'api'}]}]};
 const html=render(React.createElement(TopicComparison,{snapshot,workspace:null}));assert.match(html,/尚无同口径/);assert.doesNotMatch(html,/class="bar"/);
});

test("contribution charts display the actual single destinations and expandable links for grouped pages",()=>{
 const scope={start:'2026-11-12',end:'2026-11-18',timezone:'America/Los_Angeles'};
 const driver={title:'GPU page',url:'https://flatkey.ai/blog/gpu',module:'blog',topicId:'gpu',country:'ALL',language:'en',metric:'clicks',source:'GSC',previous:10,current:20,window:{...scope,previousStart:'2026-11-05',previousEnd:'2026-11-11'}};
 const snapshot={period:scope,directions:[{drivers:[driver,{...driver,title:'GPU pricing',url:'https://flatkey.ai/blog/pricing'},{...driver,title:'本地化 GPU',url:'https://flatkey.ai/zh/blog/gpu',language:'zh-CN'}]}]};
 const workspace={sites:[{domain:'flatkey.ai',name:'Flatkey'}],topics:[{site:'flatkey.ai',topicId:'gpu',name:'GPU 租赁'}]};
 const html=render(React.createElement(TopicComparison,{snapshot,workspace}));
 assert.match(html,/GPU 租赁<small>Flatkey · 全部国家 · 英语/);
 assert.match(html,/Flatkey · 全部国家 · 中文/);
 assert.match(html,/<details><summary>2 个贡献页面<\/summary>/);
 for(const url of ['https://flatkey.ai/blog/gpu','https://flatkey.ai/blog/pricing','https://flatkey.ai/zh/blog/gpu']) assert.ok(html.includes(`href="${url}"`));
 assert.doesNotMatch(html,/>GPU 租赁<\/a>|指标与来源分开显示/);
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
test("unknown goal values never become zero progress or inherit the historical four-site scope",()=>{
  const html=render(React.createElement(GoalPlot,{label:"流量",value:null,goal:3000,unit:"次",denominator:"来源未齐",note:"未知"}));
  assert.match(html,/暂缺有效数值/);assert.doesNotMatch(html,/fill="#4285dc"/);
  const historical=render(React.createElement(OverviewGoalCharts,{snapshot:{period:{start:"2026-11-12",end:"2026-11-18"},goals:{deadline:"2027-02-05",daysRemaining:70,trafficPeriod:{start:"2026-11-12",end:"2026-11-18"},weeklySessions:2000,trafficComplete:true,baselineCount:null,rankedCount:null,top50Count:null,coverage:null,quality:null,latestRankAt:null}}}));
  assert.doesNotMatch(historical,/2,000|2，000/);assert.match(historical,/暂缺有效数值/);assert.match(historical,/清单尚未核定/);
});
test("the daily goal displays concise observation dates in LA without changing snapshot data",()=>{
 const {unavailableGrowthReportSnapshot}=require('../src/lib/growth-strategy.ts');
 const snapshot=unavailableGrowthReportSnapshot({start:'2026-11-12',end:'2026-11-18'},new Date('2026-11-25T01:00:00Z'));
 Object.assign(snapshot.goals,{trafficWindowKind:'rolling7day-v1',trafficPeriod:{start:'2026-11-17',end:'2026-11-23',timezone:'America/Los_Angeles'},weeklySessions:1558,trafficGap:1442,trafficComplete:true,dailyTrafficObservation:{version:'rolling7day-v1',asOf:'2026-11-25T01:00:00Z',period:{start:'2026-11-17',end:'2026-11-23'},previousPeriod:{start:'2026-11-16',end:'2026-11-22'},sessions:1558,previousSessions:1485,difference:73,complete:true,previousComplete:true}});
 Object.assign(snapshot.goals,{trafficScope:'flatkey_website_console',latestRankAt:'2026-11-23T01:00:00Z'});
 const before=JSON.stringify(snapshot),html=render(React.createElement(OverviewGoalCharts,{snapshot}));assert.match(html,/最新滚动7日/);assert.match(html,/流量截至 11月23日 · 排名截至 11月22日/);assert.match(html,/1,558/);assert.doesNotMatch(html,/1485|1,442|R \/ N|控制台生产域名|2026-11-23T/);assert.equal(JSON.stringify(snapshot),before);
 snapshot.goals.latestRankAt='2026-11-23T10:00:00Z';
 assert.match(render(React.createElement(OverviewGoalCharts,{snapshot})),/数据截至 11月23日/);
});
test("daily chart preserves missing-day gaps rather than joining through or filling zero",()=>{
  const html=render(React.createElement(LinePlot,{unit:"次会话",rows:[{label:"11-01",value:8},{label:"11-02",value:null},{label:"11-03",value:12}]}));
  assert.equal((html.match(/<circle /g)||[]).length,2);assert.match(html,/d="M42,[^ ]+ {2}M558,/);assert.match(html,/缺失日期保留断点/);
  const empty=render(React.createElement(LinePlot,{unit:"人",rows:[{label:"11-01",value:null}]}));
  assert.match(empty,/缺口未记为0/);assert.doesNotMatch(empty,/<circle /);
});
const missing=(unit)=>({value:null,unit,status:"unavailable",reason:"尚无可靠来源",sourceRefs:[]});
const projection=()=>({version:1,generatedAt:"2026-11-24T00:00:00Z",scope:{site:"flatkey.ai",start:"2026-11-12",end:"2026-11-18",timezone:"America/Los_Angeles",country:"all"},api:{registration:{eligibleVisitors:missing("users"),firstRegistrations:missing("users"),rate:missing("ratio")},firstPayment30d:{registeredUsers:missing("users"),confirmedFirstPayers:missing("users"),rate:missing("ratio"),cohorts:[]}},gpu:{inquiries:missing("inquiries"),quotes:missing("quotes"),deals:missing("deals")},readiness:{status:"unavailable",reasons:["支付身份关联缺失"]}});
test("registration and payment use user denominators; immature or missing cohorts are never drawn as zero",()=>{
 const data=projection();data.ga4OrganicRegistrants={ users:81,observedAt:"2026-11-25T02:00:00Z" };data.api.firstPayment30d.cohorts=[{id:"not-mature",registrationStart:"2026-11-20",registrationEnd:"2026-11-21",registeredUsers:8,matureRegisteredUsers:0,confirmedFirstPayers:0,rate:0,maturity:"immature",status:"partial",reasons:["尚未满30天"]}];
  const html=render(React.createElement(ConversionCharts,{projection:data}));
 assert.doesNotMatch(html,/GA4 自然获客注册 <strong>81 人|会话趋势另列|单位：询盘 \/ 报价 \/ 成交/);assert.match(html,/合资格访客/);assert.match(html,/30 天首次付费率/);assert.match(html,/未成熟批次/);
 assert.doesNotMatch(html,/class="bar"/);assert.match(html,/尚无可靠的自然搜索询盘、报价或成交来源/);
  const mature=projection();mature.api.firstPayment30d.cohorts=[{...data.api.firstPayment30d.cohorts[0],maturity:"mature",status:"ready",matureRegisteredUsers:8}];
  const verified=render(React.createElement(ConversionCharts,{projection:mature}));assert.match(verified,/class="bar"/);assert.match(verified,/0 \/ 8 人/);
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
