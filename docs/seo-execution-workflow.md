## 任务详情说明（2026-11-19）

任务详情统一使用中文，目标关键词、产品名、代码与 URL 保留原文；文章仍按任务的目标语言制作。任务记录保存 `brief.reason` 和 `brief.plan`，不把外语制稿指令直接当作中文任务说明。`nextAction` 保留原执行交接细节。

- `brief.reason`：写清来源、日期、国家、查询/页面口径和关键数值，解释数据暴露的具体问题及业务影响；明确哪些是事实、哪些是待验证假设。搜索量和 KD 只能佐证需求和优先级，不能作为页面存在问题的证据。样本小、缺数、未见查询行时不得写成点击率差、零需求或确认无覆盖。新页面需说明搜索意图与已核实的现有内容缺口；去重尚未完成则说明先核验、满足什么条件才新增。
- `brief.plan`：对应上述每个问题，说明准备改哪个页面/模块、补什么内容或功能、保留什么口径、怎样验证。只写“优化 SEO”“提高转化”不合格；证据不足时先写需要核实的事项，不编造诊断。
- 每次创建、排期、领取及更新任务时同步核对中文说明，沿用原任务 ID、证据和执行历史。历史任务尚无 `brief` 时显示待补，不能把孤立指标或外语指令当作已完成的说明。
- 后续自动生成的新任务必须另存 `brief.problem`（具体问题）、`brief.actions`（逐项 `{target, change, verify}`）和 `brief.evidence`（真实证据引用及原始采集时间）。标题、执行说明和验收要求也使用中文，原语言文章标题或关键词加引号引用。平台在新自动任务创建、候选进入可制作、重新安排日期，以及任务首次进入正式计划时校验；缺失、外语或笼统说明会被拒绝，不能凑数排期。已有任务的状态/回执更新和未改变任务集合的历史计划更新继续保留原说明。候选证据不足时，只能写清已知事实、缺口和核查方案，不能捏造来源或宣称已确认页面问题。

新任务示例（文章目标语言仍可为英文）：

```json
{
  "brief": {
    "reason": "GSC 历史目标词页数据有67次曝光、0次点击，平均排名约8.5，说明已有展示但尚未形成点击；需要核查摘要和首屏是否对题，数据本身不能确定原因。",
    "problem": "页面已获得相关查询展示，但没有点击，具体原因待核查。",
    "plan": "先对照搜索结果与原稿核查，再调整对应标题、摘要和首屏，按同口径复盘。",
    "actions": [{"target": "目标URL的标题、描述和首屏", "change": "补充直接回答目标查询的规格与用途摘要。", "verify": "留存修改前后版本，并按同国家与查询比较点击曝光。"}],
    "evidence": [{"label": "历史GSC精确词页导出（示例须替换为真实产物）", "artifact": "/absolute/path/to/real-gsc-export.json", "observedAt": "2026-11-13T10:19:45.050Z"}]
  }
}
```


例如：历史 GSC 显示目标查询 67 次曝光、0 次点击、平均排名约 8.5，可写“已有展示但尚未获得点击，先核查摘要和首屏是否直接回答查询；数据本身不能确定原因”，再写清将核对与调整的具体内容。7 次曝光、1 次点击则不能直接诊断点击率低。

> 当前流程以平台为准：关键词和 TopicMap 在平台维护及下载，旧三表同步已退役。新博客、旧博客与 Prompt 按各自质量门槛自动处理；其他页面变更按独立分支送审，审批绑定测试链接、截图及提交 SHA。定时执行器按现有仓库权限发布批准版本，正式读回后进入监控。

自北京时间 2026 年 11 月 16 日这一工作周起，任务列表和执行器通过 `GET /api/seo/workflow?operational=1` 读取本期排期及之前各期尚未完成的任务。到周一零点，未完成项沿用原任务 ID、排期、稿件、分支和审批记录进入本期，界面显示「延期」及原计划日期。此前任务和已验收交付保留在历史记录。每轮扫描当天及此前已到期的任务。发布队列沿用同一工作范围，原批准仍绑定原提交，跨周继续有效；提交变化时须重新送审。

周四准备候选，周五 10:10 保存下周正式排期，供周报引用。工作列表分为博客制作、博客优化、落地页制作和落地页优化。执行器从 10:15 起每小时领取当天到期或延期的工作，修复失败的原任务，补齐缺失的测试材料。已送审的版本等待决定，通过后交给发布执行器。按中国法定工作日和官方补班日执行现有排期，关键词研究跟进只解除已排期任务的研究依赖。技术质检以独立回执记录，实际代码修复沿用审批流程。

扫描会话预约任务并创建独立执行会话，回报任务名和执行会话链接。执行会话验证原预约后只处理一个任务，沿用原 ID 回填结果。本周已验收交付在工作列表中可查，执行队列只读取未完成任务。

# SEO 执行接口与切换验收

## 落地页制作前的去重检查

排期和领工前，按目标站点与页面语言核对正式路由、重定向和 canonical、SEO 平台 TopicMap 和已排期任务，以及 GSC 中目标词已有展现的 URL。核对现有页面是否提供同类型功能、服务或转化入口，并记录对应 URL 和搜索意图。

找到同类型且能承接目标搜索意图的页面时，按旧页优化登记到原 URL，沿用它的 canonical 和数据基线。若原有新建任务已经送审，保留原任务证据，按工作台流程停止该版本的发布，再按旧页优化安排。仅在完成检查且没有现有页面可承接时排新落地页。


## 发布规则（2026-11-12 用户最新决定）

仅 SEO 平台 `AM-young-fun/flatkey-seo-roadmap` 和 JEV `AM-young-fun/jev-llm` 恢复 main 自动部署。合并 main 会触发现有 Vercel 生产发布，因此精确版本审批、仓库正常合并规则和明确生产发布授权必须在合并前满足。研究、制稿、采集与运营台账权限不等于合并/发布许可；原有任务时间、启用状态和通知范围不变。

获准合并后只跟踪本次部署，记录仓库、PR/commit、精确 SHA、部署入口与实际结果；正式域名读回目标版本并验收成功后才记上线/observing。供应商拒绝时保存原因并停止，不无变化重推、不改变提交身份/权限来规避拒绝。

JEV 正式部署 `7d93f13389f900f76beb489107d55c6f255d2726` 已验证，包含 ba6d3ca/f1847fa：未同意不加载统计、允许后使用原有 GA4 ID、拒绝刷新后不加载、旧 GTM 已移除，UTM 实链和双端检查通过。此前 ba6d3ca 作者权限拒绝仅保留历史；不能继续标记本次待负责人发布，也不能据此推断所有作者以后都有权限。后续生产必须按精确版本审批和授权跟踪实际部署结果；真实业务转化回执仍单独观察。

其他 Vercel 项目仍按既有默认规则：经授权合并后在当前任务结果通知用户发布，未发布保持待发布；不把合并当上线。明确授权的阿里云生产流程不受本段改变。旧文档或 runtime 中“所有 Vercel 项目统一交用户发布”的表述被上述两个项目的精确例外覆盖，不能扩展到其他站点。

采集覆盖 Flatkey、JEV、Mochi、ModelFit、RackRate 五站，内容执行覆盖 Flatkey、ModelFit 和 RackRate；JEV、Mochi 仅做流量观察。市场为美国、日本、巴西和西班牙；业务以 GPU 算力租赁为主、API Token 为辅，SEO埋点及报表统一 GA4，SEO侧暂停读取 Amplitude；产品原有 Amplitude SDK、初始化和后台投递保留，不删除或停用。新官网建设不在本轮范围。

工作计划仍按周一至周日建档：周四16:30候选、周五10:10定稿，包含下周落地页和博客的本国语言关键词。周五11:30群发周报，统计上周五00:00至本周四23:59:59；每天18:00群发日报，周五也照常发送。日报交付窗口为上次18:00至本次18:00。GA4/GSC各按来源实际数据日和时区显示，数据延迟不能假称完整周期。

本文件取代 `weekly-workflow.md`、`dataforseo.md` 内历史日程/页面规划；排名付费周期仍以已授权线上期次和配置为准，不据文档重新定相位或增加费用。配置、代码、本地验证、线上发布和真实运行回执是不同状态。

## 本机定时任务

以下为已通过 Codex automation_update 配置的时间，启停以 `/automations` 的实际配置快照及本机配置回读为准；不能因列在表中就假定已启用。

| 时间（北京） | 任务 ID | 工作与依赖 |
|---|---|---|
| 工作日10:10 | seo-09-00-github-traffic | 采集两个 GitHub 仓库的 Traffic，核对生产读回 |
| 工作日10:15–23:15 每小时 | flatkey-5 | 统一处理正式排期的研究、制作、优化、审批发布和监控 |
| 每日10:30 | seo-10-00 | Flatkey、ModelFit、RackRate 技术与收录巡检 |
| 每日10:30 | automation-2 | Prompt 素材核验与自动导入 |
| 周二/周四15:30 | seo | 推广研究及旧文轮查 |
| 工作日16:00 | seo-16-00-ga4-search-console | 五站本机 GA4/GSC 采集并核对生产归档 |
| 工作日16:15 | seo-09-10-flatkey | 本机会话采集 Flatkey 账户注册，核对报表 |
| 工作日16:25 | seo-16-25 | 本机采集回执与生产日期、覆盖和缺口核对 |
| 工作日17:30 | seo-17-30 | 日报预览 |
| 每日18:00 | seo-18-00 | 最终日报，按报告门槛核验 |
| 周四16:30 | seo-14-00 | 下周候选及证据草案 |
| 周五10:10 | automation | 下周工作及关键词定稿 |
| 周五11:00 | seo-09-30-2 | 周报预览 |
| 周五11:30 | seo-10-00-2 | 最终周报 |
| 月初首个周一至周五的日期15:00 | seo-2 | 月度复盘与资源分配，非工作日跳过 |

已暂停的旧研究、分站执行、页面优化和审批发布任务留在平台配置历史中。日采按工作日触发，每次回看近 14 个已结束日；Vercel 排名协调每天 10:10–23:55 每五分钟检查，付费开关和费用预算独立管理。本机任务需要电脑与 Codex 可用。


## 关键词和周计划契约

美国英语、日本日语、巴西葡语、西班牙西语分别研究，使用对应市场的语言。研究结果和 TopicMap 直接保存到 SEO 平台，去重、关联目标页并保留证据，不再同步旧三表。DataForSEO 按关键词目标国家取排名，排除自有品牌词；失败查询不算掉榜。

正式计划使用 `cadence=workdays`：每个工作日安排英文源文 2 篇，日文、巴西葡语和西班牙西语各 1 篇；普通五天周为 25 篇，翻译另计。2026-11-19 用户更新：Flatkey 暂停新建落地页，其原额度全部转给 RackRate 与 ModelFit。从 11/23 周起，工作日数为 D 时 `landing=0`，`clusterLanding=D+min(2,D)`，普通五天周两站合计最多 7 个，节假日与补班周沿原总额度转移；两站根据独立意图和证据分配，不为填满额度新建。Flatkey 仍每工作日最多优化 2 个页面。优先持续更新站点现有模型、硬件、价格、供应商和地区等板块，再按独立需求逐页增加入口。周四 16:30 整理候选（`draft`），周五 10:10 定稿（`scheduled`）。研究必须符合原词原市场10条自然结果、前5实际读取逐页3C和完整去重；不通过退回原任务待研究，不制稿或发布。历史计划、任务身份和回执保留。

博客制作、博客优化、落地页制作和落地页优化的研究记录统一保留目标市场及语言的前 10 条自然结果 URL、来源与日期；逐页打开前 5 条记录页面类型、呈现形式和切入角度。遇到搜索接口无结果或打不开的页面，明确写出缺口，补齐后再排期。重复使用资料时核对同一关键词、市场和语言。


## 按站点执行发布与审核

Flatkey 落地页和页面改造继续走独立测试环境和逐页审批。集群站使用独立工作分支，按仓库生产检查和发布规则上线；正式页面核验通过后，以精确分支 SHA、合并 SHA、部署回执和正式页提交上线后审核，无需测试预览。通过后结单；拒绝或要求修改后，Codex 从 `GET /api/seo/workflow?rollbackQueue=1` 读取任务，按精确提交撤销，并回填正式部署和页面核验。若主分支已有后续改动或目标页面版本不一致，保留阻塞，不强制重置或覆盖后续工作。

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

每日17:30、周五11:00通过digest API prepare生成日报/周报不可变快照；离线核对可用seo-digest-preview.cjs读取真实归档并标日期。两个发送cron在每日18:00（含周五）、周五11:30派发同一既有seo-daily.yml的report_only工作，不依赖主会话，也不再本地调用seo-digest-dws.cjs。

Actions执行scripts/server-seo-digest-send.cjs --kind=daily|weekly --date=YYYY-MM-DD，默认只预检，send_report=true才追加--send；普通发送prepare最新最终快照，禁止preliminary。审核恢复须传--report-id使用同一已冻结正文，不能改变本次报告hash；不会把18点后新工作塞进已领取的旧快照。

每份报告按首页及其他功能页、Prompt、博客、模型、GPU分块；显示真实点击/自然会话优质页、五站四国变化、优化效果、GitHub渠道、下一步及缺口。顶部有待审核任务/单/页面版本及待补材料数量；正文每模块Top1、最多3项待审/异常/下一步，完整版保留detailText。末尾“数据基础”链接三表和平台入口钉钉文档，密码不进报告。未核实数据保持缺失，不补0。

固定群Flatkey seo/geo保留原猫猫侠Webhook；GitHub Actions原SEO_DINGTALK_CONFIG负责签名，秘密不导出。数据库通知开关默认关闭，写入需要expectedVersion、协议2、transport=signed-webhook、固定群/原bot、真实配置指纹及审计原因；领取及begin都核验，环境变量不能绕过。报告独立kind+date原子claim→begin→签名Webhook→持久化真实HTTP200/errcode0/responseHash/acceptedAt/workflowRunId回执→finish。Webhook回执不伪造应用机器人processQueryKey。

结果UNKNOWN不得自动重发；已有提供方接受回执只reconcile补记。明确提供方拒绝必须凭严格绑定的错误与报告hash通过审计恢复同一报告；不能手动改数据库解锁。原本地DWS发送脚本仅保留历史兼容，不能作为定时任务备用发送者。

切换先验收日报/周报预览、真实交付和优化台账、三表/数据基础、实际任务启停，再预检取得旧Webhook配置指纹并更新数据库控制。SEO_UNIFIED_REPORTING_ENABLED=true关闭旧日采及排名单发；逐篇博客通知停止。一次只有一条相应kind的群消息。SEO_WORKFLOW_ENABLED控制区间去重采集，SEO_GA4_BUSINESS_COLLECTION_ENABLED控制GA4业务链采集；代码已写不等于业务事实已入库。

## 本机采集与验收（不发群）

本机任务 `seo-16-00-ga4-search-console` 直接查询 Google，沿用生产导入和逐条读回。历史补采按明确日期和国家范围续跑。GitHub 的 `SEO_SERVER_COLLECTION_ENABLED` 已关闭，日报周报仍走原有独立发送入口。下列 GitHub 手动采集命令仅作为历史运维记录。

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
