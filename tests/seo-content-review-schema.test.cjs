const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const client = require("../scripts/lib/seo-content-review-schema.cjs"), server = require("../src/lib/seo-workflow.ts");
const evidence = [{ label: "真实来源", artifact: "/tmp/source.json", observedAt: "2026-11-19T10:00:00Z" }];
const task = () => ({ id: "schema-task", weekStart: "2026-11-23", title: "客户端合同核验", siteDomain: "flatkey.ai", channel: "website",
  kind: "research", country: null, language: null, business: "API", pageType: "other", keyword: null, pageUrl: "https://flatkey.ai/docs",
  owner: "SEO/AI", dueAt: "2026-11-23T10:00:00+08:00", status: "planned", dependencies: [], evidence, nextAction: "保留原任务等待补证",
  contentVersion: null, acceptanceCriteria: ["真实读回任务"], source: "automation" });
const issue = () => ({ id: "schema-issue", weekStart: "2026-11-23", siteDomain: "flatkey.ai", pageUrl: "https://flatkey.ai/docs", title: "数据核对",
  category: "data", priority: "P1", status: "investigating", owner: "SEO/AI", taskId: "schema-task", firstSeenAt: "2026-11-19T10:00:00Z",
  impact: "保留实际数据缺口", nextAction: "核对真实来源", evidence, resolvedAt: null, resolutionEvidence: [] });
function parity(kind, input) {
  const a = client[kind].safeParse(structuredClone(input)), b = server[kind].safeParse(structuredClone(input));
  assert.equal(a.success, b.success);
  if (a.success) assert.deepEqual(a.data, b.data); else assert.deepEqual(a.error.issues, b.error.issues);
  return a.success;
}

test("versioned client contract exactly matches the selected current server schema source", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/seo-workflow.ts"), "utf8");
  const names = new Set(["WORKFLOW_SITES", "WORKFLOW_MARKETS", "WORKFLOW_SITE_LANGUAGES", "workflowContentLanguages", "WORKFLOW_STATUSES", "workflowRecordIdSchema", "id", "stamp", "workflowWeekSchema", "site", "country", "language", "httpsUrl", "workflowEvidenceSchema", "evidence", "taskProgress", "approval", "research", "workflowCodeSourceSchema", "workflowTaskSchema", "workflowIssueSchema", "githubReviewBelongsToSite", "pageBelongsToSite", "productReviewBelongsToSite", "shiftWorkflowDay"]);
  const ast = ts.createSourceFile("workflow.ts", source, ts.ScriptTarget.Latest, true);
  const chunks = ast.statements.filter(node => ts.isVariableStatement(node) ? node.declarationList.declarations.some(row => names.has(row.name.getText(ast)))
    : ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(ast));
  assert.equal(chunks.length, names.size, "update the explicit client contract dependency list");
  const marketSource = fs.readFileSync(path.join(__dirname, "../src/lib/seo-growth-markets.ts"), "utf8");
  const marketAst = ts.createSourceFile("markets.ts", marketSource, ts.ScriptTarget.Latest, true);
  const marketNames = new Set(["GROWTH_MARKET_LANGUAGES", "GROWTH_LANGUAGES", "GROWTH_COUNTRIES"]);
  const marketChunks = marketAst.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(row => marketNames.has(row.name.getText(marketAst)))).map(node => node.getText(marketAst));
  const maintenanceSource = fs.readFileSync(path.join(__dirname, "../src/lib/seo-maintenance.ts"), "utf8");
  const maintenanceAst = ts.createSourceFile("maintenance.ts", maintenanceSource, ts.ScriptTarget.Latest, true);
  const maintenanceNames = new Set(["MAINTENANCE_VERSION", "maintenanceWorkClassSchema", "stamp", "timezone", "text", "url", "proof", "TECHNICAL_AREAS", "area", "technicalCheck", "relation", "maintenancePlanSchema"]);
  const maintenanceChunks = maintenanceAst.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(row => maintenanceNames.has(row.name.getText(maintenanceAst)))).map(node => node.getText(maintenanceAst));
  assert.equal(maintenanceChunks.length, maintenanceNames.size);
  const maintenanceBlock = 'const { maintenanceWorkClassSchema, maintenancePlanSchema } = (() => {\n' + maintenanceChunks.join('\n') + '\nreturn { maintenanceWorkClassSchema, maintenancePlanSchema };\n})();';
  const contract = [...marketChunks, maintenanceBlock, ...chunks].join("\n");
  assert.equal(crypto.createHash("sha256").update(contract).digest("hex"), client.SOURCE_CONTRACT_SHA256);
  const generated = ts.transpileModule('const { z } = require("zod");\n' + contract.replace(/^export /gm, ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/^"use strict";\n/u, "").trim();
  const actual = fs.readFileSync(path.join(__dirname, "../scripts/lib/seo-content-review-schema.cjs"), "utf8");
  assert.equal(actual.slice(actual.indexOf('const { z } = require("zod");'), actual.indexOf("// BEGIN TASK BRIEF CLIENT CONTRACT")).trim(), generated);
  assert.equal(client.CLIENT_CONTRACT_VERSION, "seo-content-review-growth-v15");
  assert.deepEqual(Object.keys(client.workflowTaskSchema.shape), Object.keys(server.workflowTaskSchema.shape));
  assert.deepEqual(Object.keys(client.workflowIssueSchema.shape), Object.keys(server.workflowIssueSchema.shape));
});

test("maintenance fields round-trip without reclassifying legacy records", () => {
  const legacy = { ...task(), kind: "optimization", pageType: "blog", country: "US", language: "en", keyword: "model pricing", pageUrl: "https://flatkey.ai/blog/model-pricing" };
  assert.equal(parity("workflowTaskSchema", legacy), true);
  assert.equal(Object.hasOwn(client.workflowTaskSchema.parse(legacy), "workClass"), false);
  const record = { ...legacy, workClass: "content_refresh", maintenance: { version: "seo-maintenance-v1", refresh: {
    reason: "outdated_facts", baselineId: "original-baseline", originalPublishedAt: "2026-10-01T00:00:00Z", baseContentVersion: "original-v1",
    changes: ["按原始价格证据修正已经过时的计算示例"], evidence: [{ observedAt: evidence[0].observedAt, source: "/tmp/official-pricing.json", finding: "官方价格说明与原文章计算示例存在明确差异" }],
  } } };
  assert.equal(parity("workflowTaskSchema", record), true);
  for (const workClass of ["internal_linking", "technical_seo"]) assert.equal(parity("workflowTaskSchema", { ...legacy, workClass }), true);
  assert.equal(parity("workflowTaskSchema", { ...legacy, workClass: "unapproved_class" }), false);
  assert.equal(parity("workflowTaskSchema", { ...record, maintenance: { ...record.maintenance, refresh: { ...record.maintenance.refresh, reason: "decline" } } }), false);
  const trend = { source: "GA4", timezone: "invalid-timezone", metric: "sessions", beforeStart: "2026-09-01", beforeEnd: "2026-09-28", afterStart: "2026-09-29", afterEnd: "2026-10-26", beforeValue: 20, afterValue: 10, observedAt: evidence[0].observedAt, sourceEvidence: "/tmp/whole-trend.json" };
  assert.equal(parity("workflowTaskSchema", { ...record, maintenance: { ...record.maintenance, refresh: { ...record.maintenance.refresh, reason: "decline", trend } } }), false);
  assert.equal(parity("workflowTaskSchema", { ...record, maintenance: { ...record.maintenance, refresh: { ...record.maintenance.refresh, reason: "decline", trend: { ...trend, timezone: "America/Los_Angeles" } } } }), true);
});

test("review planning uses the same generated native market and site-language mapping", () => {
  const marketSource = require("../src/lib/seo-growth-markets.ts");
  assert.deepEqual(client.GROWTH_COUNTRIES, marketSource.GROWTH_COUNTRIES);
  assert.deepEqual(client.GROWTH_LANGUAGES, marketSource.GROWTH_LANGUAGES);
  assert.deepEqual(client.GROWTH_MARKET_LANGUAGES, marketSource.GROWTH_MARKET_LANGUAGES);
  assert.deepEqual(client.WORKFLOW_SITE_LANGUAGES["modelfit.cc"], ["en"]);
  assert.deepEqual(client.WORKFLOW_SITE_LANGUAGES["rackrate.org"], ["en"]);
});

test("new-task Chinese brief preflight mirrors the actual server state guard", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/seo-task-brief.ts"), "utf8");
  const ast = ts.createSourceFile("brief.ts", source, ts.ScriptTarget.Latest, true);
  const chunks = ast.statements.filter(node => ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)).map(node => node.getText(ast));
  assert.equal(crypto.createHash("sha256").update(chunks.join("\n")).digest("hex"), client.SOURCE_BRIEF_SHA256);
  const generated = ts.transpileModule(chunks.join("\n").replace(/^export /gm, ""), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^"use strict";\n/u, "").trim();
  const actual = fs.readFileSync(path.join(__dirname, "../scripts/lib/seo-content-review-schema.cjs"), "utf8");
  const start = actual.indexOf('function isChineseTaskProse('), end = actual.indexOf("// END TASK BRIEF CLIENT CONTRACT");
  assert.equal(actual.slice(start, end).trim(), generated);
  const original = require("../src/lib/seo-task-brief.ts");
  const record = { ...task(), brief: { reason: "原周报显示点击上涨，不能把同步变化当作内容改动效果，须先核对来源。", plan: "核对原页面和搜索查询的对应关系", problem: "原查询仍需核对与复算", actions: [{ target: "原页面", change: "核对原查询与目标页面的承接", verify: "保存原始日期和实际页面版本的读回" }], evidence } };
  assert.deepEqual(client.workflowTaskBriefProblems(record), original.workflowTaskBriefProblems(record));
  assert.ok(client.workflowTaskBriefProblems(record).includes("为什么做缺少问题解释或事实限制"));
  record.brief.reason += "现有证据尚不足以确认具体原因。";
  assert.deepEqual(client.workflowTaskBriefProblems(record), original.workflowTaskBriefProblems(record));
  assert.equal(client.taskNeedsChineseBrief(record), original.taskNeedsChineseBrief(record));
});

test("all optional writable task fields survive the standalone client contract", () => {
  const record = { ...task(), kind: "optimization", country: "US", language: "en", keyword: "model api", keywordId: "real-word", pageType: "blog",
    deletedAt: "2026-11-19T10:00:00Z", changeScope: "search_intent", contentVersion: "a".repeat(40), artifactUrl: "https://preview.example.com/docs",
    codeSource: { repository: "flatkey-ai/flatkey", branch: "codex/page-update", commitSha: "a".repeat(40) },
    branchObservation: { headSha: "a".repeat(40), observedAt: "2026-11-19T10:00:00Z" },
    brief: { reason: "保存实际查询来源和具体问题", plan: "保留原方案并补齐证据", problem: "原问题", actions: [{ target: "原页面", change: "补证", verify: "读回" }], evidence },
    progress: [{ id: "checkpoint", sessionId: "original-session", observedAt: "2026-11-19T10:00:00Z", summary: "原进度", nextAction: "继续原工作", evidence }],
    research: { volume: 10, kd: 29, businessValue: 3, exceptionReason: null, intent: "compare", observedAt: "2026-11-19T10:00:00Z", evidence },
    approval: { kind: "explicit", approvedBy: "原审核人", approvedAt: "2026-11-19T10:00:00Z", contentVersion: "a".repeat(40), evidence },
    sourceRowId: "original-source", fallbackReason: "保留历史记录", failureReason: "原失败原因" };
  assert.equal(parity("workflowTaskSchema", record), true);
  for (const channel of ["github", "product"]) {
    const historical = { ...task(), kind: "technical", channel, pageUrl: channel === "github" ? "https://github.com/flatkey-ai/awesome-images" : "https://console.flatkey.ai/models" };
    assert.equal(parity("workflowTaskSchema", historical), true);
  }
  assert.equal(parity("workflowTaskSchema", { ...task(), siteDomain: "modelfit.cc", pageUrl: "https://modelfit.cc/models", country: "BR", language: "en" }), true);
});

test("client and server reject the same malformed, oversized and out-of-scope task fields", () => {
  const invalid = [
    { unsupportedField: "never silently drop" }, { weekStart: "2026-11-24" }, { dueAt: "2026-12-01T10:00:00Z" },
    { dependencies: ["schema-task"] }, { dependencies: ["other", "other"] }, { status: "blocked" },
    { country: "US", language: "ja" }, { kind: "blog" }, { pageUrl: "https://other.example.com/docs" },
    { channel: "github", kind: "technical", pageUrl: "https://github.com/other/repo" },
    { channel: "product", kind: "technical", pageUrl: "https://console.flatkey.ai:9999/models" },
    { nextAction: "x".repeat(3001) }, { evidence: [{ ...evidence[0], unsupportedField: true }] },
    { brief: { reason: "English-only reason", plan: "中文方案" } },
    { progress: [{ id: "p", sessionId: "s", observedAt: evidence[0].observedAt, summary: "原进度", nextAction: "继续", evidence, unknown: true }] },
    { branchObservation: { headSha: "a".repeat(40), observedAt: evidence[0].observedAt } },
  ];
  for (const patch of invalid) assert.equal(parity("workflowTaskSchema", { ...task(), ...patch }), false, JSON.stringify(Object.keys(patch)));
});

test("week and issue validation, defaults, resolution evidence and strict nested limits remain equal", () => {
  assert.equal(parity("workflowWeekSchema", "2026-11-23"), true);
  assert.equal(parity("workflowWeekSchema", "2026-11-24"), false);
  assert.equal(parity("workflowIssueSchema", issue()), true);
  assert.equal(parity("workflowIssueSchema", { ...issue(), status: "resolved", resolvedAt: evidence[0].observedAt, resolutionEvidence: evidence }), true);
  for (const patch of [{ priority: "P9" }, { status: "resolved" }, { extra: true }, { nextAction: "x".repeat(3001) }, { evidence: [{ label: "无来源", observedAt: evidence[0].observedAt }] }]) {
    assert.equal(parity("workflowIssueSchema", { ...issue(), ...patch }), false);
  }
});
