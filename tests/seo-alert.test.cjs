const test=require("node:test");const assert=require("node:assert/strict");const {dailyNotice,signedWebhook}=require("../scripts/seo-alert.cjs");
test("each daily run gets its own outcome even when failures repeat", () => {
  const failed = { outcome: "failure", inventory: "success", analytics: "failure" };
  assert.match(dailyNotice(failed).text, /日采失败.*GA4\/GSC/);
  assert.deepEqual(dailyNotice(failed), dailyNotice(failed));
  assert.match(dailyNotice({ outcome: "failure" }).text, /任务未执行完/);
  const success = dailyNotice({ outcome: "success", imported: "655", added: "8", unavailable: "11" });
  assert.match(success.text, /日采完成.*655.*新增 8 页.*11 个范围源报表无数据/);
});
test("webhook destination is restricted and signature is deterministic",()=>{assert.throws(()=>signedWebhook("https://example.com/robot/send?access_token=test","secret"));const u=signedWebhook("https://oapi.dingtalk.com/robot/send?access_token=test","secret",1000);assert.equal(u.searchParams.get("timestamp"),"1000");assert.equal(u.searchParams.get("sign"),require("node:crypto").createHmac("sha256","secret").update("1000\nsecret").digest("base64"));});
