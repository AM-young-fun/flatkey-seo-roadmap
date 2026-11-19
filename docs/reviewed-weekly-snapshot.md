# 已批准周报正文存档

用户批准完整人工整理的周报正文后，通过原服务器导入凭据调用 `POST /api/seo/digest` 的 `action=save_reviewed`，再以返回的确切 `reportId` 调用 `action=read_saved`。核对读回的 `text`、`detailText`、UTF-8 SHA256、洛杉矶周期与审稿记录一致后，才能由既有授权会话将该确切 ID 交给原发送流程。不能重新 `prepare` 另一份报告代替已经批准的正文。

请求的完整字段与限制见 `src/lib/seo-reviewed-digest.ts` 的 `reviewedDigestCommandSchema`：当天 `weekly`、确切 `baseReportId`／`baseReportHash`、`reportPeriod`、原样 `text`／`textSha256`、`sourceEvidenceSha256` 和 `approvedAt`。证据 SHA256 绑定本机保存的证据清单；审稿记录仅用于追溯，不代表服务端核实了用户授权，也不会启用、领取或发送通知。

保存只新增不可变快照，不覆盖基础快照。相同正文 ID 重试返回首存版本，元数据冲突拒绝覆盖；超过原发送时效仍遵守原规则，不能静默刷新已有快照。报告页面对 `reviewedBody` 版本直接展示完整正文，避开基础快照的结构化指标与动态修订。历史报告、发送开关、送达幂等及原 `claim`／`begin`／`finish` 协议保持不变。
