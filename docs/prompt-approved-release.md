# Prompt 审批后导入

本入口补齐“候选审核 → 精确版本审批 → 正式创建 → 发布台账”的缺口。它不会把每日预筛池当作合格稿件，也不替代媒体/作者/许可审核。当前首次真实生产演练仍待：两端新协议部署、完整合格素材、逐页批准、具体版本发布授权。

## 准备与审批

1. 沿用 10:30 候选任务，对单条完成原始作者与许可、完整图片视觉或视频完整解码/关键帧、真实生成模型、公开 CDN 和重复内容核查。记录来源目录、确切 revision、素材 SHA256、审核人/时间及 HTTPS 证据；不能只凭 Range 传输成功。
2. 冻结单条 import JSON，包括 `slug/category/model/prompt/title/summary/tags/output/artifact/source` 和 `_seo_review`。`title/summary` 含现有十语言。`_seo_review` 不进公开业务字段，但整个 JSON 的原始 UTF-8 字节都参与 `sha256:` 版本，审批后不能重新排版或替换素材。
3. 创建 `technical` 任务，国家/语言/关键词/pageUrl 均为 null；每个实际公开的十语言详情页分别有审批 item，`operation=new`，`reviewContent` 是同一完整 JSON 字符串，`contentVersion` 是其哈希。测试 URL 和桌面/手机截图必须与该版本一致。只准备源语言审批不足以授权自动出现的其他九个页面。
4. 由负责人在平台逐项批准。后台导入 token 无此权限。生产执行还要求操作者明确提供同版本 `--release-authorized`，不能因旧自动任务历史曾直接导入就沿用该权限。

输入 manifest：`version:1`、`taskId`、`weekStart`、`approvedItemJSON`、`contentVersion`、十个 `approvals`。每个 approval 是已有 `seo-page-approval-check.cjs` 的六字段结构；语言采用路由 locale（en/zh/es/fr/pt/ru/ja/vi/de/id），目标 URL 是 `https://flatkey.ai/[locale/]prompts/{image|video}/{slug}`。

`_seo_review` 必需：`catalogUrl`（既有合法来源白名单）、40位 revision、`originalSourceUrl/author/license/reviewer/checkedAt/artifactSha256/evidence[]`，以及 `originalAuthorAndLicense/fullMediaReview/publicCdnVerified/duplicateCheck/generationModelVerified=true`。视频另需 `fullDecode/keyframesReviewed=true`。这是真实已做审核的记录，禁止为通过校验而预填 true。素材 URL 必须为不含临时签名查询的公开 HTTPS 地址。

## 执行顺序

默认 `node scripts/seo-prompt-release.cjs --input=/path/manifest.json` 只做预检：核对平台数据库能力、完整审核内容、十个精确版本 approval-check 及正式 Prompt API 的协议/同名情况。不获取生产导入密钥、不 claim、不写台账、不发布。

明确授权后才在既有 SEO 环境包装器内加 `--execute --release-authorized=sha256:…`。脚本固定两个目标 origin，拒绝重定向；SEO token 仅用于平台。Prompt import-only AccessKey 从现有 macOS Keychain 的 `flatkey-prompt-library-import-access-key` / `automation-2` 临时读入进程内存，不进 argv、环境、文件、报告或日志。不会创建新凭据，不能用 SEO token 代替。

执行依次：专用凭据读取与其他可证明未发送的准备 → 平台 claim → 刷新数据库状态 → 再核审批 → 持久化尝试标记 → create-only POST → 精确版本及字段只读读回 → 十页 `kind=prompt/status=published` 台账 → task published → run partial/释放租约。记录实际 backend 高精度 `importCreatedAt`（旧 `createdAt` 秒字段仅作一致性核验），不采用素材抓取日或客户端假定时间；重复执行不增加新增数。

后端新增的 `approved-create-only-v1` 使用现有数据库唯一 slug 约束决定唯一创建者，跨节点不会覆盖同名数据。存在同版本且全部字段相同才可只读返回；不同版本、旧条目无版本、被禁用或后来编辑过的条目均拒绝。旧客户端原 upsert 行为保留；新客户端不发送 legacy `items`，因此旧服务节点会拒绝，不会误走旧覆盖路径。新增模型版本列与高精度创建时间列均为可重复的 GORM additive migration，三数据库兼容；本地实际测试为 SQLite，未声称三种数据库均实跑。

## 中断与验收

- 超时或响应不明确：保留持久尝试标记与 UNKNOWN，后续只查已存在的 exact version/字段/importCreatedAt，**不重发 POST**。记录缺失或内容漂移时停止，须查真实后端结果；不能改 runId 绕过。平台 claim 只是减少并发，数据库约束才是创建幂等的最后保障。
- 导入成功只说明 API 中已有正式条目。网站可能仍有 ISR 缓存，不能立即虚写 verified。日常交付验收须逐页补正式 HTTP 200、canonical、语言、实际内容、有效链接与时间证据，调用已有 publication mutation 升为 verified，之后才 observing。`linksChecked` 不能凭 API 返回设为 true。
- Prompt 的十个语言 URL 不算十篇新增博客；新增条目数量按唯一 slug，页验收按 URL，分别记录。日报仅用真实已验收交付，原有博客/优化计数不被 Prompt 混入。

## 上线交接

先部署 Console 后端 create-only 协议，再部署 SEO 的能力 marker/schema/脚本并同步验收后的 stable runtime；反序也安全，旧一端能力不足会在读取 Prompt 密钥前停止。daily 10:30 默认仍是候选与审批准备，本补丁不修改任何定时任务或发送日报。

Router deploy: **required** for a coordinated release of this shared Go model/runtime: PromptLibraryItem is registered in the shared startup migration list and the same API router exposes its handlers. Console deploy and additive database migration are required; no relay/billing business logic is changed. SEO platform deploy/runtime sync are separate. A rolling deployment may temporarily reject protected imports on old nodes; never retry blindly. Verify the two new columns and protocol/readback on the actual Console entry before allowing imports.

验证：后端 controller/model Prompt 定向及并发创建测试；平台真实 workflow state-machine 合约测试覆盖精确审批、10语言、旧服务能力、丢响应、跨执行器 claim、既有条目冲突、发布台账和不混计博客。模拟测试不是生产发布证据。
