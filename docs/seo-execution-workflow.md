# SEO 执行接口与切换验收

2026-11-10。范围五站/四国，用户沿用 Amplitude。工作周一至周日；周五16:30确定下周，周五18:00通知统计上周五18点以来工作。流量区间独立按周五至周四。

## 权威记录

`src/lib/seo-workflow.ts` 定义具体字段，`seo-workflow-state.ts`执行状态规则。

| 接口 | 用途 |
|---|---|
| GET `/api/seo/workflow?week=current/next/YYYY-MM-DD` | 本周/下周完整执行台账，`pageUrl`看跨周页面历史，`allHistory=true`供汇总 |
| POST `/api/seo/workflow` | `{requestId, action, expectedVersion, record, claim?}`；操作为save_task/save_plan/save_issue/save_optimization/record_publication/record_run |
| POST `/api/seo/workflow/claims` | claim→renew→complete；共享数据库时钟、运行ID/阶段/时间唯一与递增fencingToken |
| GET `/api/seo/workflow/history?kind=task&id=...` | 不可变版本；不能覆盖人工批准的内容 |
| POST `/api/seo/periods` | 已结束区间独立查询的用户和注册人数，禁止日去重人数求和 |
| GET/POST `/api/seo/digest` | 只读预览/归档与发送领取、开始尝试、补记回执；平台无日报周报页面 |

网页操作需登录和同源校验，服务器写入使用既有导入Bearer凭据，不能带Origin。生产没有数据库就返回不可用，不能悄悄写本地文件。开发预览显示local_preview，不代表生产入库。

## 一个任务的顺序

1. 创建研究/内容任务，使用具体站点、主国家、对应语言关键词、业务、页面类型、负责人、截止日、验收条件。候选为planned/researching。
2. 保存真实Ahrefs/SERP/GSC证据与业务价值；Volume≥10、KD<30优先，例外需理由。证据合格才ready/drafting。
3. 内容产物对应contentVersion；所有页面及每个译文都须具体逐项审批。改稿须新单替换旧批准；未批准一律停在review_pending。
4. 发布前保存baseline和上线版本。发布回执只有published；正式URL的HTTP、canonical、语言、内容、内链、发布来源回执完整后才verified。200不是Google收录。
5. 原文、翻译、补译使用独立kind和sourcePublicationId；同canonical/版本不重复计数。首次验收入库时间不可回写，迟到回执在下一统计窗口补记。
6. 7/28/56天回看对比前后相同口径；数据不足标观察中，不写因果结论。问题关联到任务，解决需恢复证据。

保存时必须带当前expectedVersion。服务器返回409后先读新版本，不用新requestId把冲突数据覆盖。自动化不能修改人工已确认关键字段。

## 本机桥接与依赖

`scripts/seo-workflow-bridge.cjs --input=/absolute/commands.json`先逐条验证并进入持久outbox；输入按依赖排序：前置任务→后续任务→周计划→基线→已批准版本→发布/验收回执→完成回执。追加`--apply`才导入。`--claim=/absolute/claim.json --apply`领取；动作执行中续租，写回记录携带claim令牌，最后保存阶段回执再complete租约。

未知发布先检查远端CMS/生产版本，不盲目重发；outbox保留原请求与平台读回。只有storage=database才可标平台已同步。

## 通知切换

`scripts/seo-digest-dws.cjs`默认只保存Markdown预览。每天18点刷新当前日期最终快照后`--send`，只用DWS猫猫侠→Flatkey seo/geo。每日唯一发送记录由数据库控制；预览、旧日期、过期快照拒绝发送。外部超时进入UNKNOWN，禁止再次发送。若本机已有provider_accepted回执，`--reconcile=/absolute/receipt.json`只补记平台状态，不发群。

最后切换前：验证日报、周报各一份、真实发布和优化台账、三表与数据基础链接可访问、实际自动化启停状态。然后服务端环境与GitHub变量`SEO_UNIFIED_REPORTING_ENABLED=true`关闭旧日采/排名单发；本机control.notification_cutover=true关闭逐篇博客消息并启用唯一18点任务。`SEO_WORKFLOW_ENABLED=true`启用服务器区间人数采集。旧通知停用与新任务启用须同一切换批次记录，失败回滚开关，不能两套同时发。

## 已验证与仍需生产验证

代码检查、生产构建、浏览器本地任务创建/冲突审核、局部与全套测试；独立PostgreSQL从旧schema执行增量SQL及重跑、并发领取、幂等回放、旧令牌隔离、UNKNOWN发送禁止重试。测试不调用付费排名、不发送钉钉、不写生产。

生产部署后的schema、实际Google新维度回填、任务回执导入、Amplitude业务事件与通知送达必须再取得真实回执；代码通过不能代替这些结果。集群注册与逐页跨域注册在未核实前保留空值。


## 所有页面发布必须逐项审批

新增、旧页更新、博客、每个译文、落地页、工具页、集群页，以及标题、描述、canonical、结构化数据等技术页面变更，均先提交平台审批。旧 `task.approval` 只允许已有历史字段原样保留，不得新建或改写。新建/切换 task 的 approved 状态（含 technical）必须已有对应逐页审批；`standing_new_blog` 不再是发布许可。历史补记 `historical_import` 仍是只读档案，不能生成新发布授权。

审批实体 `kind=approval` 使用已有 `SeoWorkflowRecord` / `SeoWorkflowEvent`，不新增表。`POST /api/seo/workflow` 使用 `action=save_approval`、稳定 `requestId` 和 `expectedVersion`。一单可含多个 URL/语言，但每项必须明确 `id`、`taskId`、`operation=new|update`、`pageUrl`、`language`、`contentVersion`、具体变更、改前/改后说明、证据；修改需 `baseContentVersion`。必须包含平台可读的 `reviewContent`（`reviewFormat=markdown|diff|text`）或 HTTPS 稿件/预览链接，仅本地文件路径不足以提审。外部链接须由审核人实际打开核对；文字版本标记不能替代对实际稿件的检查。

草稿可以修改；提交待审后，正文、URL、语言、版本、任务和替换关系锁定。`decisions[]` 每项包含选择的 `itemIds[]`、`decision`、`decidedBy`、`decidedAt`、说明和证据；服务器追加真实 `recordedAt`。只有登录平台的 `human` 操作可批准、拒绝、要求修改、撤回或替换，采集 token 只能提单和读取。审批状态可为 `draft/pending/partially_reviewed/approved/rejected/changes_requested/withdrawn/superseded`。整批批准必须明确选择全部项，不自动批准未选中的译文。

已提交稿件改动需新内容版本、新审批单，并填写 `supersedesApprovalIds` 指向对应页面语言仍有效的旧单。新单提交后，该页面旧授权立即失效；新单被拒绝也不会恢复旧授权。审批决定只能追加，拒绝/要求修改/撤回后不能在原内容版本上重新批准。所有更新使用乐观版本校验，冲突返回409，必须重新读取。

### 发布前接口

`POST /api/seo/workflow/approval-check` 仅核验，不发布、不写台账：

```json
{"approvalId":"approval-20261110","itemId":"page-en","taskId":"task-1","pageUrl":"https://flatkey.ai/blog/example","language":"en","contentVersion":"sha256:..."}
```

服务端采集器使用 `Authorization: Bearer <SEO_IMPORT_TOKEN>`，不带 `Origin`；平台用户使用已有登录会话和同源请求。成功返回 `allowed:true`、完整 `request` 回显、`approvalId/itemId`、`decisionId`、`decisionVersion`、`decisionRecordedAt`、`checkedAt`、`storage`。正式执行必须要求 `storage=database`；本地预览不能当生产许可。未批准、撤回、被替换、稿件版本/基线/任务失配返回409；未登录401，来源错误403，无数据库503。失败一律停止发布。

每次 CMS/部署动作前重新调用核验，不能把旧核验结果当可复用授权。核验只能证明查询时刻的状态，无法与外部 CMS 形成原子事务；实际发布回执仍在同一数据库图锁下再次检查。发布与撤回竞态若外部动作已发生、最终入库被拒，必须保留外部事实并作为异常人工核对，不能伪造成功台账或自动重发。

`record_publication` 必须携带 `approvalId`、`approvalItemId`，精确匹配批准的 URL、语言、任务和内容版本；实际发布时间不得早于服务器审批记录时间。唯一版本只能保存一次发布，重试沿用原请求ID。已被平台接受的真实上线回执可以在撤回后补充验收，撤回不会抹去历史发生的交付。

### 十语言博客与四国监控

现有十语言博客可使用一个真实源文任务，加每个 locale 独立审批项及独立发布回执。译文 `language` 保留真实语言，不强改为四国语言；非重点市场或无国家证据时 `country=null`，没有对应语言关键词证据时 `keyword=null`。这些译文不因此成为研究合格关键词或自动进入付费排名池。源文、落地页继续要求明确国家和本语言关键词；技术页面修改可不编造关键词国家。新工具的非目标市场本地化页可各建 technical 任务并逐项审批：operation=new 的发布记 kind=landing，operation=update 的旧页修改才记 kind=optimization，不能将新页伪记优化；这些技术本地化任务不会冒充周计划中需要关键词研究的主落地页任务。

工作台 `approvals[]` 默认保留跨周待审项；`summary.pendingApprovals` 和 `pendingApprovalItems` 按逐项有效状态计算，替换旧单不重复催审。日报从这里读取待审项并链接 `/approvals?approvalId=<id>`，不再以任务里一个“批准”字段代替逐页审批。
