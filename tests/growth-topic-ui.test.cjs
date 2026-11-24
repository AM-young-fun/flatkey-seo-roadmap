const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), originalLoad = Module._load;
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
let readData = null;
Module._load = function(name, parent, ...rest) {
  if (name === "./AppLink") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
  if (name === "./PageHeader") return { PageHeader: () => null };
  if (name === "./UiSelect") return { UiSelect: () => null };
  if (name === "./FeedbackButton") return { FeedbackButton: () => null };
  if (name === "./useSeoAnalytics") return { useSeoRead: () => ({ data: readData }) };
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  return originalLoad.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
const { defaultGrowthScope, readGrowthScope, growthCounts, selectGrowthTargets, growthRankKind, growthRankText, growthLink, growthTopicTargets, growthRelatedTargets, growthRankingEvidence, quarterTargetWorkspace } = require("../src/components/growth-topic-view.ts");
const { GrowthTopicClusters, GrowthTargetTable, GrowthRankingCoverage, GrowthTopicWorkspace, GrowthTopicContributionCells } = require("../src/components/GrowthTopicWorkspace.tsx");
const target = (id, patch = {}) => ({ id, keywordId: id, keyword: "GPU rental", site: "flatkey.ai", topicId: "topic/1", topicName: "GPU计算", country: "US", language: "en", membership: "formal", pageState: "published", workState: "completed", publishedUrls: ["https://flatkey.ai/gpu"], plannedUrls: [], rank: 22, rankSource: "serp", rankUrl: "https://flatkey.ai/gpu", checkedAt: "2026-11-23T00:00:00Z", languageStatus: "match", languageReason: "", captureState: "ranked", rankEligible: true, taskIds: ["original-task"], reason: "", ...patch });
const topic = { id: "flatkey.ai:topic/1", site: "flatkey.ai", topicId: "topic/1", name: "GPU计算", parentIds: [], formalCount: 3, markets: [] };
const data = targets => ({ quarter: {targetIds:targets.filter(row=>row.membership==="formal").map(row=>row.id),keywordCount:targets.filter(row=>row.membership==="formal").length,hash:"reviewed"}, generatedAt: "2026-11-23T08:00:00Z", reconciliation: { sources: [] }, targets, topics: [topic], markets: [{ country: "US", language: "en", label: "美国 · 英语" }, { country: "JP", language: "ja", label: "日本 · 日语" }], sites: [{ domain: "flatkey.ai", name: "Flatkey", keywordGoals: true }] });
test("topic contribution cells keep unavailable cohort attribution unknown and expose real page/window evidence",()=>{
 const snapshot={period:{start:'2026-11-12',end:'2026-11-18',timezone:'America/Los_Angeles'},directions:[{drivers:[{topicId:topic.topicId,url:'https://flatkey.ai/blog/gpu',country:'US',language:'en',metric:'sessions',source:'GA4',previous:10,current:15,window:{start:'2026-11-12',end:'2026-11-18',previousStart:'2026-11-05',previousEnd:'2026-11-11',timezone:'America/Los_Angeles'}}]}]};
 const html=renderToStaticMarkup(React.createElement('table',null,React.createElement('tbody',null,React.createElement('tr',null,React.createElement(GrowthTopicContributionCells,{snapshot,topic,scope:defaultGrowthScope})))));
 assert.match(html,/10 → 15/);assert.match(html,/2026-11-12—2026-11-18/);assert.match(html,/nofollow/);assert.match(html,/暂无可核归因/);assert.match(html,/未用全站数字分摊或填0/);
 const empty=renderToStaticMarkup(React.createElement('table',null,React.createElement('tbody',null,React.createElement('tr',null,React.createElement(GrowthTopicContributionCells,{snapshot:null,topic,scope:defaultGrowthScope})))));
 assert.match(empty,/暂无同窗口页面贡献证据/);assert.doesNotMatch(empty,/0 → 0/);
});

test("topic totals preserve distinct market targets and separate outside opportunities", () => {
  const workspace = data([target("us"), target("jp", { country: "JP", language: "ja", keyword: "GPUレンタル" }), target("opportunity", { membership: "opportunity" })]);
  const selected = selectGrowthTargets(workspace, defaultGrowthScope);
  assert.equal(selected.length, 2);
  assert.equal(selectGrowthTargets(workspace, { ...defaultGrowthScope, country: "JP" })[0].id, "jp");
  assert.equal(selectGrowthTargets(workspace, { ...defaultGrowthScope, membership: "opportunity" })[0].id, "opportunity");
  assert.equal(growthCounts(selected).ranked, 2);
});

test("shared topic relations are browseable but do not duplicate primary progress", () => {
  const shared = target("shared", { relatedTopicIds: ["topic/1", "topic/2"] });
  const secondary = { ...topic, id: "flatkey.ai:topic/2", topicId: "topic/2", name: "硬件比较", targetIds: ["shared"] };
  const workspace = { ...data([shared]), topics: [topic, secondary] };
  assert.equal(selectGrowthTargets(workspace, defaultGrowthScope).length, 1);
  assert.equal(selectGrowthTargets(workspace, defaultGrowthScope, secondary).length, 0);
  assert.equal(growthRelatedTargets(workspace.topics, secondary, [shared])[0].id, "shared");
  const html = renderToStaticMarkup(React.createElement(GrowthTopicClusters, { data: workspace, scope: defaultGrowthScope, targets: [shared] }));
  assert.match(html, /1 个关键词/); assert.match(html, /1 个话题簇/); assert.match(html, /关联话题在详情中浏览/); assert.equal((html.match(/data-keyword-id=/g)||[]).length,1);
});

test("parent topics without direct words include descendant primary targets once across a multi-parent DAG", () => {
  const parent = { ...topic, topicId: "parent", id: "parent", targetIds: [] };
  const a = { ...topic, topicId: "a", id: "a", parentIds: ["parent"] };
  const b = { ...topic, topicId: "b", id: "b", parentIds: ["parent"] };
  const child = { ...topic, topicId: "child", id: "child", parentIds: ["a", "b"] };
  const targets = [target("one", { topicId: "child" }), target("two", { topicId: "a", keyword: "GPU pricing" })];
  const workspace = { ...data(targets), topics: [parent, a, b, child] };
  assert.equal(growthTopicTargets(workspace.topics, parent, targets).length, 2);
  assert.equal(selectGrowthTargets(workspace, defaultGrowthScope, parent).length, 2);
  assert.equal(selectGrowthTargets(workspace, { ...defaultGrowthScope, search: "GPU计算" }, parent).length, 2);
  // A malformed cycle remains readable and cannot multiply the target count.
  parent.parentIds = ["child"];
  assert.equal(growthTopicTargets(workspace.topics, parent, targets).length, 2);
  const html = renderToStaticMarkup(React.createElement(GrowthTopicClusters, { data: workspace, scope: defaultGrowthScope, targets }));
  assert.match(html, /2 个话题簇/); assert.equal((html.match(/data-keyword-id=/g)||[]).length,2);
  assert.match(html, /每词一个点/);
});

test("only eligible actual SERP rankings count and unknown never shares confirmed outside100 label", () => {
  const observed = target("database", { rankEligible: false, rankSource: "database" });
  const unknown = target("unknown", { rankEligible: false, rank: null, captureState: "unqueried" });
  const outside = target("outside", { rankEligible: false, rank: null, captureState: "outside100" });
  assert.deepEqual(growthCounts([observed, unknown, outside]), { total: 3, built: 3, ranked: 0, top50: 0, unknown: 2 });
  assert.equal(growthRankKind(observed), "unknown");
  assert.equal(growthRankKind(unknown), "unknown"); assert.equal(growthRankKind(outside), "outside");
  assert.match(growthRankText(observed), /待核定/); assert.equal(growthRankText(outside), "已查未进前100");
});

test("topic and graph deep links retain original market, language and target identity", () => {
  const scope = readGrowthScope(new URLSearchParams({ country: "jp", language: "ja", pool: "review" }));
  const url = new URL(growthLink(scope, topic, "word:JP:ja"), "https://seo.example");
  assert.equal(url.pathname, "/topics/topic%2F1"); assert.equal(url.searchParams.get("country"), "JP");
  assert.equal(url.searchParams.get("language"), "ja"); assert.equal(url.searchParams.get("pool"), "review");
  assert.equal(url.searchParams.get("target"), "word:JP:ja"); assert.equal(url.searchParams.get("site"), "flatkey.ai");
});

test("circular graph renders every distinct word rather than a 24-word preview", () => {
  const targets = Array.from({ length: 27 }, (_, index) => target(`word-${index}`, {keyword:`GPU rental ${index}`}));
  const html = renderToStaticMarkup(React.createElement(GrowthTopicClusters, { data: data(targets), scope: defaultGrowthScope, targets }));
  assert.match(html, /27 个关键词/); assert.equal((html.match(/data-keyword-id=/g)||[]).length,27); assert.doesNotMatch(html, /图中预览/);
  assert.match(html, /topics\/topic%2F1\?site=flatkey.ai&amp;target=word-0/);
  assert.equal((html.match(/class="cluster"/g) || []).length, 1);
});

test("planned URL is not presented as published and task link uses its original ID", () => {
  const targets = [target("planned", { pageState: "planned", workState: "planned", rankEligible: false, rank: null, rankUrl: null, rankSource: null, captureState: "unqueried", publishedUrls: [], plannedUrls: ["https://flatkey.ai/planned"] })];
  const html = renderToStaticMarkup(React.createElement(GrowthTargetTable, { data: data(targets), scope: defaultGrowthScope, targets }));
  assert.match(html, /已规划页面/); assert.match(html, /尚未查询/); assert.match(html, /1 个规划地址/);
  assert.doesNotMatch(html, /href="https:\/\/flatkey.ai\/planned"|页面分析与效果/);
  assert.match(html, /href="\/work\/original-task"/);
});
test("secondary terms expose the original task main word and separate unapproved market candidates", () => {
  const relation={taskId:'original-task',originalKeyword:'rent gpu server',country:'US',language:'en',pageUrl:'https://flatkey.ai/gpu',source:'task_page',sourceKeywordId:'secondary',status:'confirmed',reason:'explicit same page'};
  const confirmed=target('secondary',{keyword:'a100 rental',taskRelations:[relation]});
  const candidate=target('unknown',{country:null,language:null,taskIds:[],taskRelations:[{...relation,status:'candidate'}]});
  const html=renderToStaticMarkup(React.createElement(GrowthTargetTable,{data:data([confirmed,candidate]),scope:defaultGrowthScope,targets:[confirmed,candidate]}));
  assert.match(html,/同页原任务 · 原主词：rent gpu server/);assert.match(html,/同页任务线索（市场待核）/);assert.match(html,/不授目标市场或执行批准/);assert.match(html,/尚未确认关联任务/);assert.equal((html.match(/href="\/work\/original-task"/g)||[]).length,2);
});
test("unassigned formal identity shows the existing original-country observation without claiming unqueried or a formal rank", () => {
  const targets=[target("unassigned",{country:null,language:null,wordLanguage:"en",rankEligible:false,rank:null,rankUrl:null,rankSource:null,checkedAt:null,languageStatus:"unknown",languageReason:"目标国家待核，诊断不授长期主国",captureState:"unqueried",relatedObservations:[{country:"US",language:"en",rank:6,url:"https://flatkey.ai/blog/32b-70b-model-vram-guide",source:"serp",checkedAt:"2026-11-23T03:24:56Z",languageStatus:"match"}]})];
  const html=renderToStaticMarkup(React.createElement(GrowthTargetTable,{data:data(targets),scope:defaultGrowthScope,targets}));
  assert.match(html,/目标身份待核/);assert.match(html,/当次查询环境/);assert.match(html,/US.*第.*6.*名/);assert.match(html,/未授长期主国，不计正式抢占/);assert.doesNotMatch(html,/尚未查询|暂无排名证据/);assert.equal(growthCounts(targets).ranked,0);
});

function coverageData() {
  const opportunity = target("opportunity", { membership: "opportunity", rank: 8 });
  return data([target("formal"), opportunity, opportunity,
    target("review", { membership: "review", country: "JP", language: "ja", keyword: "GPUレンタル", rank: 60 }),
    target("database", { membership: "opportunity", rankSource: "database", rankEligible: false, rank: 5 }),
    target("gsc", { membership: "review", rankSource: "gsc", rankEligible: false, rank: 2.5 }),
    target("expired", { membership: "opportunity", rankEligible: false, checkedAt: "2026-10-01T00:00:00Z", rank: 3 }),
    target("unknown-formal", { country: null, language: null, rankEligible: false, rank: null, relatedObservations: [{ country: "US", language: "en", rank: 7, source: "serp", checkedAt: "2026-11-23T00:00:00Z" }] }),
  ]);
}

test("all current ranking observations cross the three pools once and keep background evidence out", () => {
  const workspace = coverageData(), all = growthRankingEvidence(workspace, defaultGrowthScope, "all");
  assert.equal(all.ranked.length, 3); assert.equal(all.uniqueWords, 2); assert.equal(all.ranked.filter(row => row.membership === "formal").length, 1);
  assert.deepEqual(all.background.map(row => row.kind).sort(), ["database", "expired", "gsc"]);
  const formal = growthRankingEvidence(workspace, defaultGrowthScope, "formal");
  assert.equal(formal.targets.length, 2); assert.equal(formal.ranked.length, 1, "unassigned formal related observations do not add another R");
  const jp = growthRankingEvidence(workspace, { ...defaultGrowthScope, country: "JP", language: "ja" }, "all");
  assert.deepEqual(jp.ranked.map(row => row.id), ["review"]);
  assert.equal(growthRankingEvidence(workspace, { ...defaultGrowthScope, site: "rackrate.org" }, "all").ranked.length, 0);
});

test("overview counts original words once and uses the same denominator for both charts", () => {
  readData = coverageData();
  const html = renderToStaticMarkup(React.createElement(GrowthRankingCoverage));
  assert.match(html, /aria-pressed="true">全部有效实测/); assert.match(html, /已获排名关键词/); assert.match(html, /2<\/strong>/);
  assert.match(html, /其中前50关键词/); assert.match(html, /其中正式目标词/);
  assert.match(html, /同词跨国、跨站只计一次/); assert.match(html, /50\.0%/); assert.doesNotMatch(html, /66\.7%|33\.3%/);
  assert.match(html, /去重关键词最佳排名（2 个词）/); assert.match(html, /原始有效实测来源（3 个站点／国家组合/);
  assert.match(html, /数据库名次 1/); assert.match(html, /GSC均位 1/); assert.match(html, /过期SERP名次 1/);
  assert.doesNotMatch(html, /目标关键词<\/span>|当前正式目标记录 R\/N/);
  const formal = renderToStaticMarkup(React.createElement(GrowthRankingCoverage, { initialView: "formal" }));
  assert.match(formal, /aria-pressed="true">正式目标实测/); assert.match(formal, /当前正式目标记录 R\/N：1 \/ 1（100\.0%）/);
  readData = null;
});


test("quarter execution contains the exact approved TopicMap list and never displays discovery queues or graph", () => {
 const workspace = data([target("quarter-a"), target("alias", {keyword:"GPU RENTAL"}), target("not-selected", {keyword:"unselected formal"}), target("outside", {keyword:"discovered phrase",membership:"opportunity"}), target("review", {keyword:"unconfirmed phrase",membership:"review"})]);
 workspace.quarter={targetIds:["quarter-a"],keywordCount:1,hash:"reviewed-quarter"};
 const before=JSON.stringify(workspace), selected=quarterTargetWorkspace(workspace);
 assert.deepEqual(selected.targets.map(row=>row.id),["quarter-a"]);assert.equal(JSON.stringify(workspace),before);
 readData=workspace;
 const html=renderToStaticMarkup(React.createElement(GrowthTopicWorkspace));
 assert.match(html,/GPU计算/);assert.doesNotMatch(html,/规划外机会|待核归属|关键词规划归属|个话题簇/);assert.doesNotMatch(html,/discovered phrase|unconfirmed phrase/);
 assert.equal((html.match(/<h2>业务词库关系图<\/h2>/g)||[]).length,0);
});


test("an unfrozen quarter never falls back to the formal inventory or labels it as current quarterly progress", () => {
 const workspace=data([target("unreviewed-base")]); delete workspace.quarter;
 assert.deepEqual(quarterTargetWorkspace(workspace).targets,[]);
 readData=workspace;
 const html=renderToStaticMarkup(React.createElement(GrowthTopicWorkspace));
 assert.match(html,/季度1600词清单尚未审核冻结/); assert.doesNotMatch(html,/当前筛选没有季度话题/);
 readData=null;
});
