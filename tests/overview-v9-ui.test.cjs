const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), originalLoad = Module._load;
const React = require("react"), { renderToStaticMarkup: render } = require("react-dom/server");
const fixtures = new Map();
Module._load = function(name, parent, ...rest) {
  if (name === "./AppLink") return { __esModule:true, default:({ children,...props }) => React.createElement("a",props,children) };
  if (name === "./PageHeader" || name === "./UiSelect" || name === "./FeedbackButton") return { PageHeader:()=>null, UiSelect:()=>null, FeedbackButton:()=>null };
  if (name === "./useSeoAnalytics") return { useSeoRead:url => ({ data:fixtures.get(url) ?? null }), analyticsUrl:(range,urls,country) => `/api/seo/analytics?start=${range.start}&end=${range.end}${country!=="all"?`&country=${country}`:""}` };
  if (name.endsWith(".module.css")) return new Proxy({}, {get:(_,key)=>key === "__esModule"?false:String(key)});
  return originalLoad.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest);
};
for(const extension of [".ts",".tsx"]) require.extensions[extension]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
const { keywordCircleLayout } = require("../src/components/growth-network-layout.ts");
const { GoalPlot, LinePlot } = require("../src/components/OverviewCharts.tsx");
const { ConversionCharts, OverviewGoalCharts, TopicComparison } = require("../src/components/OverviewGrowthCharts.tsx");
const { GrowthTopicWorkspace } = require("../src/components/GrowthTopicWorkspace.tsx");
test("a duplicated page with ambiguous topics is not plotted as an invented topic contribution",()=>{
 const driver={title:'GPU page',url:'https://flatkey.ai/blog/gpu',module:'blog',topicId:'gpu',country:'US',language:'en',metric:'sessions',source:'GA4',previous:10,current:20,window:{start:'2026-11-12',end:'2026-11-18',previousStart:'2026-11-05',previousEnd:'2026-11-11',timezone:'America/Los_Angeles'}};
 const snapshot={period:{start:'2026-11-12',end:'2026-11-18',timezone:'America/Los_Angeles'},directions:[{drivers:[driver]},{drivers:[{...driver,topicId:'api'}]}]};
 const html=render(React.createElement(TopicComparison,{snapshot,workspace:null}));assert.match(html,/尚无同口径/);assert.doesNotMatch(html,/class="bar"/);
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
  assert.doesNotMatch(historical,/2,000|2，000/);assert.match(historical,/历史统计范围/);assert.match(historical,/基线|清单尚未核定/);
});
test("the daily goal labels the measured rolling7 window and day-over-day change without rewriting a fixed snapshot",()=>{
 const {unavailableGrowthReportSnapshot}=require('../src/lib/growth-strategy.ts');
 const snapshot=unavailableGrowthReportSnapshot({start:'2026-11-12',end:'2026-11-18'},new Date('2026-11-25T01:00:00Z'));
 Object.assign(snapshot.goals,{trafficWindowKind:'rolling7day-v1',trafficPeriod:{start:'2026-11-17',end:'2026-11-23',timezone:'America/Los_Angeles'},weeklySessions:1558,trafficGap:1442,trafficComplete:true,dailyTrafficObservation:{version:'rolling7day-v1',asOf:'2026-11-25T01:00:00Z',period:{start:'2026-11-17',end:'2026-11-23'},previousPeriod:{start:'2026-11-16',end:'2026-11-22'},sessions:1558,previousSessions:1485,difference:73,complete:true,previousComplete:true}});
 const before=JSON.stringify(snapshot),html=render(React.createElement(OverviewGoalCharts,{snapshot}));assert.match(html,/最新滚动7日/);assert.match(html,/2026-11-17—2026-11-23/);assert.match(html,/1485 → 1558，\+73/);assert.match(html,/1,442/);assert.equal(JSON.stringify(snapshot),before);
 snapshot.goals.dailyTrafficObservation.previousSessions=null;snapshot.goals.dailyTrafficObservation.difference=null;
 assert.match(render(React.createElement(OverviewGoalCharts,{snapshot})),/同口径标量未齐，暂不计算变化/);
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
  const data=projection();data.api.firstPayment30d.cohorts=[{id:"not-mature",registrationStart:"2026-11-20",registrationEnd:"2026-11-21",registeredUsers:8,matureRegisteredUsers:0,confirmedFirstPayers:0,rate:0,maturity:"immature",status:"partial",reasons:["尚未满30天"]}];
  const html=render(React.createElement(ConversionCharts,{projection:data}));
  assert.match(html,/会话趋势另列/);assert.match(html,/合资格自然访客/);assert.match(html,/每批注册后30天首次付费人数/);assert.match(html,/观察窗口未满|未成熟/);
  assert.doesNotMatch(html,/class="bar"/);assert.match(html,/尚无可靠来源/);assert.match(html,/不能因30天注册首付指标不足单独否定GPU方向/);
  const mature=projection();mature.api.firstPayment30d.cohorts=[{...data.api.firstPayment30d.cohorts[0],maturity:"mature",status:"ready",matureRegisteredUsers:8}];
  const verified=render(React.createElement(ConversionCharts,{projection:mature}));assert.match(verified,/class="bar"/);assert.match(verified,/0 \/ 8 人/);
});
test("hotspot tab reads only actual research and retains original task identity without growing quarter N",()=>{
  fixtures.set("/api/seo/growth/hotspots",{version:"growth-hotspots-v9",generatedAt:"2026-11-24T00:00:00Z",businessWeek:{start:"2026-11-20",end:"2026-11-26"},items:[{id:"hot-1",title:"官方新模型",keyword:"new model gpu",site:"flatkey.ai",country:"US",language:"en",topicId:"gpu",inQuarter:false,stage:"scheduled",directionId:"direction1",taskIds:["original-id"],officialEvidence:[{reference:"https://example.com/launch",supports:"官方发布时间"}],demandEvidence:[{reference:"https://example.com/demand"}],tasks:[{id:"original-id",title:"原热点博客",status:"planned",dueAt:"2026-11-25T08:00:00Z"}],admission:{status:"scheduled",reason:"已追加原当周计划"}}]});
  const html=render(React.createElement(GrowthTopicWorkspace,{initialTab:"hotspots"}));
  assert.match(html,/季度关键词/);assert.match(html,/1600 · 固定/);assert.match(html,/近期热点词/);assert.match(html,/动态/);assert.match(html,/new model gpu/);
  assert.match(html,/href="\/work\/original-id"/);assert.match(html,/原交付日.*2026-11-25/);assert.match(html,/季度N不增加/);assert.doesNotMatch(html,/业务词库关系图|规划外机会|待核归属/);
  fixtures.clear();
});
