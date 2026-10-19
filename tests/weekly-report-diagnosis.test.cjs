const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { diagnoseWeeklyReport, checkWeeklyReportPage } = require("../src/lib/weekly-report-diagnosis.ts");
const now = new Date("2026-10-19T04:00:00Z");
const traffic = (overrides = {}) => ({ current: { newUsers: 100, newRegistrations: 10 }, previous: { newUsers: 100, newRegistrations: 10 }, comparable: true,
  currentSites: ["flatkey.ai"], previousSites: ["flatkey.ai"], siteTraffic: [], ...overrides });
const rankings = (overrides = {}) => ({ previous: 100, current: 50, entered: 0, removed: 50, net: -50,
  buckets: [], pageLosses: [{ url: "https://flatkey.ai/model", lost: 30, declined: 0, keywords: ["model api"], regions: ["US"], reasons: ["本期报告未检出"] }],
  pageGains: [], unattributed: 20, comparedMarkets: 12, ...overrides });

test("normal small fluctuations never run extra page checks", async () => {
  const result = await diagnoseWeeklyReport(traffic(), rankings({ current: 99, removed: 1, net: -1, pageLosses: [] }), "2026-10-12", { now, checkPage: () => assert.fail("unneeded fetch") });
  assert.equal(result.significant, false); assert.deepEqual(result.findings, []);
});

test("large ranking drops inspect the concentrated pages and keep source coverage gaps explicit", async () => {
  const checked = [];
  const result = await diagnoseWeeklyReport(traffic(), rankings({ comparedMarkets: 1 }), "2026-10-12", { now, checkPage: async url => {
    checked.push(url); return { url, checkedAt: now.toISOString(), findings: [{ title: "页面返回 HTTP 404", evidence: "404", action: "恢复页面", level: "issue", url }] };
  } });
  assert.equal(result.significant, true); assert.deepEqual(checked, ["https://flatkey.ai/model"]);
  assert.ok(result.findings.some(row => row.title === "历史数据覆盖不完整"));
  assert.ok(result.findings.some(row => row.title === "页面返回 HTTP 404"));
  assert.match(result.findings.find(row => row.title === "排名下降集中页面").evidence, /本期报告未检出/);
});

test("large traffic changes identify the site without inventing SEO attribution", async () => {
  const result = await diagnoseWeeklyReport(traffic({ current: { newUsers: 200, newRegistrations: 12 }, siteTraffic: [
    { siteDomain: "flatkey.ai", current: { newUsers: 200, newRegistrations: 12 }, previous: { newUsers: 100, newRegistrations: 10 } },
  ] }), null, "2026-10-12", { now });
  assert.equal(result.significant, true);
  assert.match(result.findings[0].evidence, /flatkey.ai：新用户 \+100/);
  assert.match(result.findings[0].action, /全渠道汇总不足以认定/);
  const incomparable = await diagnoseWeeklyReport(traffic({ comparable: false, current: { newUsers: 0, newRegistrations: 0 } }), null, "2026-10-12", { now });
  assert.equal(incomparable.significant, false);
});

test("old periods never use current page availability as their historical root cause", async () => {
  const result = await diagnoseWeeklyReport(traffic(), rankings(), "2026-08-01", { now, checkPage: () => assert.fail("cannot audit past state using a current page") });
  assert.ok(result.findings.every(row => row.title !== "页面返回 HTTP 404"));
});

test("public-page checks detect HTTP, robots and canonical evidence with anonymous bounded requests", async () => {
  const missing = await checkWeeklyReportPage("https://flatkey.ai/model", { now, fetch: async (_url, init) => {
    assert.equal(init.redirect, "manual"); assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers.Cookie, undefined);
    return new Response("missing", { status: 404 });
  } });
  assert.equal(missing.findings[0].title, "页面返回 HTTP 404");
  const blocked = await checkWeeklyReportPage("https://flatkey.ai/model", { now, fetch: async () => new Response(`<head><meta content="noindex, follow" name="robots"><link href="/other" rel="canonical"></head>`) });
  assert.deepEqual(blocked.findings.map(row => row.title), ["页面禁止搜索收录", "canonical 指向其他页面"]);
  const example = await checkWeeklyReportPage("https://flatkey.ai/model", { now, fetch: async () => new Response(`<head><script>const x='<meta name="robots" content="noindex">';</script><!-- <meta name="robots" content="noindex"> --><link rel="canonical" href="https://flatkey.ai/model/"></head>`) });
  assert.deepEqual(example.findings, []);
});

test("page audits never follow untrusted redirects or fetch unapproved addresses", async () => {
  let requests = 0;
  const redirected = await checkWeeklyReportPage("https://flatkey.ai/model", { now, fetch: async () => { requests++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }); } });
  assert.equal(requests, 1); assert.equal(redirected.findings[0].title, "页面跳转异常");
  for (const url of ["http://127.0.0.1/", "https://flatkey.ai.evil.example/", "https://flatkey.ai:8443/", "https://secret@flatkey.ai/", "javascript:alert(1)"]) {
    await checkWeeklyReportPage(url, { now, fetch: () => assert.fail("unsafe address") });
  }
});

test("a clean page check reports only what was checked and does not invent an algorithm update", async () => {
  const result = await diagnoseWeeklyReport(traffic(), rankings(), "2026-10-12", { now, checkPage: async url => ({ url, checkedAt: now.toISOString(), findings: [] }) });
  const finding = result.findings.find(row => row.title === "暂未发现页面访问或收录指令异常");
  assert.equal(finding.level, "unresolved"); assert.match(finding.action, /尚不能确认/);
  assert.ok(result.findings.every(row => !/算法更新|惩罚/.test(row.title + row.evidence)));
});
