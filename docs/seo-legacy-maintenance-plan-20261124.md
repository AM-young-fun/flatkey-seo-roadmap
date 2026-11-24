# 原workdays计划的独立旧文翻新

既有`workdays`计划保留原ID、cadence、全部原目标值、已承诺taskIds及dueAt，不迁入新的`growth`计划。本次仅允许在原targets追加以下独立维护合同：

```json
{
  "maintenanceVersion": "seo-maintenance-v1",
  "contentRefreshPages": 4,
  "maintenanceRange": { "start": "2026-11-25", "end": "2026-11-26" }
}
```

窗口使用北京时间，必须在原Monday存储周内、属于同一周五至周四业务窗口；按实际剩余工作日两站合计每天2篇核cap。已有11月27日任务完整保留，不能为了本次维护把它们挪入11月20—26日业务周。维护合同保存后不撤回或改窗；未完沿原ID和原dueAt补齐。

普通优化明确排除`workClass=content_refresh`；翻新只更新Flatkey或ModelFit真实已有博客，同一页面的普通优化和翻新合并一次交付，跨计划/跨站仍每天合计最多2篇。每个维护工作日用真实原任务或具体研究缺口对平；planned、researching、缺基线或未完成Top10/前5逐页研究的任务不能进入正式制作排期，不以配置完成冒称可执行。

现有原计划未完常规任务继续显式预留，原28项常规预留不消耗新增4个独立翻新名额。若为这4项记录季度投入，使用原已审`quarter-planning-v2`及其GPU/API归因；该legacy增量allocation只覆盖新翻新ID和真实缺口，不把旧常规任务换类。其4项投入进入后续累计offset，新的growth或另一Monday桶不能重复分配同一窗口。研究名额、译文、热点extra与实际翻新交付分账。

保存仍沿原正常`save_task`/`save_plan`、真实expectedVersion和稳定requestId，未知响应先核原请求。季度冻结、付费、发布审批和暂停入口规则不变。此合同不授权CLI越过实际执行时段，不恢复定时任务，不写Google或产品后台。
