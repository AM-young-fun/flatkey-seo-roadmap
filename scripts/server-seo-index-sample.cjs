// Small, independent Search Console URL Inspection sample. Never requests indexing.
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");
const priorLoad = Module._load;
Module._load = function (name, ...args) { return name === "server-only" ? {} : priorLoad.call(this, name, ...args); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { getGoogleReadAccessToken } = require("../src/lib/google-read-auth.ts");
const { CLUSTER_SITES } = require("../src/lib/seo-cluster-sites.ts");
const { seoToday } = require("../src/lib/seo-date-range.ts");
const { workflowWeek } = require("../src/lib/seo-workflow.ts");
const root = "https://flatkey-seo-roadmap.vercel.app";
const repo = "AM-young-fun/flatkey-seo-roadmap";
const samples = [
  ["https://flatkey.ai/", "sc-domain:flatkey.ai"],
  ["https://flatkey.ai/es/blog/gpu-server", "sc-domain:flatkey.ai"],
  ...CLUSTER_SITES.map(({ domain, gsc }) => [`https://${["jev-llm.com", "mochichatbot.com"].includes(domain) ? "www." : ""}${domain}/`, gsc]),
];
async function inspect(inspectionUrl, siteUrl, token) {
  try {
    const response = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ inspectionUrl, siteUrl, languageCode: "zh-CN" }),
    });
    if (!response.ok) return { inspectionUrl, status: "HTTP " + response.status };
    const row = (await response.json()).inspectionResult?.indexStatusResult;
    if (!row || !["PASS", "PARTIAL", "FAIL", "NEUTRAL", "VERDICT_UNSPECIFIED"].includes(row.verdict)) return { inspectionUrl, status: "无可核实回执" };
    return { inspectionUrl, verdict: row.verdict, coverage: row.coverageState, status: "已查询" };
  } catch {
    return { inspectionUrl, status: "请求失败" };
  }
}
async function main() {
  const runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT || "1";
  if (process.env.GITHUB_REPOSITORY !== repo || !/^\d+$/.test(runId ?? "") || !/^\d+$/.test(attempt) || !process.env.SEO_IMPORT_TOKEN) throw Error("collector_runtime_required");
  const startedAt = new Date();
  let token;
  try { token = await getGoogleReadAccessToken("https://www.googleapis.com/auth/webmasters.readonly"); } catch { /* Persist the verified failure. */ }
  const checks = [];
  for (const [url, property] of samples) checks.push(token ? await inspect(url, property, token) : { inspectionUrl: url, status: "GSC 凭据不可用" });
  const completedAt = new Date().toISOString(), run = `server-url-inspection-${runId}-${attempt}`, checked = checks.filter(row => row.verdict);
  const errors = checks.filter(row => !row.verdict);
  const sourceDates = { "GSC URL Inspection": checked.length ? seoToday(startedAt) : null };
  const evidence = checks.map(row => ({ label: `${new URL(row.inspectionUrl).hostname} · ${row.verdict ?? row.status}`, url: row.inspectionUrl, observedAt: completedAt }));
  const r = await fetch(root + "/api/seo/workflow", { method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { authorization: "Bearer " + process.env.SEO_IMPORT_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ requestId: run, expectedVersion: 0, action: "record_run", record: {
      id: run, stage: "GSC_URL_INSPECTION", weekStart: workflowWeek(startedAt), scheduledFor: startedAt.toISOString(),
      startedAt: startedAt.toISOString(), completedAt, status: errors.length ? checked.length ? "partial" : "blocked" : "completed",
      owner: "GitHub Actions", taskIds: [], inputVersion: process.env.GITHUB_SHA, evidence,
      failureReason: errors.length ? errors.map(row => `${new URL(row.inspectionUrl).hostname} ${row.status}`).join("；") : null,
      nextAction: errors.length ? "仅复查未完成样本；403 请核对服务账号的对应 Search Console 属性权限。" : "对未收录样本复核覆盖原因及 Google 所选规范页。",
      checkedItems: checks.length, completedItems: checked.length, costMicros: null, coverage: errors.length ? "partial" : "full", sourceDates,
    } }),
  });
  if (!r.ok || (await r.json()).record?.id !== run) throw Error("inspection_receipt_not_verified");
  console.log(JSON.stringify({ checks, checked: checked.length, run }));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { inspect };
