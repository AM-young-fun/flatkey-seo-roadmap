const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { summarizeReportTechnical } = require("../src/lib/seo-report-technical-summary.ts");

test("a completed weekly sample keeps its scope caveats out of the concise result", () => {
  const text = `- **关键词排名**：最近实测日期为11/5，已查询1,399／1,516个词。本期没有新的排名采样。
- **技术检查**：本批99项检查完成。覆盖范围尚不包含完整孤立页、全语言、历史资源和模板性能，结论限定在本批检查范围。
- **收录观察**：11/19固定URL抽样4／4通过，属于报告期后的补充观察。域名索引总览来源日期为11/13，未据此计算本周全站收录增量。`;
  assert.deepEqual(summarizeReportTechnical(text), { status: "clear", issues: [], message: "暂无问题", incomplete: false });
  assert.match(text, /覆盖范围尚不包含/);
});

test("an absent, running, failed or incomplete receipt never claims there are no problems", () => {
  for (const text of [undefined, "", "待更新 · 本期尚未收到巡检回执", "进行中 · 已完成 0/99 项检查", "部分完成 · 已完成 98/99 项检查", "失败 · 已完成 0/99 项检查"]) {
    assert.deepEqual(summarizeReportTechnical(text), { status: "incomplete", issues: [], message: "检查未完成", incomplete: true });
  }
});

test("a completed structured run ignores successful diagnostics and reports a real linked defect", () => {
  const lines = [
    "已完成 · 已完成 99/99 项检查 · 0 单已送审",
    "• 巡检时间 2026-11-20T02:00:00Z · 覆盖 完整",
    "• 复核 · 服务器采集 · 已完成",
    "• 复核 · GSC 收录抽查 · 4/4 已取得回执",
    "• P1 [旧 CSS 资源返回404](https://flatkey-seo-roadmap.vercel.app/issues?week=2026-11-16#issue-css) · [查看工作任务](https://flatkey-seo-roadmap.vercel.app/work/css-task?week=2026-11-16) · 修复资源引用并核对正式版本",
    "• 来源日期 · gsc 2026-11-18",
  ];
  assert.deepEqual(summarizeReportTechnical(lines), {
    status: "issues", issues: ["P1 [旧 CSS 资源返回404](https://flatkey-seo-roadmap.vercel.app/issues?week=2026-11-16#issue-css)"], message: null, incomplete: false,
  });
  assert.equal(lines.length, 6);
});

test("negative findings and repaired historical errors are not live problems", () => {
  const result = summarizeReportTechnical("检查完成，未发现异常。未发现404、noindex或canonical异常。历史404已修复；robots与canonical均通过。");
  assert.equal(result.status, "clear");
  assert.deepEqual(result.issues, []);
});

test("confirmed 4xx responses remain visible while negative and passing checks stay clear", () => {
  for (const code of [400, 401, 403, 404, 408, 410, 429]) {
    const issue = `部分页面返回${code}`;
    assert.deepEqual(summarizeReportTechnical(`技术检查：本批99项检查完成。${issue}。`).issues, [issue]);
    for (const observation of [`已检查无${code}`, `未发现${code}响应`, `HTTP ${code}检查通过`]) {
      assert.equal(summarizeReportTechnical(observation).message, "暂无问题");
    }
  }
  assert.equal(summarizeReportTechnical("本批403项检查完成。").message, "暂无问题");
  assert.equal(summarizeReportTechnical("本批500项检查完成。").message, "暂无问题");
});

test("a positive finding after a negative observation remains visible", () => {
  const result = summarizeReportTechnical("技术检查：本批99项检查完成。未发现noindex异常，但canonical仍指向错误页面；发现2个页面未收录。");
  assert.equal(result.status, "issues");
  assert.deepEqual(result.issues, ["canonical仍指向错误页面", "发现2个页面未收录"]);
});

test("a passing check in the same sentence does not hide another defect", () => {
  const result = summarizeReportTechnical("技术检查：本批99项检查完成。robots与noindex均通过，canonical仍指向错误页面，另有2个页面返回404。");
  assert.deepEqual(result.issues, ["canonical仍指向错误页面", "另有2个页面返回404"]);
});

test("punctuation inside linked issue titles does not break the link", () => {
  const result = summarizeReportTechnical("已完成 · 已完成 99/99 项检查\n• P1 [日语页面canonical错误，需修正](https://flatkey.ai/ja/blog/example) · 已关联任务");
  assert.deepEqual(result.issues, ["P1 [日语页面canonical错误，需修正](https://flatkey.ai/ja/blog/example)"]);
});

test("collection failure stays incomplete while confirmed website issues remain visible", () => {
  const result = summarizeReportTechnical(["部分完成 · 已完成 98/99 项检查", "• 缺口 · PSI 429，检查未完成", "• P2 页面存在重定向循环 · 复查"]);
  assert.equal(result.status, "issues");
  assert.equal(result.incomplete, true);
  assert.deepEqual(result.issues, ["P2 页面存在重定向循环 · 复查"]);
});

test("long confirmed findings remain concise without breaking their evidence URL", () => {
  const url = "https://flatkey.ai/ja/blog/a-long-page?market=jp";
  const result = summarizeReportTechnical(`技术检查：检查完成。发现[比较页](${url})存在canonical错误，${"需要核对正式页面内容".repeat(20)}。`);
  assert.equal(result.status, "issues");
  assert.match(result.issues[0], new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(result.issues[0].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").length <= 96);
});
