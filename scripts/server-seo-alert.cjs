const fs = require("node:fs");
const { planAlert, signedWebhook } = require("./seo-alert.cjs");

async function deliver(config, { title, text }) {
 const repository = process.env.GITHUB_REPOSITORY;
 const runId = process.env.GITHUB_RUN_ID;
 if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "") || !/^\d+$/.test(runId || "")) {
  throw Error("invalid_run_reference");
 }
 const link = "https://github.com/" + repository + "/actions/runs/" + runId;
 const response = await fetch(signedWebhook(config.webhook, config.secret), {
  method: "POST",
  redirect: "error",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
   msgtype: "markdown",
   markdown: { title, text: text + "\n\n[查看运行记录](" + link + ")" },
  }),
  signal: AbortSignal.timeout(20000),
 });
 const result = await response.json();
 if (!response.ok || result.errcode !== 0) throw Error("alert_delivery_failed");
}

async function run() {
 const verify = process.argv.includes("--verify");
 if (!process.env.SEO_DINGTALK_CONFIG) {
  if (verify) throw Error("missing_dingtalk_config");
  console.log("::warning::DingTalk alert delivery is not configured yet.");
  return;
 }
 const config = JSON.parse(process.env.SEO_DINGTALK_CONFIG);
 if (verify) {
  await deliver(config, {
   title: "SEO 告警接入测试",
   text: "SEO 告警接入测试。任务失败或恢复时会在本群通知。",
  });
  console.log("DingTalk test message accepted.");
  return;
 }
 const statePath = process.env.SEO_ALERT_STATE || "/tmp/seo-alert-state.json";
 let previous = null;
 try { previous = JSON.parse(fs.readFileSync(statePath,"utf8")); } catch (error) { if (error.code !== "ENOENT") throw Error("invalid_alert_state"); }
 const problems = [];
 if (process.env.INVENTORY_OUTCOME !== "success") problems.push("页面台账同步失败");
 if (process.env.ANALYTICS_OUTCOME !== "success") problems.push("采集或线上数据完整性检查失败");
 const alert = planAlert(previous, { problems });
 if (!alert) { fs.writeFileSync(statePath,JSON.stringify(previous || { failed:false })); console.log("No alert transition."); return; }
 await deliver(config, alert);
 fs.writeFileSync(statePath,JSON.stringify({failed:alert.failed,fingerprint:alert.fingerprint}));
 console.log("DingTalk transition delivered.");
}
run().catch(()=>{console.error("::error::DingTalk alert delivery failed; details omitted to protect credentials.");process.exitCode=1;});
