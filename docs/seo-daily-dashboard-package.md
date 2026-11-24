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

来源包重验 scalar 原始字节、请求、属性、完整统计日、GA4 metadata 时区、独立去重与质量；不信任汇总文件自报的 complete 或派生数值。GA4 会话与缺失注册分字段处理；部分 GSC、未发布数据保留未知，其他属性原生日桶不冒充 LA 日，原时区值仅留内部参照。缺新证据时可保留同日已有明确来源值，不能搬用其他日期。

归因、技术、完整正文、原任务计划、模块占比、关键词及季度方向均随同一来源快照保存。默认归档和明确 reportId 均使用保存内容，不叠加实时任务状态。2026-11-24 起新日报以北京实际业务日 `businessDate` 统计交付，与 LA `sourceDay` 分开；历史版本及其 ID、正文和哈希保持原语义。
