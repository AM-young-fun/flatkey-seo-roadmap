const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), originalLoad = Module._load;
let response = { data: null, error: null, retry() {} };
Module._load = function (name, parent, ...rest) {
  if (name === "./useSeoAnalytics") return { useSeoRead: url => { assert.equal(url, "/api/operations"); return response; } };
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  return originalLoad.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const { readonlyAutomationPlans, automationDate } = require("../src/lib/seo-automation-schedule.ts");
const { configuredAutomationPlans } = require("../src/lib/operations.ts");
const { SeoAutomationSchedule } = require("../src/components/SeoAutomationSchedule.tsx");
const makeStatus = () => ({
  checkedAt: "2026-11-10T08:10:00Z", automationConfigurationVerifiedAt: "2026-11-10",
  controls: { enabled: false, emergencyStopped: false, maxRunCostMicros: 0, maxMonthCostMicros: 0, discoveryMaxCostMicros: 0 },
  scheduler: { configured: true, cadence: "每5分钟检查及续跑任务", state: "UNCONFIRMED", lastStartedAt: null, lastCompletedAt: null },
  plans: [
    { id: "rankings", name: "DataForSEO 新词与排名", location: "项目服务器 · Vercel", cadence: "隔周周四 08:00", state: "自动付费未启用", nextAt: "2026-12-03T00:00:00Z", note: "仅按已分配国家查询。" },
    { id: "traffic", name: "五站 GA4 / GSC 与页面台账", location: "GitHub Actions · 服务器采集", cadence: "每日 10:30", state: "服务器定时 · 成功待回执", nextAt: "2026-11-11T02:30:00Z", note: "记录来源日期。" },
    ...configuredAutomationPlans(new Date("2026-11-10T08:10:00Z")),
  ], records: [],
});
const render = () => renderToStaticMarkup(React.createElement(SeoAutomationSchedule));

test("paused paid queries have no advertised next execution; resumed and emergency-stopped states stay separate", () => {
  const status = makeStatus();
  let plans = readonlyAutomationPlans(status);
  assert.equal(plans[0].configurationState, "paused"); assert.equal(plans[0].nextConfiguredAt, null);
  assert.equal(plans[1].executionLocation, "server"); assert.equal(plans[1].configurationState, "unknown");
  assert.equal(plans.filter(plan => plan.executionLocation === "computer").length, 14);
  status.controls.enabled = true;
  assert.equal(readonlyAutomationPlans(status)[0].nextConfiguredAt, "2026-12-03T00:00:00Z");
  status.controls.emergencyStopped = true;
  assert.equal(readonlyAutomationPlans(status)[0].nextConfiguredAt, null);
  status.plans.push({ id: "future-source", name: "未知计划", location: "未知", cadence: "未知", state: "未知", nextAt: "invalid", note: "" });
  plans = readonlyAutomationPlans(status);
  assert.equal(plans.at(-1).executionLocation, "unknown"); assert.equal(plans.at(-1).nextConfiguredAt, null);
  assert.equal(automationDate(null), "未核实"); assert.equal(automationDate("invalid"), "未核实");
});

test("readonly schedule renders real configuration source separately from success receipts without paid controls", () => {
  response = { ...response, data: makeStatus(), error: null };
  const html = render();
  assert.match(html, /电脑上的 Codex 任务/); assert.match(html, /服务器采集任务/);
  assert.match(html, /配置核对于 2026-11-10/); assert.match(html, /状态读取于/);
  assert.match(html, /启用不等于已经执行成功/); assert.match(html, /自动付费未启用/);
  assert.match(html, /当前配置暂停，不安排下一次自动执行/);
  assert.match(html, /尚无已保存的采集或调度回执/);
  assert.doesNotMatch(html, /2026\/12\/03|FREQ=|BYHOUR=|<input|<select|<form|role="switch"|开启并执行|账号|API Key/);
  assert.equal((html.match(/<button/g) ?? []).length, 1, "refresh is the only operation");
});

test("failed reads do not fall back to a static enabled snapshot or fabricated zero runs", () => {
  response = { ...response, data: null, error: "数据源暂不可用" };
  const html = render();
  assert.match(html, /任务安排暂时无法读取/); assert.match(html, /启停状态和运行结果暂未知/);
  assert.doesNotMatch(html, /配置已启用|服务器定时|已完成 0|0 项|0 次/);
});

test("recorded completion is displayed only with actual receipt dates and never inferred from healthy scheduling", () => {
  const data = makeStatus();
  data.scheduler.state = "HEALTHY"; data.scheduler.lastCompletedAt = "2026-11-10T08:00:00Z";
  data.records = [{ id: "check:1", name: "线上调度检查", state: "已完成", startedAt: "2026-11-10T07:59:00Z", completedAt: "2026-11-10T08:00:00Z", detail: "付费提交 0 批" }];
  response = { ...response, data, error: null };
  const html = render();
  assert.match(html, /最近一次调度检查已完成/); assert.match(html, /付费提交 0 批/);
  assert.match(html, /不代表付费已开启、全部关键词已采集/); assert.match(html, /自动付费未启用/);
});
