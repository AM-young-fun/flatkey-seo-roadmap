# SEO完整循环执行契约 v3 · 2026-11-24

依据本次已批准 `seo-platform-workflow-review-20261124.md`，SHA256 `ce9c98cf0d7065f2dc7db6fb7f777e4c4d004d65307315f9a9d85ae3934c76f6`；批准原文与时间见同日approval JSON。季度参数以 `seo-quarter-2026-closeout-v3.json` 为准。此版替代旧v1/v2执行文案，保留旧审核、快照与回执。本次只更新原入口提示词，所有入口保持PAUSED，日程、模型、目录、通知不变，不新增job。

## 暂停与恢复

用户要求先完成基建和逐项验收再恢复。全部15项本机自动化、两项GitHub工作流和两条服务器cron当前暂停；本版不能当作立即采集、制作、发布或发群的指令。已过去的11/24首轮日期作废，不批量补触发、不补发。仅在实际验收及原入口恢复安排保存后，由明确恢复的原入口执行自己的职责；付费开关、旧周五群周报、撤回任务不随常规恢复开启。保持原租约和原会话，不启动替代执行器。

## 目标、来源、范围

2026收官季截止北京时间2027-02-05。3000仅为Flatkey单站每周GA4自然搜索会话：官网＋Console生产host，剔测试/IP，属性metadata为LA，报告窗口洛杉矶周四至周三，最终完整验收周2027-01-28—02-03。其他站独立观察，不累计进3000也不阻断Flatkey目标的来源完整性。精确周值须有已授权真实来源包、metadata、渠道/host过滤与完整日/小时覆盖；旧7个日桶不能单凭硬编码时区冒充齐全。

执行仅Flatkey/RackRate/ModelFit公开官网；Flatkey代码限website及必要资源，暂停新落地页，博客与旧文继续。博客仅Flatkey/ModelFit；RackRate不做博客；JEV/Mochi数据观察。RougeCue Google接入/查询/补采暂缓，不自动检查权限或恢复。GitHub独立展示，不纳SEO归因/目标/投入决策。

GA4/GTM/GSC只读，账号按AGENTS.md。不改Google配置、埋点、身份/同意、权限、事件或索引设置。禁止产品Console/Router/API/后端/鉴权/计费/数据库结构代码任务；正常官网内容接口不等于后端代码改动，仍按各自既有权限和create-only/update协议执行。Prompt素材独立流程与原三池额度不改，不读取SEO词库、不转为SEO页面任务、不外发。

## 话题与市场目标

先完整季度规划，再持续已核验热点/真实机会及正常优化。话题→国家语言原词→页面→原任务→效果。话题列表和图共用成员集合，父聚合取子孙并集、主归属不双计；执行容器不是主攻方向。正式、机会、归属待核互斥并对平，不物理删词/历史或改国家凑数。

优先US/en、JP/ja、BR/pt-BR、海外简中SG/zh-CN；新增规划参考35/25/20/15/其他5，不是机械源文/翻译配额。其他低优先语言每周合计1—2篇源文，占原容量；卫星站只用真实已支持语言。中性型号不自动认英语，CN结果不迁SG，JP英文结果不迁US。

季度N须人工审核确切全量成员清单后冻结，可包含语种/市场待核项。待核、未查、失败留N不计R；后续同原稳定ID用human身份补充版本修正映射，不改N、不制造新排名。R为近14日同原词/市场/语言Google桌面有效前100，F为其中前50，目标R/N≥60%、F/R≥80%，R为0不能通过。完整采集覆盖提示另列，不额外要求100%目标都有排名回执。真正新增目标另建首次纳入批次与三个月期限；不能借归档缩N。1409底账、937主国建议及391中性词证据尚非确切清单批准，不代替用户冻结/赋国。

隔周原周四北京时间16:00、14天锚点/期次ID保持，付费仍暂停。先复用同词同市场同周期保存结果。两份账分开：域名已有排名发现（GSC查询/国家/页面与供应商数据库覆盖）和TopicMap真实已建页主/次词SERP监控。GSC平均位置不是具体SERP名次。未建页不默认付费；同词每期只一个批准国家。新增查询、国家、分页及费用清单先获当次明确批准。UNKNOWN先查原账，不盲重发；未查、失败、深度不足、完整100外、语种待核、未收录分别保留，不把18—99条结果当完整100外。

## 研究、方向、排期及任务

AI每日轻扫24小时事件/近7日升温和竞争；周一或顺延首工作日集中扩词、聚类、完整去重一次；紧急热点工作时段可即时补证。官方事实＋独立需求双证和有效期才合格P0，先筛资格再排优先，不抢租约、不撤换在途。人判断新热点、新主攻方向和重大加码；已批方向内常规自动。未来可用原产能参考60%主攻、25%基础、15%试验，不动原已排任务。

全量读取原任务/issue/计划/已发和在途意图，按站点、市场语言、原页/意图、具体问题稳定problemKey去重。同问题跨周原ID/原会话续跑，不用报告日期生成新问题。已完成交付不重开；7/14/28只追加效果。阶段确无原任务且有真实证据才新增planned research/review及其依赖制作任务，不以采集token伪human。所有正常接口expectedVersion、稳定requestId、冲突重读、CAS/生产读回，不直写数据库。

新内容契约growth-v1.5保留原keywordId/topicId/主词/市场语言；生产前真实当地Top10自然结果、实际打开前5逐页3C、完整去重、六项分析和E-E-A-T。Ahrefs不足先已有授权搜索/正常浏览器补证；不能把JS提示页当零结果。搜索量/KD/业务价值及例外理由真实记录，不能换词凑证据或放低门槛。方向任务在制作和计划均核已批准scope/数量/期限。保留原dueAt、Monday桶、稿件、审批、分支、版本和有效租约；延期下个实际工作日原会话实质补齐，不只扫描写partial。ModelFit GGUF原解除暂停资格保留；撤回和范围外任务不恢复。

业务周BJT周五至周四，两个Monday存储桶不迁移。候选周三15:30，定稿周四15:00开始、16:00前真实保存。消费最近已完成复盘，不能依赖同日16:30新周报。实际工作日D只核一次：Flatkey新源文5D，ModelFit新源文D，原优化2D，Flatkey新landing0，两卫星landing=D+min(2,D)；**另加两站合计旧文翻新2D**。正常五日47＋10＝57，不扩翻译/付费/额外热点授权。新计划targets.cadence=growth、maintenanceVersion=seo-maintenance-v1、contentRefreshPages=2D；逐日不足保存真实gaps.contentRefreshPages，不降目标或未研究凑额。旧计划身份/任务/原额度保留，不另建同周计划遮盖原记录。

## 三类维护工作包

旧文翻新沿原CMS update协议，task.kind=optimization、workClass=content_refresh，独立refresh队列，原optimization/cluster不重复领取。仅两站已有博客，同页同问题只一交付，翻译另记页面。先保存原任务optimization基线，maintenance.refresh含baselineId、原首发日、baseContentVersion、真实原因/实质改动与证据。下滑/见顶用相邻已结束等长至少28日趋势，并核90日、季节/竞争；过时事实需原始权威补证，不只改年份刷日期。原观察期内不无依据再翻新，新问题要留前任务关联和独立证据。保留原URL/slug/canonical/首发日；真实写入先留published，完成同版本QA才verified计数，失败/未知如实留账。

模型详情和相关文章按实体＋话题＋语言互链。workClass=internal_linking，沿原optimization/technical任务；maintenance.links记录实际模型URL、文章URL、topic/entity、原语言和两个描述性锚文本。只用已上线最终canonical的同语言相关页面，不编URL、不全站机械互链、不进产品后台。QA逐页渲染a[href]、目标200/可索引、模型正确、无重定向链、两端可达；比较文可关联多个模型。跨两页修改仍遵守两页各自审批/发布权限，不能以关系登记代替另一页发布授权。

技术维护workClass=technical_seo沿原technical队列；maintenance.technical逐项记before/change/verify/证据。日巡检关键变化、周模板轮查：LCP/INP/CLS、robots/noindex/canonical、sitemap真实lastmod、hreflang双向/自指/语言、JSON-LD真实可见内容、404/soft404/孤立页/链环/缓存。Field与Lab分开，缺CrUX不填0或冒称通过，PSI不扩预算；CWV良好参考2.5秒/200毫秒/0.1。Schema不编评论/评分/价格/作者；Google2026-05-07已停止FAQ富媒体，不宣称该机会。

publication.maintenanceQa绑定实际contentVersion/checkedAt与逐项证据；翻新验原首发、真实modifiedAt、身份和实质更新；双向内链保存两端实际readbacks；技术按本任务选中area复验。全部现有发布审批、版本和现场验收仍生效。普通博客不使用仅JobPosting/BroadcastEvent的Indexing API；GSC请求索引/提交sitemap/设置变更仍需当次明确授权。官网正常sitemap与内链维护不等于Google配置写入。

## 数据、报告及观察

原16:00采集、16:15注册、16:25验收、17:30完整来源包预览、18:00日报职责保持；周一09点候选仅补周六/日独立两份，不合并。执行时钟BJT不随DST移动，数据日界按各GA4实际metadata，GSC实际发布日；LA未闭合日/未发布数据保留null，不搬昨天。RR/MF原native上海日桶只单列，须完整小时重聚回执才入LA同期。

Flatkey自然搜索范围与首次获客范围区分；SEO注册是firstUserDefaultChannelGroup Organic Search、sign_up_success/totalUsers所选整段独立去重，不用关键事件数或日人数累加。页面/模块分子分母整段去重，来源不完整与真实0分开。原本机collector runtime准备16份模块标量包，复用合格缓存、只补缺；summary自报complete不够，验原字节SHA、请求/日期/host/channel/metadata/质量。

17:30按seo-daily-dashboard-package.md使用通用prepareArchivedDailyDashboard＋savePreparedDailyDashboard，基础快照→一次save_daily_dashboard→新确切ID全量读回；离线CLI无apply/网络/凭据。不能用裸prepare盖掉已齐来源看板。sourceEvidence哈希、完整归因/技术/计划/关键词/季度/正文随同一快照；默认归档也取冻结内容，不实时overlay；修订新版本/新ID，旧正文及发送账本保留。新日报businessDate=BJT实际交付日、sourceDay=LA已结束来源日、executionWindow分别存，旧历史ID语义不迁移。

日报保留已批原板块与最新简版，不恢复删除的重复四页面组和底部工作记录；原位置加入翻新计数/内链技术问题、最多3项重点。技术实际未查写检查未完成，无问题才暂无问题。优化榜近30日真实提升Top10及效果页。

周报六块：业务搜索、各站市场、本周交付页面效果、独立渠道、关键词收录技术、下周安排复盘。周四16:30完成LA周四至周三；正负Top3—5页面真实标题HTTPS、模块话题/国家/来源前后值和绝对差，GA会话/GSC点击不混加、切片不相加。结合上线/翻新/优化回执、外部需求竞争及本站优势，区分因果、相关、未知，给加码/维持/试验/整改和真实原taskId/指标。无证据原因先研究，不编优势；排名变化仅本轮真实DataForSEO结果，季度可列最近证据日期。

归因草稿保存读回→同LA周期一次TopicMap白名单复盘→第六块完整待审正文。只正常可逆增补，保留原父图/词/市场语言/状态/已排任务，差分review不重复job。完整确切六块/来源与正文hash读回后贴用户，明确批准同文才原群/机器人/幂等发送。周五旧自动周报保持暂停；BJT周四日报只归档且次日不补发。暂停期间所有外发均不执行。

每日原10:30含周末读取跨周真实已发布/已结单任务，按publication版本实际上线日7/14/28观察收录、原词市场排名、自然流量及已有业务证据；保留旧56。翻新新实质版本观察与原首发/旧观察分开，纯样式不重置。缺数保留并逐日补，不能填0或为复查付费，不重开交付run/抢租约。周二/周四/周报消费同回执。保存实际配置、代码验收、来源数据、实际交付和效果分别报告，不把代码测试通过当实际循环跑完。
