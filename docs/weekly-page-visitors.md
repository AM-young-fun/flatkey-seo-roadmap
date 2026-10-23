# 每周核心业务访客占比

2026-10-23更新。沿用原 `automation`，每周五北京时间10:10执行，统计上周五至本周四。GA4属性541304395、America/Los_Angeles，取当时可见数据并保留实际collectedAt，使用FRIDAY_1010_SNAPSHOT；不等待当地周四结束。

周报重点展示模型详情与Prompt Library：本周占比、上周占比、百分点变化，同时保留两期访客人数、增减和人数环比。

- 模型详情：`/models/<slug>`及支持的语言前缀；排除`/models`目录页。
- Prompt Library：`/prompts`、所有下级页面、`/models/<slug>/prompts`及下级页面，包括语言前缀。
- 支持en/zh/es/fr/pt/ru/ja/vi/de/id，实际正则以`src/lib/weekly-page-visitors.ts`为准。

每组分别查询同区间、hostName为flatkey.ai/www.flatkey.ai、eventName=page_view的GA4 totalUsers（包含新老访客），按组直接去重，不相加页面、语言或每日人数。另以完全相同区间、主机和事件条件查询全站去重totalUsers作分母。占比=每组访客/全站访客；同一个人可访问两组，允许重叠，不归一化为100%。分母为零或缺失时占比不可用，不假填0%。

保存格式：

```json
{
  "metric":"totalUsers",
  "eventName":"page_view",
  "ruleVersion":2,
  "sourceUrl":"https://analytics.google.com/analytics/web/",
  "siteUsers":{"current":200,"previous":null},
  "groups":[
    {"key":"models","users":{"current":120,"previous":null}},
    {"key":"prompts","users":{"current":100,"previous":null}}
  ]
}
```

示例数字仅演示结构。上述对象存入analysis.pageVisitors。previous仅复用已保存、同为周五至周四、同ruleVersion=2、同截数口径的相邻期。没有基线时用null，不重抓历史快照。旧ruleVersion=1含模型目录，保留历史展示，不当成新模型详情基线；旧证据无全站分母时不计算占比。两组本期人数或全站分母缺失时只能PARTIAL，不能GA4 COMPLETED。完成后将两组占比与变化写入本周总结。
