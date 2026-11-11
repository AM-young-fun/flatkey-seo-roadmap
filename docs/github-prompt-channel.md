# GitHub 提示词渠道

执行规则以 [SEO 执行工作流](./seo-execution-workflow.md) 为准。两个公开渠道为 `flatkey-ai/awesome-images`、`flatkey-ai/awesome-seedance-prompts`。它们属于推荐渠道，不能并入 Google 自然搜索成绩。

## 采集与日报、周报

`scripts/collect-github-channel.cjs` 读取 GitHub 仓库元数据、Traffic views/clones 和 README，只读归档为默认行为。显式 `--apply` 才通过 SEO 导入凭据写入平台，写入后核对归档 ID；不会推送仓库或发送群消息。复用每日 09:00 台账任务执行，不增加重复发送任务。日采在每周五 10:00 周报、每日 18:00 日报之前；日报与周报继续各自防重。

示例（由安全配置包装器注入凭据，禁止在命令或日志中输出密钥）：

```sh
node scripts/collect-github-channel.cjs --out=/absolute/private/archive
node scripts/collect-github-channel.cjs --apply --out=/absolute/private/archive
```

- Stars、Forks 是采集时累计快照；首次采集不能宣称本日或本周新增。
- GitHub Traffic 只有最近 14 天，必须每天保存。日期采用 UTC。滚动窗口重叠时，同一日保留最新读数，不能把两个窗口相加。
- 报告按实际日明细比较相同星期、相同天数；当天 UTC 桶尚未完整，排除。缺失日保留缺失，不能算成零。周报统计上周五至本周四。
- 每日 unique 可以展示单日数；周报不加总每日 unique。API 原始 14 日 unique 不伪装成该周 unique。
- 仓库不提供出站点击总数。GA4 统计到站会话和去重用户，受用户同意与拦截影响，不能把 views/clones 写成跳转点击。
- GA4 口径为主站属性 `541304395`、`America/Los_Angeles`，限定来源 `github`、媒介 `referral`、对应仓库 campaign、Flatkey 网站或 Console 主机名。未完整的属性日不纳入；区间覆盖显示在报告中。周五早上可能尚缺周四属性日，明确标注，不补零。
- GA4 返回抽样、阈值、数据丢失、无权限或无凭据时保留待更新。GitHub Traffic 的权限不足也记为待更新。真实 API 成功返回的零才记为 0。

归档复用 `SeoReportVersion` 的 `GITHUB_CHANNEL` 类型，内容哈希确定 ID，可幂等导入，不新增数据库表。`/api/seo/github` 的写入及现场 GA4 查询仅允许后台导入凭据；普通登录只读归档。后台凭据不是审批身份。

本机 GitHub 身份已实际验证可读取两库 Traffic。GitHub Actions 默认 `GITHUB_TOKEN` 不保证拥有另外两个仓库的 Administration read 权限，因此没有假设它可跨库读取。Vercel 是否具有 Google 只读凭据也必须实际回读验证；Actions 中已有 Google 凭据不等于 Vercel 已配置。不能为消除待更新而创建重复分析体系或输出密钥。

## 公开链接与审批

仓库引导到 Flatkey 的用户跳转统一使用：

```text
utm_source=github
utm_medium=referral
utm_campaign=awesome-images 或 awesome-seedance-prompts
utm_content=仓库名.链接位置
```

只给用户跳转链接加 UTM；图片资源、API 请求、Router 接口不添加。README 的已上线 UTM 覆盖会出现在报告中，代码分支完成不等于公开链接已更新。2026-11-11 已发布的 100 条 Prompt 是旧任务的既成记录，后续任务已改为准备待审材料，不自行发布。

Prompt 任务保持 10:30 候选整理、去重、质量验证及待审准备。内容变更必须通过对应版本的审批；缺测试链接、桌面/移动截图或版本证据时保留草稿。仓库跳转链接变更同样先提供差异与验证，再由批准的发布动作上线。

## 本地只读报告验证

`seo-digest-preview.cjs` 接受 `--github-dir=/absolute/archive`；只加载通过契约校验的快照，并在报告来源中记录目录。该预览不采集生产、不发送消息、不表示当前生产数据已更新。周三生成未来周五预览时，不应出现尚未发生的周四数据；上个完整周的 GA4 归因也不能冒充未来周报区间。

参考：[GitHub Traffic API](https://docs.github.com/en/rest/metrics/traffic?apiVersion=2022-11-28)、[GA4 Data API schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)。
