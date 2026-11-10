const crypto = require("node:crypto");
function planAlert(previous, health) {
 const fingerprint = JSON.stringify(health.problems.slice().sort());
 const failed = health.problems.length > 0;
 if (failed && previous?.fingerprint === fingerprint && previous?.failed) return null;
 if (!failed && !previous?.failed) return null;
 return { failed, fingerprint, title: failed ? "SEO 数据告警" : "SEO 数据恢复", text: failed ? "SEO 服务器任务需要处理：" + health.problems.join("；") : "SEO 页面台账与数据采集已恢复正常。" };
}
function signedWebhook(webhook, secret, now = Date.now()) {
 const url = new URL(webhook);
 if (url.protocol !== "https:" || url.hostname !== "oapi.dingtalk.com" || url.pathname !== "/robot/send" || !url.searchParams.get("access_token")) throw Error("invalid_alert_destination");
 if (!secret) throw Error("missing_alert_signing_secret");
 url.searchParams.set("timestamp", String(now));
 url.searchParams.set("sign", crypto.createHmac("sha256", secret).update(String(now)+"\n"+secret).digest("base64"));
 return url;
}
module.exports = { planAlert, signedWebhook };
