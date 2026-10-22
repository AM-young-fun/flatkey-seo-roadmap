# 核心页面每周访客追踪

从 2026-10-20—26 日这一期起，模型页和提示词页是每份 Flatkey 流量周报的固定项目。并入现有 `automation`，2026-10-22 按用户要求改为每周二 10:10 启动，不新增日程。首次执行为北京时间 2026-10-27。2026-10-13—19 日仍遵守用户已确认完成、不再补采或重写的要求；没有已存页面基线时，上期填 `null`，从新一期建立基线。

## 统计口径

- 属性 `541304395`，时区 `America/Los_Angeles`，每期标记周二至周一，按北京时间周二10:10可见数据截数。
- 访客量使用 GA4 `totalUsers`（新老访客一起计入），筛选 `eventName = page_view`、`hostName` 为 `flatkey.ai` 或 `www.flatkey.ai`。不是 `newUsers`、浏览次数、会话数或落地页人数。
- 对每个页面组、每一期分别取得筛选后的截至采集时的区间去重总人数。不把逐页、逐日或逐语言人数相加；同一人跨模型或跨语言访问仍在同组只计一次。两组访客可能重叠，不相加为全站总量。
- 使用 `pagePath`（不含查询参数）正则完整匹配。GA4 界面使用相同条件的用户总数。规则版本和可复用正则在 `src/lib/weekly-page-visitors.ts`。

| 分组 | 页面范围 |
| --- | --- |
| models | `/models` 目录及 `/models/<slug>` 详情，覆盖英文及 zh/es/fr/pt/ru/ja/vi/de/id 版本 |
| prompts | `/prompts` 及全部子页，以及 `/models/<slug>/prompts` 及子页，覆盖相同语言版本 |

模型内提示词详情只归 prompts，不归 models。不要按页面标题、模型关键词或全站包含 `prompt` 的 URL 模糊匹配。新增网站语言或页面路由时先核对真实路由，升级规则后不得直接与旧口径计算环比。

## 每周采集和保存

10:10 取当次可见数据作为该周正式快照，不等待洛杉矶周一结束。两组采用相同截数，记录实际collectedAt，并附analysis.reportingCutoff（见运行日程文档）。复用上期已存同截数口径的 `pageVisitors.groups[].users.current` 作为本期previous；核对属性、时区、指标、规则版本和截数口径一致。没有同口径基线则previous=null，不拿旧完整周冒充早上快照。已发布快照不因当天晚些时候数据变多自动重采。只采新一期；失败/缺项才续整，不新增18:30任务。

以下仅为导入字段示例，不是真实业务数据。附在现有 `traffic[].analysis.pageVisitors`，随原报告保存，无需新增数据库表或导入接口：

```json
{
  "metric": "totalUsers",
  "eventName": "page_view",
  "ruleVersion": 1,
  "sourceUrl": "https://analytics.google.com/analytics/web/",
  "groups": [
    { "key": "models", "users": { "current": 120, "previous": null } },
    { "key": "prompts", "users": { "current": 40, "previous": null } }
  ]
}
```

两组必须都存在，失败/缺失人数为 `null`，只有确实查到零访客才写 `0`。保留报告链接、实际日期、指标、筛选条件和来源更新时间到忽略提交的 `.local/collections/YYYY-MM-DD/`。页面始终显示两组上周、本周、增减人数和环比；缺失显示待采集，首次基线不算环比；上一期为 0 且本期有访问时显示“新增”。草稿等长诊断窗口不冒充完整周页面访客量。

`analysis` 字段保持历史兼容；从 2026-10-20 期起，GA4 `COMPLETED` 回执必须已有两组本期人数。缺少任一组时记录 `PARTIAL`，不能以全站新用户数代填或标记完成。若线上尚未支持 `pageVisitors` 字段，先保留本地原始证据并在既有 Codex 总结里记录两组访客及缺项，记部分完成；不得为此改代码、部署、删掉字段假报成功或另建定时任务。

本周简短总结包含两组的主要访客变化，沿用原有一段总结格式，不新增原因排查清单。页面显示约定快照口径及实际采集时间。

口径参考：[GA4 维度与指标](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)。
