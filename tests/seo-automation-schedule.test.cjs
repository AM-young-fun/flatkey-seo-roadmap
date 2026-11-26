const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), originalLoad = Module._load;
let response = { data: null, error: null, retry() {} };
Module._load = function (name, parent, ...rest) {
  if (name === "./useSeoAnalytics") return { useSeoRead: url => { assert.equal(url, "/api/operations?view=schedule&page=1"); return response; } };
  // Paid review panels have independent data hooks and their own component tests.
  if (name === "./ApprovedKeywordReview") return { ApprovedKeywordReview: () => null };
  if (name === "./ApprovedOtherKeywordReview") return { ApprovedOtherKeywordReview: () => null };
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  return originalLoad.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const { automationSchedulePage, readonlyAutomationPlans, automationDate } = require("../src/lib/seo-automation-schedule.ts");
const config = require("../src/lib/data/seo-automation-config.json");
const { configuredAutomationPlans, nextAutomationTime } = require("../src/lib/operations.ts");
const { SeoAutomationSchedule } = require("../src/components/SeoAutomationSchedule.tsx");
const makeStatus = () => ({
  checkedAt: "2026-11-10T08:10:00Z", automationConfigurationVerifiedAt: config.verifiedAt,
  controls: { enabled: false, emergencyStopped: false, maxRunCostMicros: 0, maxMonthCostMicros: 0, discoveryMaxCostMicros: 0 },
  scheduler: { configured: true, cadence: "每5分钟检查及续跑任务", state: "UNCONFIRMED", lastStartedAt: null, lastCompletedAt: null },
  plans: [
    { id: "rankings", name: "DataForSEO 新词与排名", location: "项目服务器 · Vercel", cadence: "隔周周四 08:00", state: "自动付费未启用", nextAt: "2026-12-03T00:00:00Z", note: "仅按已分配国家查询。" },
    { id: "traffic", name: "五站 GA4 / GSC 与页面台账", location: "GitHub Actions · 服务器采集", cadence: "每日 10:30", state: "服务器定时 · 成功待回执", nextAt: "2026-11-11T02:30:00Z", note: "记录来源日期。" },
    ...configuredAutomationPlans(new Date("2026-11-10T08:10:00Z")),
  ], records: [],
});
const render = () => renderToStaticMarkup(React.createElement(SeoAutomationSchedule));

test("retired executors stay out of current plans while protected automations keep their configured status", () => {
  const plans = configuredAutomationPlans(new Date("2026-11-23T06:00:00Z"));
  const retired = ["seo-09-30", "seo-13-30", "seo-14-30", "seo-15-00", "seo-16-00", "seo-09-00-github-traffic", "seo-09-10-flatkey", "seo-10-00", "seo-10-00-2", "seo-14-00", "seo-16-25", "seo-17-30", "seo-2"];
  for (const id of retired) {
    assert.ok(!config.tasks.some(task => task.id === id), `${id} must not return to the snapshot`);
    assert.ok(!plans.some(plan => plan.id === id));
    assert.ok(!config.verificationScope.includes(id));
  }
  assert.ok(config.tasks.every(task => task.kind === "cron"));
  assert.equal(config.tasks.length, 7);
  for (const id of ["automation-2", "flatkey-5"]) {
    const status = config.tasks.find(task => task.id === id).status;
    assert.ok(["ACTIVE", "PAUSED"].includes(status));
    assert.equal(plans.find(plan => plan.id === id).state.startsWith("配置已启用"), status === "ACTIVE");
  }
  assert.deepEqual(new Set(config.verificationScope), new Set(config.tasks.map(task => task.id)));
});

test("Beijing schedules expose the two workday queues and only one data and report slot", () => {
  const plans = configuredAutomationPlans(new Date("2026-11-21T00:30:00Z")); // Saturday in Beijing.
  for (const id of ["seo-16-00-ga4-search-console", "seo-18-00", "seo"]) {
    const task = config.tasks.find(task => task.id === id);
    const plan = plans.find(plan => plan.id === id);
    assert.equal(task.workdaysOnly, false);
    assert.match(plan.cadence, /^每日 /);
    assert.match(plan.note, /\d{2}:\d{2}/);
    assert.doesNotMatch(plan.note, /真实DST/);
    assert.ok(nextAutomationTime(task.rrule, new Date("2026-11-21T00:30:00Z"), "ACTIVE", task.workdaysOnly).startsWith("2026-11-21"), "candidate wakeups are not proof that business work may run");
    assert.equal(plan.nextAt !== null, task.status === "ACTIVE");
  }
  assert.ok(!config.tasks.some(task => task.id === "seo-09-00-github-traffic"));
  assert.equal(config.tasks.find(task => task.id === "flatkey-5").workdaysOnly, true);
  assert.equal(plans.find(plan => plan.id === "flatkey-5").cadence, "工作日 10:15、14:15");
  assert.match(plans.find(plan => plan.id === "flatkey-5").note, /原ID.*原会话/);
  assert.match(plans.find(plan => plan.id === "seo-16-00-ga4-search-console").note, /三站巡检.*热点/);
  assert.match(plans.find(plan => plan.id === "seo-18-00").dependencies.join(" "), /同日16:00统一数据采集终态回执/);
});

test("next-week preparation finishes before Thursday 16:00 and does not depend on the later weekly report", () => {
  const plans = configuredAutomationPlans(new Date("2026-11-25T06:00:00Z"));
  const finalization = plans.find(plan => plan.id === "automation");
  const weekly = plans.find(plan => plan.id === "seo-09-30-2");
  for (const [plan, date] of [[finalization, "2026-11-26T04:30:00.000Z"], [weekly, "2026-11-26T08:30:00.000Z"]]) {
    const task = config.tasks.find(task => task.id === plan.id);
    assert.equal(nextAutomationTime(task.rrule, new Date("2026-11-25T06:00:00Z"), "ACTIVE", task.workdaysOnly), date);
    assert.equal(plan.nextAt, task.status === "ACTIVE" ? date : null);
  }
  assert.match(finalization.note, /16:00前/);
  assert.doesNotMatch(finalization.name, /周五/);
  assert.ok(finalization.dependencies.includes("生产冻结季度词"));
});

test("paused paid queries have no advertised next execution; resumed and emergency-stopped states stay separate", () => {
  const status = makeStatus();
  let plans = readonlyAutomationPlans(status);
  assert.equal(plans[0].configurationState, "paused"); assert.equal(plans[0].nextConfiguredAt, null);
  assert.equal(plans[1].executionLocation, "server"); assert.equal(plans[1].configurationState, "unknown");
  assert.equal(plans.filter(plan => plan.executionLocation === "computer").length, require("../src/lib/data/seo-automation-config.json").tasks.length);
  status.controls.enabled = true;
  assert.equal(readonlyAutomationPlans(status)[0].nextConfiguredAt, "2026-12-03T00:00:00Z");
  status.controls.emergencyStopped = true;
  assert.equal(readonlyAutomationPlans(status)[0].nextConfiguredAt, null);
  status.plans.push({ id: "future-source", name: "未知计划", location: "未知", cadence: "未知", state: "未知", nextAt: "invalid", note: "" });
  plans = readonlyAutomationPlans(status);
  assert.equal(plans.at(-1).executionLocation, "unknown"); assert.equal(plans.at(-1).nextConfiguredAt, null);
  assert.equal(automationDate(null), "未核实"); assert.equal(automationDate("invalid"), "未核实");
});

test("schedule renders only the requested page and preserves arrangement groups across pages", () => {
  const status = makeStatus();
  for (let i = 1; i <= 4; i++) status.plans.push({ ...status.plans.find(plan => plan.id === "seo"), id: `local-${i}`, name: `额外测试任务 ${i}` });
  const first = automationSchedulePage(status, 1), second = automationSchedulePage(status, 2);
  assert.equal(first.rows.length, 10);
  assert.equal(second.rows.length, status.plans.length + 1 - first.rows.length);
  assert.equal(first.total, status.plans.length + 1);
  assert.deepEqual(automationSchedulePage(status, 99), second);
  assert.ok(first.rows.every(row => row.executionLocation === "computer"));
  const rows = [...first.rows, ...second.rows];
  assert.equal(new Set(rows.map(row => row.id)).size, first.total);
  assert.ok(rows.every(row => row.id !== "seo-10-00-2"));
  assert.deepEqual(Object.keys(first.rows[0]).sort(), ["cadence", "configurationState", "executionLocation", "id", "name"]);
  response = { ...response, data: first, error: null };
  const firstHtml = render();
  assert.match(firstHtml, /Codex 定时任务/);
  assert.doesNotMatch(firstHtml, /服务器定时任务/);
  assert.match(firstHtml, /第 1 \/ 2 页/);
  assert.match(firstHtml, /任务名称/); assert.match(firstHtml, /频率/); assert.match(firstHtml, /北京时间/); assert.match(firstHtml, /启停/);
  response = { ...response, data: second, error: null };
  const secondHtml = render();
  assert.match(secondHtml, /第 2 \/ 2 页/);
  assert.match(secondHtml, /Codex 定时任务/); assert.match(secondHtml, /服务器定时任务/);
  assert.match(secondHtml, /隔周周四/); assert.match(secondHtml, /服务器调度检查与续跑/);
  for (const html of [firstHtml, secondHtml]) {
    assert.doesNotMatch(html, /查看费用|查看回执|开启并执行|暂停新的付费提交|采集与调度回执|最近开始|最近完成|<details|<form|role="switch"/);
    assert.doesNotMatch(html, /周五11:30 钉钉周报/);
    assert.equal((html.match(/<button/g) ?? []).length, 3);
  }
});

test("collection state is read-only and contains no continuation entry", () => {
  const data = makeStatus(); data.controls.enabled = true;
  response = { ...response, data: automationSchedulePage(data, 2), error: null };
  assert.equal(response.data.rows.find(row => row.id === "rankings").configurationState, "enabled");
  assert.match(render(), /已启用/);
  assert.doesNotMatch(render(), /付费|费用|暂停新的付费提交|查看本期/);
  data.controls.emergencyStopped = true;
  response = { ...response, data: automationSchedulePage(data, 2), error: null };
  assert.equal(response.data.rows.find(row => row.id === "rankings").configurationState, "paused");
  assert.doesNotMatch(render(), /付费|费用|暂停新的付费提交|查看本期/);
});

test("failed reads do not invent enabled arrangements or zero runs", () => {
  response = { ...response, data: null, error: "数据源暂不可用" };
  const html = render();
  assert.match(html, /任务安排暂时无法读取/);
  assert.doesNotMatch(html, /已启用|服务器定时|已完成 0|0 项|0 次/);
});

test("actual completion receipts remain outside the arrangements page", () => {
  const data = makeStatus();
  data.scheduler.state = "HEALTHY"; data.scheduler.lastCompletedAt = "2026-11-10T08:00:00Z";
  data.records = [{ id: "check:1", name: "线上调度检查", state: "已完成", startedAt: "2026-11-10T07:59:00Z", completedAt: "2026-11-10T08:00:00Z", detail: "付费提交 0 批" }];
  response = { ...response, data: automationSchedulePage(data, 2), error: null };
  const html = render();
  assert.match(html, /服务器调度检查与续跑/);
  assert.doesNotMatch(html, /最近一次调度检查已完成|付费提交 0 批|2026\/11\/10/);
});
