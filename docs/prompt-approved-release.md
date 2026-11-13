# Prompt 自动导入与博客自动发布边界

2026-11-12 用户最终决定：所有博客新增、旧博客优化、翻译和已有译文更新，以及 Prompt 定时导入，免人工逐页审批。落地页、功能页及其他非博客页面先提供同版本测试链接、双端截图和简介，由团队在本地 Codex 继续调整并自行发布；平台登记“已发布”后仍要真实生产核验，不因点击按钮自动部署或假称验收。

## Prompt 执行入口

`node scripts/seo-prompt-release.cjs --input=<qualified.json>` 只预检；加 `--execute` 执行本次合格条目的 create-only 自动导入，不再传逐页审批或 release-authorized 参数。输入保留 `version:1, taskId, weekStart, approvedItemJSON, contentVersion`；`approvedItemJSON` 只是兼容后端协议的字段名，不表示人审。十语言页面从实际规范路由和条目 slug 派生，不接受客户端自定义审批 URL。

来源、作者许可、原帖、精确生成模型、完整媒体复核、可用公开 CDN、去重、十语言文本及其证据必须绑定同一 SHA256。候选池不等于合格素材；缺任何项只记录缺口。只使用现有 import-only Keychain 凭据，不新增管理员凭据，不把 SEO_IMPORT_TOKEN 当生产写入密钥。

执行器先核对平台 `capabilities.automaticPublicationPolicy=1` 和后端 `X-Prompt-Import-Protocol: approved-create-only-v1`，缺新版协议停止。持久 workflow claim 与数据库唯一 slug 共同防重；凭据检查在 POST 尝试标记之前。标记之后请求结果未知，只按精确版本公开读回恢复，不能盲重发。正式 API 写入回读生成 `kind=prompt,status=published` 台账，十个页面不计十篇博客；未做 HTML/canonical/语言/正文/链接验收前不会标 verified。

## 平台自动发布回执

`record_publication` 原字段保留，自动发布增加：

```json
{
  "publicationPolicy": "auto_blog",
  "approvalId": null,
  "approvalItemId": null,
  "automaticWrite": {
    "operation": "update",
    "sourceId": "actual-cms-id",
    "baseContentVersion": "actual-old-version",
    "contentVersion": "actual-new-version",
    "publishedAt": "actual-provider-write-time",
    "verifiedAt": "actual-provider-readback-time",
    "receipt": "immutable-receipt-path-or-url"
  }
}
```

`auto_blog` 只接受已核实的主站规范 `/blog/:slug` 及合法语言路径，并且 task.kind 为 blog/optimization、pageType=blog、渠道为网站。博客必须属于用户明确设定的任务或已自动排期的周计划；其他页面不能只改客户端 kind 绕过。新增 source_blog/translation/backfill_translation 使用 create；译文关联真实同任务 sourcePublicationId。旧博客和已有译文改动统一 kind=optimization、operation=update；CMS 执行器必须做改前版本 CAS，优化基线先保存（缺数保留 null），平台会核对已知最新版本。实际媒体/CMS CAS 并不由台账本身替代。

`auto_prompt` 仅真实 `/prompts/image|video/:slug` 详情路径、technical/other 任务，operation 必须 create；不消费博客周计划额度。非博客免审申请会拒绝；原有人工审批记录仍可正常读写。

旧 pending 博客/Prompt 审批原决定不改、不自动批准或撤回；列表显示“免审历史”，不计可行动待审项。非博客仍保留原逐页审批记录与审计。

## 本地验证与部署边界

Prompt 后端 create-only +精确版本 API 是独立 Go 候选，需 Console/Router 同步部署；SQLite race 测试不代表 PostgreSQL/MySQL 已做真实生产验收。SEO 平台与稳定 runtime 要同时达到新 capability 后，定时执行器才会执行生产导入。旧线上协议下保持停止并记录具体缺口。本文不表示任何 Prompt 已实际导入。
