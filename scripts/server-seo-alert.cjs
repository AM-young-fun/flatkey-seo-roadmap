const fs = require("node:fs");
const { dailyNotice, signedWebhook } = require("./seo-alert.cjs");

const rankingNoticeFile = "/tmp/seo-ranking-notice.json";
const productionOrigin = "https://flatkey-seo-roadmap.vercel.app";

async function lookUpRankingNotice() {
 if (!process.env.SEO_IMPORT_TOKEN) throw Error("missing_import_token");
 const response = await fetch(productionOrigin + "/api/seo/ranking-notice", {
  headers: { authorization: "Bearer " + process.env.SEO_IMPORT_TOKEN },
  redirect: "error",
  signal: AbortSignal.timeout(30000),
 });
 if (!response.ok) throw Error("ranking_notice_http_" + response.status);
 const { notice } = await response.json();
 if (notice === null) return;
 if (!/^\d{4}-\d{2}-\d{2}$/.test(notice?.period) ||
     typeof notice.title !== "string" || typeof notice.text !== "string") {
  throw Error("invalid_ranking_notice");
 }
 fs.writeFileSync(rankingNoticeFile, JSON.stringify(notice), { mode: 0o600 });
 fs.appendFileSync(process.env.GITHUB_OUTPUT, `period=${notice.period}\n`);
}

async function deliver(config, { title, text, resultLink }) {
 const repository = process.env.GITHUB_REPOSITORY;
 const runId = process.env.GITHUB_RUN_ID;
 if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "") || !/^\d+$/.test(runId || "")) {
  throw Error("invalid_run_reference");
 }
 const link = "https://github.com/" + repository + "/actions/runs/" + runId;
 const footer = resultLink ? "[查看排名结果](" + resultLink + ")" : "[查看运行记录](" + link + ")";
 const response = await fetch(signedWebhook(config.webhook, config.secret), {
  method: "POST",
  redirect: "error",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
   msgtype: "markdown",
   markdown: { title, text: text + "\n\n" + footer },
  }),
  signal: AbortSignal.timeout(20000),
 });
 const result = await response.json();
 if (!response.ok || result.errcode !== 0) throw Error("alert_delivery_failed");
}

async function run() {
 if (process.argv.includes("--lookup-ranking")) return lookUpRankingNotice();
 const verify = process.argv.includes("--verify");
 if (!process.env.SEO_DINGTALK_CONFIG) throw Error("missing_dingtalk_config");
 const config = JSON.parse(process.env.SEO_DINGTALK_CONFIG);
 if (verify) {
  await deliver(config, {
   title: "SEO 告警接入测试",
   text: "SEO 通知接入测试。日采结束后会在本群发送结果。",
  });
  console.log("DingTalk test message accepted.");
  return;
 }
 const notice = process.argv.includes("--ranking") ? {
  ...JSON.parse(fs.readFileSync(rankingNoticeFile, "utf8")),
  resultLink: productionOrigin + "/",
 } : dailyNotice({
  outcome: process.env.COLLECTION_OUTCOME,
  inventory: process.env.INVENTORY_OUTCOME,
  analytics: process.env.ANALYTICS_OUTCOME,
  imported: process.env.COLLECTION_IMPORTED,
  added: process.env.INVENTORY_ADDED,
  unavailable: process.env.COLLECTION_UNAVAILABLE,
 });
 await deliver(config, notice);
 console.log("DingTalk accepted the run report.");
}
run().catch(() => {
 console.error("::error::SEO notification lookup or delivery failed.");
 process.exitCode = 1;
});
