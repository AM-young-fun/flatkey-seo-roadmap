const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), originalLoad = Module._load;
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
Module._load = function(name, parent, ...rest) {
  if (name === "./AppLink") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
  if (name === "./PageHeader") return { PageHeader: () => null };
  if (name === "./UiSelect") return { UiSelect: () => null };
  if (name === "./FeedbackButton") return { FeedbackButton: () => null };
  if (name === "./useSeoAnalytics") return { useSeoRead: () => ({ data: null }) };
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  return originalLoad.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
const { defaultGrowthScope, readGrowthScope, growthCounts, selectGrowthTargets, growthRankKind, growthRankText, growthLink, growthTopicTargets, growthRelatedTargets } = require("../src/components/growth-topic-view.ts");
const { GrowthTopicClusters, GrowthTargetTable } = require("../src/components/GrowthTopicWorkspace.tsx");
const target = (id, patch = {}) => ({ id, keywordId: id, keyword: "GPU rental", site: "flatkey.ai", topicId: "topic/1", topicName: "GPU计算", country: "US", language: "en", membership: "formal", pageState: "published", workState: "completed", publishedUrls: ["https://flatkey.ai/gpu"], plannedUrls: [], rank: 22, rankSource: "serp", rankUrl: "https://flatkey.ai/gpu", checkedAt: "2026-11-23T00:00:00Z", languageStatus: "match", languageReason: "", captureState: "ranked", rankEligible: true, taskIds: ["original-task"], reason: "", ...patch });
const topic = { id: "flatkey.ai:topic/1", site: "flatkey.ai", topicId: "topic/1", name: "GPU计算", parentIds: [], formalCount: 3, markets: [] };
const data = targets => ({ targets, topics: [topic], markets: [{ country: "US", language: "en", label: "美国 · 英语" }, { country: "JP", language: "ja", label: "日本 · 日语" }], sites: [{ domain: "flatkey.ai", name: "Flatkey", keywordGoals: true }] });

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
  assert.match(html, /1 个目标/); assert.match(html, /2 个话题簇/); assert.match(html, /另有关联 1 词/);
});

test("parent topics without direct words include descendant primary targets once across a multi-parent DAG", () => {
  const parent = { ...topic, topicId: "parent", id: "parent", targetIds: [] };
  const a = { ...topic, topicId: "a", id: "a", parentIds: ["parent"] };
  const b = { ...topic, topicId: "b", id: "b", parentIds: ["parent"] };
  const child = { ...topic, topicId: "child", id: "child", parentIds: ["a", "b"] };
  const targets = [target("one", { topicId: "child" }), target("two", { topicId: "a" })];
  const workspace = { ...data(targets), topics: [parent, a, b, child] };
  assert.equal(growthTopicTargets(workspace.topics, parent, targets).length, 2);
  assert.equal(selectGrowthTargets(workspace, defaultGrowthScope, parent).length, 2);
  assert.equal(selectGrowthTargets(workspace, { ...defaultGrowthScope, search: "GPU计算" }, parent).length, 2);
  // A malformed cycle remains readable and cannot multiply the target count.
  parent.parentIds = ["child"];
  assert.equal(growthTopicTargets(workspace.topics, parent, targets).length, 2);
  const html = renderToStaticMarkup(React.createElement(GrowthTopicClusters, { data: workspace, scope: defaultGrowthScope, targets }));
  assert.match(html, /4 个话题簇/); assert.match(html, /主归属 0 词 · 含子话题 2 词/);
  assert.match(html, /总量按目标身份去重/);
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

test("cluster collapse discloses complete target total and routes nodes into the same topic", () => {
  const targets = Array.from({ length: 27 }, (_, index) => target(`word-${index}`));
  const html = renderToStaticMarkup(React.createElement(GrowthTopicClusters, { data: data(targets), scope: defaultGrowthScope, targets }));
  assert.match(html, /27 个目标/); assert.match(html, /查看全部 27 词/); assert.match(html, /图中预览 24 词/);
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
test("unassigned formal identity shows the existing original-country observation without claiming unqueried or a formal rank", () => {
  const targets=[target("unassigned",{country:null,language:null,wordLanguage:"en",rankEligible:false,rank:null,rankUrl:null,rankSource:null,checkedAt:null,languageStatus:"unknown",languageReason:"目标国家待核，诊断不授长期主国",captureState:"unqueried",relatedObservations:[{country:"US",language:"en",rank:6,url:"https://flatkey.ai/blog/32b-70b-model-vram-guide",source:"serp",checkedAt:"2026-11-23T03:24:56Z",languageStatus:"match"}]})];
  const html=renderToStaticMarkup(React.createElement(GrowthTargetTable,{data:data(targets),scope:defaultGrowthScope,targets}));
  assert.match(html,/目标身份待核/);assert.match(html,/当次查询环境/);assert.match(html,/US.*第.*6.*名/);assert.match(html,/未授长期主国，不计正式抢占/);assert.doesNotMatch(html,/尚未查询|暂无排名证据/);assert.equal(growthCounts(targets).ranked,0);
});
