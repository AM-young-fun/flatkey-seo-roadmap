# GA4 可观测注册 cohort — 待审核实现

本分支只补 API 注册后 7 天首次成功使用 / 30 天首次付费。未合并 main、未发布、未设置覆盖起点；17 项定时任务与稳定 runtime 均不变。已执行只读接口契约探测，结果与验收限制见下文。

## 口径

- 两个独立封闭漏斗，均以 canonical `sign_up` 为第一步，分别到 `first_model_success` / `first_payment_completed`，结果事件限定 `business=api`。付款不必晚于模型使用。
- 第一阶段 AND 注册日期（属性时区 America/Los_Angeles）、所选国家、所选 Organic Search 来源。第二阶段允许 Direct / 其他来源，也不继续限制国家；全程仅正式 Flatkey 业务域名。
- 分子和分母取自同一次两步漏斗的 `activeUsers`。不使用事件总次数、不累加日用户，不拼接不同事件人数。GA4 报告身份决定同一用户的识别。
- 分母仅是 consent / client identity 可观测的 canonical 注册用户，不是全部业务注册账户。无 consent / 无身份或没有可归属 session 的用户不能被推断补齐。
- `GA4_COHORT_COVERAGE_START` 是必须经生产全节点事件、稳定身份与归因验证后的显式 ISO 时间（GitHub Repository variable，非 secret）。采集器没有当前时间/历史事件自动回填。未配置或无效时采集不附新字段，已有业务数据的两卡显示“未启用 / 生产版本与观察起点待确认”，零次额外 cohort API 请求。底层 cohort 规划器单独调用时仍返回 unconfigured，不能冒用成熟率。
- 如果起点位于属性日期中途，从下一完整属性日期开始入组；跨起点的筛选区间整体标覆盖不足，不静默截短分母。起点的运维验收必须包含 API 首成功的全 router 覆盖；不能用尚未配置的 `lifetime_first_known` 冒充真实，也不把该字段套到付款。
- 观察分别为注册后 604800 / 2592000 秒（终点包含），不是日历加 7 / 30 天。查询覆盖最晚注册者的完整秒数窗口。该观察末日完全关闭后另等 48 小时处理缓冲，跨夏令时保守成熟，可能比逐秒最早成熟多等不足一天。后续迟到数据仍可能修订。
- 无 denominator、未成熟、抽样、阈值、不完整/重复步骤或查询错误显示空值，绝不伪造 0%。只有完整真实回执中 denominator > 0 且 numerator = 0 才是 0%。
- runFunnelReport 本身不返回时区，调用前复用同一 GA4 property 的 runReport 响应严格核验 metadata.timeZone。不把客户端或环境猜测当时区证据。
- 为不假定探索数据保留期超过默认 2 个月，新查询仅限注册起点距当前属性日 50 天内。更早的已保存完整快照仍可展示；新的长区间查询显示 retention_safety_window 缺口，不宣称全历史可算。

## 采集与展示

复用 `scripts/server-seo-business.cjs` 和现有 GA4 业务归档。只有有效 coverage 且既有已鉴权 GET /api/seo/business 回读 capabilities.apiCohorts=1 后，原各日期窗口才附两个 cohort 状态/结果。旧 Vercel API、能力不可读或未设置起点时，仍按旧 payload 采集导入，summary 明确跳过理由；不会让 main 代码先合并、Vercel 用户尚未发布造成旧 strict importer 拒绝日采。不改变原业务事件或区间漏斗。该能力门控与起点同时满足后，同一采集器增加最近已成熟 D7 / D30 各一段连续 7 天注册区间（去重，未成熟不加），避免只采近期数据而 D30 永久缺失。GitHub 渠道查询保持原日期范围。

新增查询最多两个额外注册区间 × 5 国筛选 × 2 来源。它们复用现有业务查询与归档；成熟 cohort 最多每业务快照增加 2 个 alpha funnel 请求。未配置时没有额外日期区间或 cohort 请求。没有新增收费服务、调度、凭据或新数据库表。

页面优化的 GA4 业务区新增两卡；当前日期筛选明确作为注册区间，卡片注明观察截止日。不同注册区间不自动混用；两卡旁提供本国家/来源的最近已归档成熟 D7/D30 注册区间按钮，点击才切换现有日期筛选。仅查询已有业务归档，不在页面访问时调用 GA4，不给不存在的成熟区间生成入口。已有事件总数、参与时长与区间内三步漏斗保留各自口径，不能当作成熟 cohort。

## 发布前验收与交接

1. 先审核本分支测试、官方 API 契约与本地 UI；不触发生产 Actions。
2. 生产全节点代码上线、真实 sign_up/first_model_success/first_payment_completed、用户身份、来源 session 和域名归属均验收后，由负责人设置真实 coverage_start；不要回填成旧数据已经完整的日期。
3. Vercel 项目按仓库规则合并 main 后，通知用户仓库/commit/发布入口，等待用户发布；不得假定已自动部署、索取权限或重试部署。
4. 用户发布后，先核对未配置状态 / schema 兼容和安全导入，再通过既有采集器执行授权真实查询；alpha API 的该 property 兼容性仍需这一步实证。错误应明确显示 unavailable，不降级为事件总数比率。
5. 等完整 7 / 30 天观察与处理缓冲后才能形成首批成熟数据。真实业务分母和GA4可观测分母仍需对照，不以 GA4 覆盖替代账本。

Router deploy: not required。本分支只涉及 SEO 平台 UI / 数据查询 / 归档 schema 与采集配置，没有主站 router 运行时代码或 DB migration。多节点归档继续使用现有 immutable hash ID / skipDuplicates；不新增进程内协调。风险是 alpha 漏斗兼容性、真实生产事件覆盖与身份缺失，发布后必须单独核验。

## 官方依据

- [runFunnelReport / step filters / duration / metadata](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1alpha/properties/runFunnelReport)
- [Funnel 可用维度，包括 date 与 sessionDefaultChannelGroup](https://developers.google.com/analytics/devguides/reporting/data/v1/exploration-api-schema)
- [Funnel exploration 的同用户序列规则](https://support.google.com/analytics/answer/9327974?hl=en)
- [GA4 数据时效](https://support.google.com/analytics/answer/11198161?hl=en)
- [探索数据保留期](https://support.google.com/analytics/answer/7667196?hl=en)

这些文档证明查询语义可实现，不能代替该 property 的真实接口验收。

## 2026-11-11 真实接口契约探测

[只读业务探测 run 43011867856](https://github.com/AM-young-fun/flatkey-seo-roadmap/actions/runs/43011867856) 已返回：属性时区真实为 America/Los_Angeles；四个业务漏斗查询（D7/D30 × 全渠道/JP自然搜索）均 HTTP 200，date、国家、来源与事件参数过滤的请求语法被当前属性接受。

四份响应都没有 rows，且 metricHeaders 中 activeUsers 等四指标重复两组，原始响应 hash 相同 `e8e1aae79c649f4c96eec885b737af5a13c954ad55eab1a5a4ba2ac7de19b152`。这不能证明有数时的列布局，也不能当成 0 人或 0%。实际空形状已纳入契约 fixture；parser 继续返回 unavailable/null，不猜测取第一组重复列。

后续独立诊断仅执行正式域名 page_view → page_view 的非业务形状探测；该探测不导入、不开启 coverage、不代表 API 注册转化率。结果见下。


[非业务形状探测 run 43012602560](https://github.com/AM-young-fun/flatkey-seo-roadmap/actions/runs/43012602560) 已取得真实非空响应（原始响应 hash `219af2a3fe66105047737bfd13aa8d0b04bb22948a925fded39e8807e3221691`）：table 的 4 指标头完整重复两遍，但每行只有 4 个值；visualization 的 activeUsers 头重复两遍，但每行仅 1 个值。两部分相同步骤的人数均为 **7627 / 1442**。这些是 page_view 诊断人数，不是注册、首次使用或付费人数，不能用于业务转化率。

解析器现在仅兼容这个实证布局：完整规范重复头、单组行宽、两部分均有准确的两个步骤、相同人数且无抽样/质量缺口时，才消除重复头。8 个行值、列头不完全重复、两部分人数或步骤不符、缺 visualization 均拒绝。规范的单组头仍按明确列名处理，缺数仍为空值。

真实 fixture 保留原 page-view 步骤名称，以纯 `extractClosedFunnelUsers` 重放验证 7627/1442；直接交给固定 Registration/Outcome 的业务 wrapper 必须拒绝。另一个明确标为 synthetic 的测试才验证 canonical 步骤接入与成熟门控。**当前已验收请求契约与真实非空结构解析；API 成熟业务 cohort 本身仍待生产全节点覆盖确认、用户发布和完整观察时间，不能宣称已有真实成熟率。**

为补齐两个响应部分，先前形状任务 43012471705 在 npm ci 阶段取消，GA4 step 确认 skipped；随后只执行上述一次形状查询，没有导入或群发。
