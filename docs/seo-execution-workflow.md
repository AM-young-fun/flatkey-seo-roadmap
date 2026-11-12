> 2026-11-12 最新执行政策：博客（新增、旧文优化、全部翻译更新）和 Prompt 定时导入免逐页人工审批；博客仍按已确认周计划与质量门槛执行，旧页必须版本 CAS、改前基线和正式核验。非博客新增/优化提供测试链接、双端截图和简介，团队在本地 Codex 调整并自行发布，平台“已发布”仅登记事实，真实核验后才观察。历史审批不改写，免审历史不计待审。详细执行协议见 [自动发布协议](./prompt-approved-release.md)。

# SEO 执行接口与切换验收

## 发布规则（2026-11-12 用户最新决定）

仅 SEO 平台 `AM-young-fun/flatkey-seo-roadmap` 和 JEV `AM-young-fun/jev-llm` 恢复 main 自动部署。合并 main 会触发现有 Vercel 生产发布，因此精确版本审批、仓库正常合并规则和明确生产发布授权必须在合并前满足。研究、制稿、采集与运营台账权限不等于合并/发布许可；原有任务时间、启用状态和通知范围不变。

获准合并后只跟踪本次部署，记录仓库、PR/commit、精确 SHA、部署入口与实际结果；正式域名读回目标版本并验收成功后才记上线/observing。供应商拒绝时保存原因并停止，不无变化重推、不改变提交身份/权限来规避拒绝。

JEV 正式部署 `7d93f13389f900f76beb489107d55c6f255d2726` 已验证，包含 ba6d3ca/f1847fa：未同意不加载统计、允许后使用原有 GA4 ID、拒绝刷新后不加载、旧 GTM 已移除，UTM 实链和双端检查通过。此前 ba6d3ca 作者权限拒绝仅保留历史；不能继续标记本次待负责人发布，也不能据此推断所有作者以后都有权限。后续生产必须按精确版本审批和授权跟踪实际部署结果；真实业务转化回执仍单独观察。

其他 Vercel 项目仍按既有默认规则：经授权合并后在当前任务结果通知用户发布，未发布保持待发布；不把合并当上线。明确授权的阿里云生产流程不受本段改变。旧文档或 runtime 中“所有 Vercel 项目统一交用户发布”的表述被上述两个项目的精确例外覆盖，不能扩展到其他站点。

2026-11-11 当前执行口径。范围为 Flatkey 与 JEV、Mochi、ModelFit、RackRate 五站，美国/日本/巴西/西班牙四国；业务以 GPU 算力租赁为主、API Token 为辅，SEO埋点及报表统一 GA4，SEO侧暂停读取 Amplitude；产品原有 Amplitude SDK、初始化和后台投递保留，不删除或停用。新官网建设不在本轮范围。

工作计划仍按周一至周日建档：周四14:00候选、16:30定稿，包含下周落地页和博客的本国语言关键词。周五10:00群发周报，统计上周五00:00至本周四23:59:59；每天18:00群发日报，周五也照常发送。日报交付窗口为上次18:00至本次18:00。GA4/GSC各按来源实际数据日和时区显示，数据延迟不能假称完整周期。

本文件取代 `weekly-workflow.md`、`dataforseo.md` 内历史日程/页面规划；排名付费周期仍以已授权线上期次和配置为准，不据文档重新定相位或增加费用。配置、代码、本地验证、线上发布和真实运行回执是不同状态。

## 17项本机定时任务

以下为已通过 Codex automation_update 配置的时间，启停以 `/automations` 的实际配置快照及本机配置回读为准；不能因列在表中就假定已启用。

| 时间（北京） | 任务 ID | 工作与依赖 |
|---|---|---|
| 每日09:00 | 10-30-seo | 三张协作表同步：预览、版本校验、写入与读回 |
| 每日09:30 | seo-09-30 | 四国独立关键词研究，写入正确三表并同步 |
| 每日10:00 | seo-10-00 | 五站基础技术/收录巡检，异常页优先 |
| 每日10:30 | automation-2 | Prompt素材采集、本地去重、审批准备，禁止生产凭据/上传/导入 |
| 每日11:00 | flatkey-5 | 5篇源文制稿：英文2、日/葡/西各1，逐页审批 |
| 每日13:30 | seo-13-30 | 旧页优化，基线和后续观察 |
| 工作日14:30 | seo-14-30 | 已计划落地页制作与测试环境准备 |
| 工作日15:00 | seo-15-00 | 集群站制作与来源归因；JEV现版已生产验收，后续改动仍按逐版本审批/授权 |
| 周二/周四15:30 | seo | 推广研究及旧文深审轮查，不自动对外提交 |
| 每日16:00 | seo-16-00 | 实际交付验收、优化监控、台账补齐 |
| 每日17:30 | seo-17-30 | 独立项目cron：日报预览 |
| 每日18:00 | seo-18-00 | 独立项目cron：最终日报，含周五 |
| 周四14:00 | seo-14-00 | 下周候选及证据草案 |
| 周四16:30 | automation | 下周工作/关键词定稿 |
| 周五09:30 | seo-09-30-2 | 独立项目cron：周报预览 |
| 周五10:00 | seo-10-00-2 | 独立项目cron：最终周报 |
| 每月首个工作日15:00 | seo-2 | 月度复盘与资源分配 |

服务器 GA4/GSC 日采为北京时间08:30（`seo-daily.yml` 发布后生效），先于周五周报；排名沿用已有隔周付费调度，不在这17项中重复创建。local cron需电脑与Codex可用；heartbeat绑定会话忙时会排队，不能承诺精确起跑。

## 关键词和周计划契约

美国英语、日本日语、巴西葡语、西班牙西语分别研究。巴西和西班牙不可合并；不能把中文词放进英文/葡语/西语任务。研究产物先写 API、GPU 或旧页优化对应协作表并读回，再同步平台。DataForSEO按已核实目标国家取排名，排除自有品牌词；跨国监控需分别有真实需求，失败查询不算掉榜。

每日源文2/1/1/1，周源文共35：`targets.blogLanguages={en:14,ja:7,"pt-BR":7,"es-ES":7}`。`apiBlogs+gpuBlogs=35`，不再硬编码API21/GPU14，GPU主业的具体投入按本国机会、业务价值与产能说明。周计划仍列5个落地页、5个优化页；没有足够证据/产能时写明缺口，不强行凑数。其他语言翻译独立计数，不挤占源文额度。新 reviewed 计划必须符合本契约，旧计划保留历史事实。

## 权威记录

`src/lib/seo-workflow.ts` 定义具体字段，`seo-workflow-state.ts`执行状态规则。

| 接口 | 用途 |
|---|---|
| GET `/api/seo/workflow?week=current/next/YYYY-MM-DD` | 本周/下周完整执行台账，`pageUrl`看跨周页面历史，`allHistory=true`供汇总 |
| POST `/api/seo/workflow` | `{requestId, action, expectedVersion, record, claim?}`；操作为save_task/save_plan/save_approval/save_issue/save_optimization/record_publication/record_run/record_historical_import |
| POST `/api/seo/workflow/claims` | claim→renew→complete；共享数据库时钟、运行ID/阶段/时间唯一与递增fencingToken |
| GET `/api/seo/workflow/history?kind=task&id=...` | 不可变版本；不能覆盖人工批准的内容 |
| POST `/api/seo/periods` | 已结束区间独立查询的用户和注册人数，禁止日去重人数求和 |
| GET/POST `/api/seo/digest` | GET带`kind=daily|weekly`；POST prepare也显式带kind，按kind+date独立发送防重；平台无日报周报页面 |

网页操作需登录和同源校验，自动化的台账导入使用SEO平台生成管理的导入Bearer凭据，不能带Origin；该凭据不是登录、批准、合并或发布权限。生产没有数据库就返回不可用，不能悄悄写本地文件。开发预览显示local_preview，不代表生产入库。

## 一个任务的顺序

1. 创建研究/内容任务，使用具体站点、主国家、对应语言关键词、业务、页面类型、负责人、截止日、验收条件。候选为planned/researching。
2. 保存真实Ahrefs/SERP/GSC证据与业务价值；Volume≥10、KD<30优先，例外需理由。证据合格才ready/drafting。
3. 内容产物对应contentVersion。提交审批前必须具备独立测试环境HTTPS链接、绑定相同contentVersion的部署版本、简单变更介绍、桌面和手机截图。缺任一项保持draft/drafting并展示待补材料；齐全后才review_pending。所有页面及每个译文都逐项审批，改稿须新单替换旧批准。
4. 发布前保存baseline和上线版本。发布回执只有published；正式URL的HTTP、canonical、语言、内容、内链、发布来源回执完整后才verified。200不是Google收录。
5. 原文、翻译、补译使用独立kind和sourcePublicationId；同canonical/版本不重复计数。首次验收入库时间不可回写，迟到回执在下一统计窗口补记。
6. 优化次日起先看7个可比日、低量页看28天，必要时延长到56天，前后使用相同口径；数据不足标观察中，不写因果结论。问题关联到任务，解决需恢复证据。

保存时必须带当前expectedVersion。服务器返回409后先读新版本，不用新requestId把冲突数据覆盖。自动化不能修改人工已确认关键字段。

## 本机桥接与依赖

`scripts/seo-prepare-page-review.cjs --manifest=/absolute/manifest.json --out=/absolute/review`从真实文件生成任务及审批草稿，缺测试证据不会伪装为已提审。`scripts/seo-workflow-bridge.cjs --input=/absolute/commands.json`先逐条验证mutation及对应record schema，再进入持久outbox；输入按依赖排序：前置任务→后续任务→周计划→基线→已批准版本→发布/验收回执→完成回执。追加`--apply`才导入。`--claim=/absolute/claim.json --apply`领取；动作执行中续租，写回记录携带claim令牌，最后保存阶段回执再complete租约。

未知发布先检查远端CMS/生产版本，不盲目重发；outbox保留原请求与平台读回。只有storage=database才可标平台已同步。

## 通知切换

每日17:30、周五09:30通过digest API prepare生成日报/周报不可变快照；离线核对可用seo-digest-preview.cjs读取真实归档并标日期。两个发送cron在每日18:00（含周五）、周五10:00派发同一既有seo-daily.yml的report_only工作，不依赖主会话，也不再本地调用seo-digest-dws.cjs。

Actions执行scripts/server-seo-digest-send.cjs --kind=daily|weekly --date=YYYY-MM-DD，默认只预检，send_report=true才追加--send；普通发送prepare最新最终快照，禁止preliminary。审核恢复须传--report-id使用同一已冻结正文，不能改变本次报告hash；不会把18点后新工作塞进已领取的旧快照。

每份报告按首页及其他功能页、Prompt、博客、模型、GPU分块；显示真实点击/自然会话优质页、五站四国变化、优化效果、GitHub渠道、下一步及缺口。顶部有待审核任务/单/页面版本及待补材料数量；正文每模块Top1、最多3项待审/异常/下一步，完整版保留detailText。末尾“数据基础”链接三表和平台入口钉钉文档，密码不进报告。未核实数据保持缺失，不补0。

固定群Flatkey seo/geo保留原猫猫侠Webhook；GitHub Actions原SEO_DINGTALK_CONFIG负责签名，秘密不导出。数据库通知开关默认关闭，写入需要expectedVersion、协议2、transport=signed-webhook、固定群/原bot、真实配置指纹及审计原因；领取及begin都核验，环境变量不能绕过。报告独立kind+date原子claim→begin→签名Webhook→持久化真实HTTP200/errcode0/responseHash/acceptedAt/workflowRunId回执→finish。Webhook回执不伪造应用机器人processQueryKey。

结果UNKNOWN不得自动重发；已有提供方接受回执只reconcile补记。明确提供方拒绝必须凭严格绑定的错误与报告hash通过审计恢复同一报告；不能手动改数据库解锁。原本地DWS发送脚本仅保留历史兼容，不能作为定时任务备用发送者。

切换先验收日报/周报预览、真实交付和优化台账、三表/数据基础、实际任务启停，再预检取得旧Webhook配置指纹并更新数据库控制。SEO_UNIFIED_REPORTING_ENABLED=true关闭旧日采及排名单发；逐篇博客通知停止。一次只有一条相应kind的群消息。SEO_WORKFLOW_ENABLED控制区间去重采集，SEO_GA4_BUSINESS_COLLECTION_ENABLED控制GA4业务链采集；代码已写不等于业务事实已入库。

## 仅采集验收（不发群）

每日定时采集与手动默认均只刷新各属性时区内最近14个已结束日；保留数据库全部旧历史，不删除或把窗口外日期记为缺失。每次在日志和采集回执中记录实际各站GA4/GSC起止日与窗口大小。月度复盘发现历史缺口时，可显式选择手动 `lookback_days=90` 回填；脚本仅接受14或90，其他输入在请求前拒绝。90日回填仍须单独验收，不用每天重复90日读取替代增量。

同一运行先完成五站全局范围，再采四国切片；每个来源按最新日期优先，最多3条不同日期的独立采集/写入/读回流水线。每条成功写入仍验证完整payload；POST失败也只做一次读回，不盲目重发。出现失败停止分派该批新日期，等待所有在途读回结束，再将该来源标为失败并继续其他独立范围。无源数据、注册未核实和会话覆盖不完整仍保留缺失；不会为了出榜补0或放宽complete。GA4质量不完整时仅记录站点、国家、实际窗口、指标和白名单原因，不输出原始用户行或凭据。

`seo-daily.yml` 手动输入 `send_notifications` 为布尔类型，默认 `true` 保留现有行为。联调时明确设 `send_notifications=false`、`verify_dingtalk=false`：页面清单与五站全站/逐页 GA4、GSC 采集、生产读回正常执行；无论成功或失败，都跳过该运行的日采通知与测试消息。此开关只约束这一次 workflow，不修改18:00统一通知、其他定时通知或付费开关。`verify_dingtalk=true` 与通知关闭同时设置时，两类消息均不发送且采集不运行。

经授权的维护者可在变更已合入 `main` 后执行：

```sh
gh workflow run seo-daily.yml --repo AM-young-fun/flatkey-seo-roadmap --ref main -f lookback_days=14 -f send_notifications=false -f verify_dingtalk=false
```

验收需查看该次 run 的 `collect` 成功、`notify` 和 `verify-dingtalk` 均为 skipped，并核对生产按日的 `ga4-pages`（含 `hostnameDimension=hostName`）、`gsc-pages` 归档后再生成报告预览。失败只保留 GitHub 结果与采集回执，不发测试消息。定时触发受统一通知开关控制；切换验收前不得擅自启用新发送任务。

日报每来源的页面 Top 5 优先最近14天内的五站共同完整日期；没有共同日时，在最新来源日及向前7天内选择完整站覆盖最多的日期，同覆盖再选最新日。每榜最多5条，标实际日期、选择理由和覆盖缺口；不跨日期混排。

日报页面 Top 5 复用上述现有逐页数据，不依赖 `SEO_WORKFLOW_ENABLED`，无需为此打开新开关。该变量只控制独立区间去重用户/注册采集，须另按周/月数据验收启用。无完整页面覆盖、缺 hostname 或不同日期不可比时，日报应明确缺口，不用站点总数替代页面数据。

## 已验证与仍需生产验证

代码检查、生产构建、浏览器本地任务创建/冲突审核、局部与全套测试；独立PostgreSQL从旧schema执行增量SQL及重跑、并发领取、幂等回放、旧令牌隔离、UNKNOWN发送禁止重试。测试不调用付费排名、不发送钉钉、不写生产。

生产部署后的schema、实际Google新维度回填、任务回执导入、GA4 GPU/API业务事件、真实顺序漏斗与通知送达必须再取得真实回执；代码通过不能代替这些结果。集群注册与逐页跨域注册在未核实前保留空值。


## 所有页面发布必须逐项审批

新增、旧页更新、博客、每个译文、落地页、工具页、集群页，以及标题、描述、canonical、结构化数据等技术页面变更，均先提交平台审批。旧 `task.approval` 只允许已有历史字段原样保留，不得新建或改写。新建/切换 task 的 approved 状态（含 technical）必须已有对应逐页审批；`standing_new_blog` 不再是发布许可。历史补记 `historical_import` 仍是只读档案，不能生成新发布授权。

审批实体 `kind=approval` 使用已有 `SeoWorkflowRecord` / `SeoWorkflowEvent`，不新增表。`POST /api/seo/workflow` 使用 `action=save_approval`、稳定 `requestId` 和 `expectedVersion`。一单可含多个 URL/语言，但每项必须明确 `id`、`taskId`、`operation=new|update`、`pageUrl`、`language`、`contentVersion`、具体变更、改前/改后说明、证据；修改需 `baseContentVersion`。必须包含平台可读的完整 `reviewContent`（`reviewFormat=markdown|diff|text`）或可读取稿件，另须独立HTTPS测试地址、`previewContentVersion=contentVersion`、相同版本的桌面/手机截图及变更说明；只有本地路径、正式站链接或一个截图都不足以提审。外部链接须由审核人实际打开核对；文字版本标记不能替代对实际稿件的检查。

草稿可以修改；提交待审后，正文、URL、语言、版本、任务和替换关系锁定。`decisions[]` 每项包含选择的 `itemIds[]`、`decision`、`decidedBy`、`decidedAt`、说明和证据；服务器追加真实 `recordedAt`。只有登录平台的 `human` 操作可批准、拒绝、要求修改、撤回或替换，采集 token 只能提单和读取。审批状态可为 `draft/pending/partially_reviewed/approved/rejected/changes_requested/withdrawn/superseded`。整批批准必须明确选择全部项，不自动批准未选中的译文。

已提交稿件改动需新内容版本、新审批单，并填写 `supersedesApprovalIds` 指向对应页面语言仍有效的旧单。新单提交后，该页面旧授权立即失效；新单被拒绝也不会恢复旧授权。审批决定只能追加，拒绝/要求修改/撤回后不能在原内容版本上重新批准。所有更新使用乐观版本校验，冲突返回409，必须重新读取。

### 发布前接口

`POST /api/seo/workflow/approval-check` 仅核验，不发布、不写台账：

```json
{"approvalId":"approval-20261110","itemId":"page-en","taskId":"task-1","pageUrl":"https://flatkey.ai/blog/example","language":"en","contentVersion":"sha256:..."}
```

服务端采集器使用 `Authorization: Bearer <SEO_IMPORT_TOKEN>`，不带 `Origin`；平台用户使用已有登录会话和同源请求。成功返回 `allowed:true`、完整 `request` 回显、`approvalId/itemId`、`decisionId`、`decisionVersion`、`decisionRecordedAt`、`checkedAt`、`storage`。正式执行必须要求 `storage=database`；本地预览不能当生产许可。未批准、撤回、被替换、稿件版本/基线/任务失配返回409；未登录401，来源错误403，无数据库503。失败一律停止发布。

每次 CMS/部署动作前重新调用核验，不能把旧核验结果当可复用授权。核验只能证明查询时刻的状态，无法与外部 CMS 形成原子事务；实际发布回执仍在同一数据库图锁下再次检查。发布与撤回竞态若外部动作已发生、最终入库被拒，必须保留外部事实并作为异常人工核对，不能伪造成功台账或自动重发。

`record_publication` 必须携带 `approvalId`、`approvalItemId`，精确匹配批准的 URL、语言、任务和内容版本；实际发布时间不得早于服务器审批记录时间。唯一版本只能保存一次发布，重试沿用原请求ID。已被平台接受的真实上线回执可以在撤回后补充验收，撤回不会抹去历史发生的交付。

### 十语言博客与四国监控

现有十语言博客可使用一个真实源文任务，加每个 locale 独立审批项及独立发布回执。译文 `language` 保留真实语言，不强改为四国语言；非重点市场或无国家证据时 `country=null`，没有对应语言关键词证据时 `keyword=null`。这些译文不因此成为研究合格关键词或自动进入付费排名池。源文、落地页继续要求明确国家和本语言关键词；技术页面修改可不编造关键词国家。新工具的非目标市场本地化页可各建 technical 任务并逐项审批：operation=new 的发布记 kind=landing，operation=update 的旧页修改才记 kind=optimization，不能将新页伪记优化；这些技术本地化任务不会冒充周计划中需要关键词研究的主落地页任务。

工作台 `approvals[]` 默认保留跨周待审项；`summary.pendingApprovals` 和 `pendingApprovalItems` 按逐项有效状态计算，替换旧单不重复催审。日报从这里读取待审项并链接 `/approvals?approvalId=<id>`，不再以任务里一个“批准”字段代替逐页审批。


## GA4业务链与上线验证

所有业务保留完整链路：来源/落地页→页面与模块浏览→活跃阅读/步骤→CTA→注册或登录→业务操作→成功/失败→付款。GPU以成功租赁为核心转化，不另造“激活”；API保留首次成功模型响应/生成、Token消耗与付费口径。不能用相互独立的事件人数冒充同一批人的漏斗，停留采用可见且有活动的阅读时间，不把后台闲置当兴趣。

所有站内导航正常埋点；只有集群/公开GitHub提示词仓库引导到Flatkey时加可识别UTM。GA4是统计入口，SEO平台从已核实数据展示相关工作页面中的效果/优先级/跟踪；缺数据明确待接入。统一客户端手动page_view时，必须在同次生产发布关闭对应GA4增强型历史变更page_view，避免重复；未同意、拒绝、撤回以及本地预览不向生产属性上报。每站独立GID、关键事件与自定义维度均需生产DebugView/实时和后续Data API读回验收。
