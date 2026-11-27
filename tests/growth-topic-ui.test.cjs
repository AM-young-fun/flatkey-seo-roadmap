const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), originalLoad = Module._load;
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
let readData = null;
let catalogRequest;
Module._load = function(name, parent, ...rest) {
  if (name === "./AppLink") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
  if (name === "./PageHeader") return { PageHeader: () => null };
  if (name === "./UiSelect") return { UiSelect: props => React.createElement("select", { "aria-label": props["aria-label"], defaultValue: props.value },
    props.options.map(option => React.createElement("option", { key: option.value, value: option.value }, option.label))) };
  if (name === "./FeedbackButton") return { FeedbackButton: ({ children }) => React.createElement("button", null, children) };
  if (name === "./useSeoAnalytics") return {
    useSeoRead: url => {
      if (url?.includes("view=keywords")) {
        catalogRequest = new URL(url, "https://seo.example");
        return { data: null };
      }
      if (!readData || !url?.includes("view=published")) return { data: readData };
      return { data: require("../src/lib/growth-keyword-inventory.ts").publishedKeywordWords(readData, [], defaultGrowthScope, 1, "all") };
    },
    useOverviewRead: url => ({ data: readData && url?.includes("view=quarter")
      ? require("../src/lib/growth-quarter-page.ts").growthQuarterPage(readData, { scope: defaultGrowthScope, page: 1, related: false }) : null })
  };
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  return originalLoad.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
const { defaultGrowthScope, readGrowthScope, growthCounts, selectGrowthTargets, growthRankKind, growthRankText, growthLink, growthTopicTargets, growthRelatedTargets, growthRankingEvidence, quarterTargetWorkspace } = require("../src/components/growth-topic-view.ts");
const { GrowthTopicClusters, GrowthTargetTable, GrowthTopicWorkspace, GrowthTopicContributionCells } = require("../src/components/GrowthTopicWorkspace.tsx");
const { OverviewKeywordProgress } = require("../src/components/OverviewGrowthCharts.tsx");
const { summarizeOverviewKeywords } = require("../src/lib/overview-summary.ts");
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
  assert.match(html, /role="button"[^>]*aria-label="放大话题 GPU计算"/);
  assert.doesNotMatch(html, /href="[^"]*target=word-0/);
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
  const summary = summarizeOverviewKeywords(coverageData());
  const html = renderToStaticMarkup(React.createElement(OverviewKeywordProgress, { growth: { data: summary }, ranking: { data: summary } }));
  assert.match(html, /前 100 关键词/); assert.match(html, /2<\/strong>/);
  assert.match(html, /其中前 50/);
  assert.equal((html.match(/2 个已确认前 100 原词/g) ?? []).length, 2);
  assert.match(html, /同一个词只计一次/); assert.match(html, /50\.0%/); assert.doesNotMatch(html, /66\.7%|33\.3%/);
  assert.doesNotMatch(html, /汇总时点|个当前有效原词，|统计采用 14 天/);
  assert.doesNotMatch(html, /去重关键词最佳排名|原始有效实测来源|背景证据：/);
  assert.doesNotMatch(html, /排名统计范围|其中正式目标词|正式目标实测/);
  assert.doesNotMatch(html, /查看话题与关键词/);
  assert.doesNotMatch(html, /目标关键词<\/span>|当前正式目标记录 R\/N/);
  readData = null;
});


test("quarter execution contains the exact approved TopicMap list and never displays discovery queues or graph", () => {
 const workspace = data([target("quarter-a"), target("alias", {keyword:"GPU RENTAL"}), target("not-selected", {keyword:"unselected formal"}), target("outside", {keyword:"discovered phrase",membership:"opportunity"}), target("review", {keyword:"unconfirmed phrase",membership:"review"})]);
 workspace.quarter={targetIds:["quarter-a"],keywordCount:1,hash:"reviewed-quarter"};
 const before=JSON.stringify(workspace), selected=quarterTargetWorkspace(workspace);
 assert.deepEqual(selected.targets.map(row=>row.id),["quarter-a"]);assert.equal(JSON.stringify(workspace),before);
 readData=workspace;
 const html=renderToStaticMarkup(React.createElement(GrowthTopicWorkspace));
 assert.match(html,/GPU计算/);assert.doesNotMatch(html,/规划外机会|待核归属|关键词规划归属|个话题簇/);assert.doesNotMatch(html,/discovered phrase|unconfirmed phrase|查看季度审核与方向决定|打开季度审核/);
 assert.equal((html.match(/<h2>业务词库关系图<\/h2>/g)||[]).length,0);
});


test("an unfrozen quarter never falls back to the formal inventory or labels it as current quarterly progress", () => {
 const workspace=data([target("unreviewed-base")]); delete workspace.quarter;
 assert.deepEqual(quarterTargetWorkspace(workspace).targets,[]);
 readData=workspace;
 const html=renderToStaticMarkup(React.createElement(GrowthTopicWorkspace));
 assert.match(html,/季度词目标尚未冻结/); assert.doesNotMatch(html,/当前筛选没有季度话题|打开季度审核|季度关键词与方向决定/);
 readData=null;
});

test("quarter detail sends ten matching rows and preserves full stats, filters and exact deep links", () => {
  const rows = Array.from({ length: 27 }, (_, index) => target("keyword-" + index, { keyword: "GPU rental " + index, country: index < 23 ? "US" : "JP" }));
  const { growthQuarterPage } = require("../src/lib/growth-quarter-page.ts");
  const workspace = data(rows);
  const scope = { ...defaultGrowthScope, country: "US" };
  const first = growthQuarterPage(workspace, { scope, topicId: topic.topicId, page: 1, related: false });
  const second = growthQuarterPage(workspace, { scope, topicId: topic.topicId, page: 2, related: false });
  const linked = growthQuarterPage(workspace, { scope, topicId: topic.topicId, page: 1, related: false, selected: "keyword-22" });
  assert.equal(first.data.targets.length, 10);
  assert.deepEqual(second.data.targets.map(row => row.id), rows.slice(10, 20).map(row => row.id));
  assert.equal(second.stats.total, 23);
  assert.equal(linked.pagination.page, 3);
  assert.equal(linked.data.targets.length, 3);
  assert.equal(linked.frozen, true);
  assert.deepEqual(Object.keys(linked.data).sort(), ["generatedAt", "markets", "sites", "targets", "topics"]);
  assert.equal(growthQuarterPage(workspace, { scope, page: 1, related: false }).data.targets.length, 0);
});

test("existing-content inventory preserves exact pages and prioritizes verified absence over ranked and unknown", () => {
  const { growthKeywordInventoryPage, publishedKeywordRank } = require("../src/lib/growth-keyword-inventory.ts");
  const { growthQuarterPage } = require("../src/lib/growth-quarter-page.ts");
  const ranked = target("ranked", { keyword: "GPU rental", wordLanguage: "en", publishedUrls: ["https://www.flatkey.ai/gpu/#details", "https://flatkey.ai/another"] });
  const absent = target("absent", { keyword: "GPU rental quote", rank: null, captureState: "outside100", rankEligible: false, observationEligible: true });
  const stale = { ...absent, id: "stale", keyword: "GPU rental price", checkedAt: "2026-10-01T00:00:00Z" };
  const unknown = target("unknown", { keyword: "GPU cloud server", rank: null, rankEligible: false, observationEligible: false, captureState: "unqueried" });
  const planned = target("only-planned", { keyword: "GPU rental service", maintenancePublishedUrls: [], pageState: "planned", rankEligible: false });
  const discovery = target("discovery", { keyword: "GPU rental period", membership: "opportunity", publishedUrls: [] });
  const workspace = data([ranked, stale, unknown, absent, planned, discovery]);
  const before = JSON.stringify(workspace);
  assert.equal(publishedKeywordRank(ranked, workspace.generatedAt, "https://flatkey.ai/gpu"), "ranked");
  assert.equal(publishedKeywordRank(ranked, workspace.generatedAt, "https://flatkey.ai/another"), "pending");
  assert.equal(publishedKeywordRank(ranked, workspace.generatedAt, "https://flatkey.ai/unpublished"), null);
  const existing = growthKeywordInventoryPage(workspace, defaultGrowthScope, 1, "published");
  assert.deepEqual(existing.data.targets.map(row => row.id), ["absent", "ranked", "discovery", "stale", "unknown"]);
  assert.deepEqual(existing.counts, { outside100: 1, ranked: 2, pending: 2 });
  assert.equal(growthKeywordInventoryPage(workspace, defaultGrowthScope, 1, "keywords").originalWordCount, 6);
  assert.equal(growthKeywordInventoryPage(workspace, defaultGrowthScope, 1, "published", "outside100").pagination.total, 1);
  const quarter = growthQuarterPage(workspace, { scope: defaultGrowthScope, topicId: topic.topicId, page: 1, related: false, newOnly: true, selected: ranked.id });
  assert.equal(quarter.frozenTotal, 5);
  assert.deepEqual(quarter.data.targets.map(row => row.id), [planned.id]);
  assert.equal(quarter.selectedPublished.keyword, ranked.keyword);
  assert.equal(JSON.stringify(workspace), before);
  readData = workspace;
  try {
    const html = renderToStaticMarkup(React.createElement(GrowthTopicWorkspace, { initialTab: "published" }));
    assert.match(html, /全部关键词[\s\S]*季度关键词[\s\S]*近期热点词[\s\S]*已有内容与排名/);
    assert.match(html, /<select aria-label="排名"[\s\S]*已有有效排名[\s\S]*已核实未进前100[\s\S]*排名待核/);
    assert.match(html, /先核验原词与已上线页面的搜索意图/);
    assert.match(html, /https:\/\/flatkey.ai\/gpu/);
    assert.doesNotMatch(html, /已有内容与排名视图|11 月第 2 期实测|\/work\/original-task/);
  } finally { readData = null; }
});

test("catalog overview counts exactly the three visible groups and groups linked pages once per original word", () => {
  const { catalogWorkspace, growthKeywordCatalog } = require("../src/lib/growth-keyword-catalog.ts");
  const { publishedKeywordWords } = require("../src/lib/growth-keyword-inventory.ts");
  const absent = { pageState: "unmapped", publishedUrls: [], rank: null, rankEligible: false, workState: "planned" };
  const quarter = target("quarter", { ...absent, keyword: "planned quarter term" });
  const published = target("published", { keyword: "GPU rental", wordLanguage: "en" });
  const alias = target("alias", { ...absent, keyword: "ＧＰＵ rental", country: "JP", language: "ja",
    pageState: "published", publishedUrls: ["https://flatkey.ai/ja/gpu"] });
  const candidate = target("unused", { ...absent, keyword: "unused candidate", membership: "review" });
  const hotspot = { keyword: "new GPU launch", site: "flatkey.ai", country: "US", language: "en", topicId: "topic/1", stage: "scheduled", taskIds: [] };
  const capture = [
    { keyword: "gpu rental", country: "US", language: "en", bestRank: 10, checkedAt: "2026-11-21T00:00:00Z", pages: [{ rank: 10, url: "https://flatkey.ai/gpus" }] },
    { keyword: "old published keyword", country: "US", language: "en", bestRank: 63, checkedAt: "2026-11-21T00:00:00Z", pages: [{ rank: 63, url: "https://flatkey.ai/blog/older" }] },
  ];
  const workspace = data([quarter, published, alias, candidate]);
  workspace.quarter.targetIds = [quarter.id];
  const overview = catalogWorkspace(workspace, [hotspot], capture);
  const rows = growthKeywordCatalog({ rows: [quarter] }, [hotspot], workspace, capture, "", 1).rows;
  assert.deepEqual(new Set(overview.targets.map(row => row.keyword.normalize("NFKC").toLowerCase())), new Set(rows.map(row => row.keyword.toLowerCase())));
  const list = publishedKeywordWords(workspace, capture, defaultGrowthScope, 1, "all");
  assert.equal(list.pagination.total, 2);
  assert.deepEqual(list.rows[0].urls, ["https://flatkey.ai/gpu", "https://flatkey.ai/gpus", "https://flatkey.ai/ja/gpu"]);
  assert.equal(list.rows[0].best.position, 22);
  assert.equal(list.rows[1].best.historical, true);
  assert.equal(publishedKeywordWords(workspace, capture, defaultGrowthScope, 1, "top100").pagination.total, 1);
  assert.equal(publishedKeywordWords(workspace, capture, { ...defaultGrowthScope, country: "JP" }, 1, "pending").pagination.total, 1);
  const html = renderToStaticMarkup(React.createElement(GrowthTopicClusters, { data: overview, scope: defaultGrowthScope, targets: overview.targets }));
  assert.match(html, /4 个关键词/);
  assert.match(html, /data-kind="top100"/);
});

test("the keyword catalog loads the linked keyword on its first request", async () => {
  const { default: OpportunitiesPage } = require("../src/app/opportunities/page.tsx");
  const element = await OpportunitiesPage({ searchParams: Promise.resolve({ tab: "keywords", q: "GPU API pricing" }) });
  const html = renderToStaticMarkup(element);
  assert.match(html, /value="GPU API pricing"/);
  assert.equal(catalogRequest.searchParams.get("q"), "GPU API pricing");
  assert.equal(catalogRequest.searchParams.get("page"), "1");
});

test("keyword lookup resolves full URLs and partial routes to saved site-topic links without mixing same-word sites", () => {
  const { growthKeywordCatalog } = require("../src/lib/growth-keyword-catalog.ts");
  const { publishedKeywordWords } = require("../src/lib/growth-keyword-inventory.ts");
  const flat = target("flat", { keyword: "GPU rental providers", publishedUrls: ["https://flatkey.ai/blog/gpu-rental"], rankUrl: "https://flatkey.ai/blog/gpu-rental" });
  const rack = target("rack", { keyword: flat.keyword, site: "rackrate.org", topicId: "rack-prices", topicName: "云 GPU 费率",
    publishedUrls: ["https://rackrate.org/blog/gpu-rental"], rankUrl: "https://rackrate.org/blog/gpu-rental" });
  const workspace = data([flat, rack]);
  const all = search => growthKeywordCatalog(null, [], workspace, [], search, 1).rows;
  const published = search => publishedKeywordWords(workspace, [], { ...defaultGrowthScope, search }, 1, "all").rows;
  for (const lookup of [all, published]) {
    const [exact] = lookup("https://www.flatkey.ai/blog/gpu-rental/?utm_source=test#details");
    assert.deepEqual(exact.topics.map(row => row.site), ["flatkey.ai"]);
    assert.deepEqual(exact.urls, flat.publishedUrls);
    assert.deepEqual(lookup("/blog/gpu-ren")[0].topics.map(row => row.site).sort(), ["flatkey.ai", "rackrate.org"]);
    assert.equal(lookup("providers gpu")[0].keyword, flat.keyword);
    assert.equal(lookup("evil.example/blog/gpu-rental").length, 0);
    assert.equal(lookup("https://flatkey.ai/console").length, 0);
  }
});

test("keyword rank sorting happens before pagination and leaves unknown ranks last", () => {
  const { publishedKeywordWords } = require("../src/lib/growth-keyword-inventory.ts");
  const fixture = [target("a", { keyword: "a ranked", rank: 58, wordLanguage: "en" }), target("z", { keyword: "z ranked", rank: 3, wordLanguage: "en" }),
    target("b", { keyword: "b unknown", rank: null, rankEligible: false })];
  const values = order => publishedKeywordWords(data(fixture), [], defaultGrowthScope, 1, "all", order).rows.map(row => row.best?.position ?? null);
  assert.deepEqual(values("asc"), [3, 58, null]);
  assert.deepEqual(values("desc"), [58, 3, null]);
});
