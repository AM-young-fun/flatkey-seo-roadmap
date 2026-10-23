# SEO 采集与周报日程

所有时间为北京时间。2026-10-20 用户明确分工：**文档、GA4、Ahrefs 由 Codex 采集并整理；DataForSEO 由项目服务器调用 API。** 不部署 GA4 服务账号取数或 DWS 常驻 worker。

| 事项 | 时间 | 执行位置 | 实际计划 |
| --- | --- | --- | --- |
| 三张协作表读取及增量同步 | 每日 10:30 | 本机 Codex + DWS 登录 | `10-30-seo`，已启用 |
| Ahrefs 所需声量、KD等数据 | 每周五 10:10，随周报补缺 | 本机 Codex + 已登录浏览器 | 与周报共用 `automation` |
| GA4 采集、核对、原因分析和周报发布 | 每周五 10:10 截数，作为该周正式快照 | 本机 Codex | 原 `automation`，已启用 |
| DataForSEO 已排名新词发现 → 正式目标实际排名 | 隔周周四 08:00 | Vercel 服务器，不依赖电脑/Codex | 原有 `/api/cron/daily-rankings` |

2026-10-23 用户调整：DataForSEO 改为隔周周四08:00。保留2026-10-20期次锚点和14天相位，原11-03期改在11-05 08:00执行，之后11-19、12-03；期次ID、历史采集时间、费用授权与预算不变，不补跑已过去的10-22、不重复收费。服务器每5分钟协调续跑已有账本。

原周报自动化改为每周五10:10，统计上周五至本周四，上一期为再往前7天。GA4时区仍为America/Los_Angeles，按10:10实际可见数据截数，不等待当地周四结束。保存真实collectedAt与analysis.reportingCutoff={kind:"FRIDAY_1010_SNAPSHOT",scheduledAt:"该期结束后的周五10:10:00+08:00"}，不宣称完整当地七天。仅同日期范围、同截数口径的相邻期可计算环比，旧周二至周一期次只读保留。每日三表仍10:30，失败或缺项沿用每日任务续整，不创建重复日程。

流量重点为模型详情页和Prompt Library的访客占比，规则版本2；必须单独采集全站totalUsers作分母，不以newUsers或两组访客相加代替，允许组间访客重叠。模型目录不计入模型详情组。见[每周核心业务访客占比](weekly-page-visitors.md)。已完成历史报告不补采、不改写。

## 周报发布条件

2026-10-22 补充：模型页和提示词页的整周去重访客量并入上述现有 `automation`，每周必采，不另建任务。覆盖各语言目录、详情页和模型内提示词页，展示上周、本周与环比。按 GA4 `totalUsers` + `page_view` 统计；范围、首期基线及 `analysis.pageVisitors` 格式见 [核心页面每周访客追踪](weekly-page-visitors.md)。不补采用户已确认完成的 10-13—19 日期。缺任一组本期人数时记部分完成。

1. Codex 通过现有登录采集文档、GA4、Ahrefs，保留原始来源、国家、实际日期、口径和缺失项。无法通过接口取得的数据也由 Codex 读取，不要求服务器自行补全。
2. GA4 Flatkey 属性 `541304395`，时区 `America/Los_Angeles`。按周五10:10快照统计标记为周五至周四的报告区间，只取新的一期，上期复用已保存报告，缺失/错误才补采。注册使用整周 `sign_up_success` 去重用户，整体新访客转化使用真实顺序漏斗。注册事件未核对的站点不能填0或混入汇总。
3. Codex 合并服务器已保存的 DataForSEO 实测结果。采集周等待同一期任务完成，非采集周明确未更新；上期没有关键词数据时用第一期（38词小范围），说明日期和覆盖差异。
4. Codex 核对本期/上期、增减量、环比及主要渠道、地区、设备、页面变化，写成一段简短的本周总结后才发布最终周报。页面不展示逐项“波动原因排查”“待确认”或下一步任务；内部保留证据，不把未证实的因果写成结论。数据不齐时仅保存草稿。
5. 完整周报通过现有认证导入，`analysis.codexSummary` 保存 Codex 总结。页面优先显示这份总结。若关键词晚到，保留草稿；同一任务等待或由已有每日任务续整，不另建临时定时任务、不重抓已保存数据。

`analysis.codexSummary` 格式：

```json
{
  "preparedAt": "ISO时间",
  "text": "一段简短的本周总结，包含主要变化和已核对结论。",
  "findings": [
    { "title": "简短结论", "evidence": "可核对的数据和证据", "action": "待确认项或下一步", "level": "finding" }
  ]
}
```

`level` 可用 `finding`、`issue`、`unresolved`。最多6条，优先3条。不要恢复表单路径、逐词排名下降明细和冗余变化模块。原始业务数据只保存忽略提交的 `.local` 目录。

## 独立采集回执

`POST /api/collectors/runs` 使用现有登录会话或同一导入 Bearer 凭据。只接受元信息，不能调用供应商或启动付费。稳定 ID 由 `kind + periodStart` 生成，完成后不能被迟到的 RUNNING 回执退回执行中。

```json
{
  "kind": "SHEETS",
  "periodStart": "2026-10-20",
  "status": "COMPLETED",
  "checkedItems": 510,
  "sourceChecks": [
    {"sourceId":"api_main","status":"COMPLETED","rows":308},
    {"sourceId":"cloud_main","status":"COMPLETED","rows":150},
    {"sourceId":"optimization","status":"COMPLETED","rows":52}
  ],
  "detail": "三表完整读取；仅同步真实变化"
}
```

示例计数不是固定要求，以当次真实读取为准。`kind` 可用 `SHEETS`、`GA4`、`AHREFS`；`status` 可用 `RUNNING`、`COMPLETED`、`PARTIAL`、`FAILED`。三表必须都成功才可完成，即使内容无变化仍可记录完整检查。GA4 的 `periodStart` 为对应周报周五；Ahrefs 也使用对应周报周五；三表使用检查当天。GA4 完成前必须已有通过校验、含 Codex 总结的完整报告，否则拒绝成功回执。失去登录/来源延迟时记部分失败，不伪造零值。

## 查看与依赖

项目数据管理 → 运行计划显示四项分工和下一次时间，执行记录显示服务器账本与 Codex 采集回执。Codex 中的两项真实日程在自动化列表查看、暂停或修改；项目不伪装能实时读取本机 Codex 开关状态。

Codex 的本机任务需要电脑及 Codex 运行，并保持对应 DWS/Chrome 登录。DataForSEO 在服务器执行，电脑关闭不影响它。网页打开、刷新运行计划或查看数据不会触发付费请求。
