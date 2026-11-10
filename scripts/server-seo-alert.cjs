const fs = require("node:fs");
const { planAlert, signedWebhook } = require("./seo-alert.cjs");
async function run() {
 if (!process.env.SEO_DINGTALK_CONFIG) { console.log("::warning::DingTalk alert delivery is not configured yet."); return; }
 const config = JSON.parse(process.env.SEO_DINGTALK_CONFIG);
 const statePath = process.env.SEO_ALERT_STATE || "/tmp/seo-alert-state.json";
 let previous = null;
 try { previous = JSON.parse(fs.readFileSync(statePath,"utf8")); } catch (error) { if (error.code !== "ENOENT") throw Error("invalid_alert_state"); }
 const problems = [];
 if (process.env.INVENTORY_OUTCOME !== "success") problems.push("页面台账同步失败");
 if (process.env.ANALYTICS_OUTCOME !== "success") problems.push("采集或线上数据完整性检查失败");
 const alert = planAlert(previous, { problems });
 if (!alert) { fs.writeFileSync(statePath,JSON.stringify(previous || { failed:false })); console.log("No alert transition."); return; }
 const repository = process.env.GITHUB_REPOSITORY;
 const runId = process.env.GITHUB_RUN_ID;
 if (!/^[\w.-]+\/[\w.-]+$/.test(repository||"") || !/^\d+$/.test(runId||"")) throw Error("invalid_run_reference");
 const link = "https://github.com/"+repository+"/actions/runs/"+runId;
 const r = await fetch(signedWebhook(config.webhook,config.secret), {method:"POST",redirect:"error",headers:{"content-type":"application/json"},body:JSON.stringify({msgtype:"markdown",markdown:{title:alert.title,text:alert.text+"\n\n[查看运行记录]("+link+")"}}),signal:AbortSignal.timeout(20000)});
 const result = await r.json();
 if (!r.ok || result.errcode !== 0) throw Error("alert_delivery_failed");
 fs.writeFileSync(statePath,JSON.stringify({failed:alert.failed,fingerprint:alert.fingerprint}));
 console.log("DingTalk transition delivered.");
}
run().catch(()=>{console.error("::error::DingTalk alert delivery failed; details omitted to protect credentials.");process.exitCode=1;});
