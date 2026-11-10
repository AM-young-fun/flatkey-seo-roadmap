# 页面版本审批预检

`scripts/seo-page-approval-check.cjs` 在发布器调用 CMS/部署动作**之前**检查当前审批状态。适用于新增和修改的博客、博客译文、落地页、旧页优化及集群页面。源文审批、周计划审批、旧的持续博客授权都不能替代具体页面语言版本的审批。

脚本只调用 `POST /api/seo/workflow/approval-check`；不审批内容，不发布，不写 publication，不发送钉钉。执行成功只表示这次服务器检查允许该版本，仍需正式发布流程的再次校验。

## 输入与运行

从平台具体审批项和待发布产物取得以下六项，保存为 JSON 文件。字段必须全部提供，不接收额外字段；不从标题或源文自动猜译文版本。

```json
{
  "approvalId": "approval-actual-id",
  "approvalItemId": "item-ja-actual-id",
  "taskId": "task-actual-id",
  "pageUrl": "https://flatkey.ai/ja/blog/actual-slug",
  "language": "ja",
  "contentVersion": "actual-reviewed-content-version"
}
```

上例为格式说明，不能当真实已批准记录使用。`contentVersion` 必须来自本次已审核产物；改稿后使用新版本，重走审批。`pageUrl`、`language`、`contentVersion` 按原值精确匹配，不自动改写语言、URL 或内容版本。CLI 的 `approvalItemId` 显式映射到接口字段 `itemId`。

凭据由现有密钥配置/运行环境注入 `SEO_IMPORT_TOKEN`，不要写入输入文件、命令参数、仓库或日志。`SEO_PLATFORM_ORIGIN` 默认正式平台 `https://flatkey-seo-roadmap.vercel.app`；只额外允许 localhost、127.0.0.1、[::1] 用于本地验收，拒绝其他目的地与带用户名、密码、路径、query/hash 的 origin。

```sh
rtk proxy node scripts/seo-page-approval-check.cjs --input=/absolute/path/page-version.json
```

需要自定义审计目录时使用 `--receipt-dir=/absolute/path/approval-checks`。默认目录为当前工作目录下 `.local/page-approval-checks`，每次生成独立回执，不覆盖或复用旧回执。文件权限为 `0600`；新建目录为 `0700`。

## 成功与失败

- 只有 HTTP 成功、`allowed === true`、六项响应回显完全匹配、审批 ID/条目 ID 匹配、决定版本/时间有效且 `storage === "database"`，并且回执落盘成功，进程才退出 `0`。
- 未批准、拒绝、要求修改、撤回、被新版本取代、依赖未完成、页面/语言/版本错配、鉴权错误、数据库不可用、超时、跳转、无效响应或回执写入失败，一律退出非零；发布器必须停止。
- `local_preview` 即使回传 `allowed:true` 也不能用于正式发布，退出非零。可在本地平台接隔离测试数据库后验证成功路径。
- 输出只有简短 JSON：`allowed`、`code`、`origin`、`requestHash`、`receipt` 和 `revalidateAtPublication`。不会输出凭据、原始 HTTP 错误文本或任意服务端扩展字段。配置或输入格式错误可能没有回执，仍然失败退出。

调用示意：先运行该脚本，并检查进程退出状态；仅在退出 `0` 时，调用既有、已授权的发布适配器。此文档不提供或执行任何 CMS 发布命令。

## 回执用途与边界

回执绑定目标 `origin`、固定接口路径、六项完整请求、按固定字段顺序序列化后的 SHA-256，以及服务端决定 ID/版本/记录时间和本次检查时间。它明确标记 `reusable:false`、`isPublicationReceipt:false`、`revalidateAtPublication:true`。没有服务器签名；它是审计证据，不是可跨目标、跨版本或稍后重放的发布凭证。每次执行都重新请求服务器，旧的通过结果不会覆盖之后的撤回。

预检与外部 CMS 动作之间不构成原子事务，也不能持有跨系统锁。正式 publication 服务必须重新读取审批状态并校验同一页面语言版本；发布适配器还应处理检查后被撤回等竞态，保留真实发布事实与异常，不伪造未上线或成功状态。不能用预检回执绕过这一步。

接口字段约定：请求 `{approvalId,itemId,taskId,pageUrl,language,contentVersion}`；Bearer `SEO_IMPORT_TOKEN`，不发送 Origin。成功响应必须含相同 `request`、`approvalId`、`itemId`、`decisionId`、`decisionVersion`、`decisionRecordedAt`、`checkedAt`、`storage`。拒绝通常为 409；鉴权/来源/结构/存储错误分别可能为 401/403/400/503。

验证命令：

```sh
rtk proxy node --test tests/seo-page-approval-check.test.cjs tests/workflow-approval.test.cjs
```

测试使用临时文件与临时 loopback 服务，关闭服务并清理测试目录；不访问生产 API、CMS、钉钉或付费接口。
