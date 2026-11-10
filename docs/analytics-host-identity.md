# 五站页面数据与真实入口主机

更新：2026-11-10。

五站共用平台，但每个站点仍使用已登记的独立 GA4 / GSC 属性。页面导入必须属于该属性主机。GSC 同时保留独立 `byProperty` 站点汇总和 `byPage` 页面报表；不能把按页面汇总的曝光当成站点曝光。MochiChatbot 和 JEV LLM 的 `sc-domain:` 属性同样接受。

GA4 入口会话查询保留 `date × landingPage × hostName`，并限定 `eventName=session_start`、`sessionDefaultChannelGroup=Organic Search`。页面身份是完整主机与路径：`flatkey.ai/`、`www.flatkey.ai/`、`console.flatkey.ai/` 各自保留。站点会话数独立查询，不能把跨主机明细相加冒充去重站点总数。

历史报表缺少 hostname 时，只保留历史证据，不把同一个 `/` 路径重复分配到多个主机。新报表记录 `hostnameDimension=hostName`，可取代旧无主机快照；未取得的值显示缺失。最近 14 天滚动回补，历史缺失支持回填最近 90 天。

**逐页注册暂未核实跨域归因。** Google 的 `landingPage` 是会话首个路径，而 `hostName` 随当前事件变化。注册发生在 console 时，不能把注册事件的主机与 website 的入口路径拼接成不存在的页面。因此当前逐页注册保留 null，原因 `landing_host_attribution_unverified`；四集群注册事件也未核实，保留 null。站点注册和整段期间去重注册独立查询、正常保留。

要恢复逐页注册，需要验证跨域会话身份及一个与会话入口绑定的完整 URL / hostname 字段，或使用可证明先入口后注册的漏斗/原始事件关联；验证前不要仅添加 hostName 维度就声称完成归因。每段期间的用户与注册用户由无 date/page 维度的独立报表查询，禁止把每日去重用户相加。

来源：[Google Analytics Data API dimensions and metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)。

API 示例（必须使用现有平台登录或授权采集凭据）：

```text
/api/seo/analytics?site=jev-llm.com&start=2026-11-01&end=2026-11-07&pages=all
/api/seo/analytics?site=rackrate.org&start=2026-11-01&end=2026-11-07&pageDaily=1&url=https%3A%2F%2Frackrate.org%2F
/api/seo/analytics?site=modelfit.cc&country=US&start=2026-11-01&end=2026-11-07&pageQueries=1
```

这些代码与测试完成不等于生产采集已运行；部署、数据回填与抽样对账需要真实运行回执。
