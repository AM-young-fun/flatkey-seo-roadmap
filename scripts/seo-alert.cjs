const crypto = require("node:crypto");
function dailyNotice({ outcome, inventory, analytics, imported, added, unavailable }) {
 if (outcome !== "success") {
  const problems = [];
  if (inventory === "failure") problems.push("页面台账同步");
  if (analytics === "failure") problems.push("GA4/GSC 采集或线上核对");
  const title = "SEO 日采" + (outcome === "cancelled" ? "中断" : "失败");
  return { title, text: title + " · " + (problems.join("、") || "任务未执行完") + "，请查看运行记录。" };
 }
 const title = "SEO 日采完成";
 if (!/^\d+$/.test(imported) || !/^\d+$/.test(added)) {
  return { title, text: title + " · 五站 GA4/GSC 与页面台账核对通过。查看运行记录可核对同步数量。" };
 }
 const gaps = Number(unavailable) > 0 ? `，${unavailable} 个范围源报表无数据` : "";
 return { title, text: `${title} · 五站 GA4/GSC 同步 ${imported} 条，线上无漏写；页面台账新增 ${added} 页${gaps}。` };
}
function signedWebhook(webhook, secret, now = Date.now()) {
 const url = new URL(webhook);
 if (url.protocol !== "https:" || url.hostname !== "oapi.dingtalk.com" || url.pathname !== "/robot/send" || !url.searchParams.get("access_token")) throw Error("invalid_alert_destination");
 if (!secret) throw Error("missing_alert_signing_secret");
 url.searchParams.set("timestamp", String(now));
 url.searchParams.set("sign", crypto.createHmac("sha256", secret).update(String(now)+"\n"+secret).digest("base64"));
 return url;
}
module.exports = { dailyNotice, signedWebhook };
