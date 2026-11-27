# 日报来源包与确切快照

本说明只描述通用报告程序。全部任务仍暂停，不据此采集、保存生产或发送。

`scripts/seo-daily-dashboard-preview.cjs` 默认且仅能离线运行，显式输入现有基础日报、正常采集归档与独立 scalar 回执；不加载凭据，没有 `--apply`、付费或发送入口：

```sh
node scripts/seo-daily-dashboard-preview.cjs --base=/absolute/saved-report.json --analytics=/absolute/analytics-readback.json --scalars=/absolute/daily-report-scalars.json --out=/absolute/offline-output
```

输出按来源日与内容哈希命名，不覆盖不同内容。`*.provenance.json` 的实际 UTF-8 字节 SHA-256 与 `sourceEvidenceSha256` 一致。标为 `offline_prepared_not_saved`，不能当作生产保存或完整业务验收。

原 17:30 入口在用户批准恢复后可复用同一组装和保存函数，无需再维护日期或路径硬编码的恢复脚本：

```js
const { prepareArchivedDailyDashboard, savePreparedDailyDashboard } = require('./scripts/seo-daily-dashboard-preview.cjs');
const { pkg, report: preview } = await prepareArchivedDailyDashboard({ base, analytics, scalars }, { now });
// api 由既有授权入口注入；离线验证注入内存 API，不提供默认网络适配器。
const { report, receipt } = await savePreparedDailyDashboard(pkg, { api, now });
```

保存依次执行 `read_saved` 基础版本全量核对、一次 `save_daily_dashboard`、`read_saved` 新确切 ID 全量核对；响应不明只核对，不盲重发。不调用 prepare、审批或发送。首次正常 prepare 可生成基础日报；同日已有来源看板时，裸 prepare 不得另存通用稿遮盖它。新来源修订写前须重读最新来源版本并绑定其 ID，过期基础版本拒绝保存；已存在的确切 ID 重放仍可精确读回历史。

来源包重验 scalar 原始字节、请求、属性、完整统计日、GA4 metadata 时区、独立去重与质量。站点 GA4 和 GSC 指标从统一采集归档读取，集群总览也读取同一批站点 GA4 自然搜索会话。GA4 会话与注册分字段处理。RackRate 和 ModelFit 按 GA4 属性的北京时间展示和逐站对比。GSC 有当日初步观测时注明状态，定稿后再比较涨跌幅。来源缺失保留为缺口，已证实的同日数据可沿原版本复用。

归因、技术、完整正文、原任务计划、模块占比、关键词及季度方向均随同一来源快照保存。默认归档和明确 reportId 均使用保存内容，不叠加实时任务状态。2026-11-24 起新日报以北京实际业务日 `businessDate` 统计交付，与 LA `sourceDay` 分开；历史版本及其 ID、正文和哈希保持原语义。

v9恢复模块占比后，补齐整段独立去重来源时，只将同一版本中的模块占比正文片段、结构化模块来源及正文hash同步修订，另存新确切ID；不再把这些允许修订的字段标为全文未变。`provenance.bodyRevision`明确限定为`whole-period-module-share-lines-only`，保留改前hash及改前/改后模块来源，其余计划、归因、技术、注册/付费快照和季度事实仍列入保留核对。原模块片段与原来源快照不匹配时拒绝，不能追加一段新数字掩盖旧正文；旧模板历史仍保持原正文协议。
