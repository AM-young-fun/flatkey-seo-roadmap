# 每周 TopicMap 复盘

本流程由既有 `seo-09-30-2` 全年固定在北京时间周四16:30开始的周报任务内串行执行：归因草稿归档／读回 → 同周期TopicMap及隔周关键词复盘 → 结论去重关联任务、真实可写调整及生产读回 → 第六块改动摘要与完整待审正文。不依赖群发送完成，不另建job或poller。`seo-14-00` 候选仍周四16:30，`automation` 正式定稿仍周五10:10；它们只增加消费本周期复盘依据的依赖，其他时间、状态、模型、通知及任务合同不变。

> 2026-11-22用户批准将周报、关键词复盘接入原页面／博客／优化执行。完整合同见[内容反馈流程](seo-content-feedback-loop.md)。本次新增允许为有真实依据且没有对应原任务的新问题建立planned研究／review候选，不替换已有任务、不跳过研究／排期／审批，也不启用付费。统计仍LA周四至周三；固定北京时间16:30对应冬令LA00:30、夏令LA01:30，旧LA00:30窗口不作为夏季提前执行的依据。

## 输入与顺序

1. 完成洛杉矶上周四至本周三的周报归因，按原 `prepare`／`read_saved` 保存并精确读回原草稿ID、哈希和周期。保留真实页面标题＋完整URL、同口径 page／query／country／source 证据、取数时点及来源限制；不伪造用户批准时间。
2. 读取权威生产 TopicMap、关键词、原任务／计划及既有复盘回执。先以 LA 起止日检查本周期是否已处理，再以首次草稿 `reportId` 绑定该周期复盘。旧外部表、旧11agents清单和本地证据只供追溯，不替代权威平台。
3. 分析主要正负贡献，并检查近28日／90日持续性、业务关联、样本和季节／渠道背景。维度不能混加、GA会话不能借GSC点击解释；缺行、受限、旧期排名不是0。市场增长可以作证据，不能擅自改变原关键词、国家或制作语言。
4. 对已发布页面、CMS全量草稿、预留／在途任务和搜索意图去重，再形成少量有证据的候选调整。区分新内容机会、旧页优化和继续观察；已有页面可承接则优先保留原页，不为同一意图换词或建替代行。
5. 对现有Topic做经完整图核对的可逆字段／关系增补，原研究任务则沿版本／CAS追加优先建议；不存在的字段不虚构。Topic接口没有原子CAS时如实记录，用写前临近重读、单行正常请求和完整读回约束，不能仅因无CAS一概停为纯建议。具体行无法确认身份、并发或关系合法性时不应用，留明确原因。逐项生产读回后保存回执，不以本地文件代替入库完成。
6. 将复盘结论、实际字段／关系before／after、原因、页面／证据链接、生产读回的原taskId／新候选taskId及具体下一步补进固定六块周报的第六块。新待审正文只保存本地及原 `prepare` 关联证据；完整贴给用户并获该确切版本明确批准后，才能记录真实 `approvedAt`，使用 `save_reviewed`／`read_saved` 及原发送器。周报发送自动化继续暂停，周四日报仅归档。

## 真实接口与字段边界

每次运行先核对生产返回和最新schema。历史TopicMap接口只读审计保存在私有产物 `.local/weekly-la-report-20261119/attribution/topicmap-review/api-contract.md`，不是生产依赖，后续以实时合同为准。`GET /api/seo/workflow?topicMap=flatkey.ai` 返回数据库 Topic／TopicRelation 的 `id/text/type/parentId/updatedAt`，不是独立priority表。

Topic正常POST当前真实字段为 `siteDomain=flatkey.ai|rackrate.org|modelfit.cc`、原 `text`（trim后1–220字符）、`type=MAIN|SUB_TOPIC`、可选 `parentId`。按唯一text upsert并保留原ID，但会同时设置active=true并upsert站点成员。因此当前只对已确认active、原本属于目标站且非未经授权跨站共享的既有Topic操作，不能借upsert复活inactive或增加跨站成员，不改text/身份；字段不可见就不能假定已通过。未知priority等字段会被schema剥离，HTTP200不能证明保存。

服务端仅检查父节点存在和不直接自指；祖先循环、父类型／活性／同站条件须由job写前读完整图校验。`SUB_TOPIC`改parentId只增新TopicRelation，不删除旧父边；回执必须区分主父字段变化与多父关系增补，不能说排他“移动／合并已完成”。`MAIN`会删该child全部父边，不默认用于自动清理。自动只应用有证据、完整图核对后的可逆字段／关系增补；若预期是排他移组、删旧边或合并而现接口不能安全表达，只留before／after建议和未应用理由，不以临时MAIN→SUB多步写绕过清边。

Topic接口无原子CAS／请求ID协议时，不假称具备这些能力：按id/text/updatedAt及完整关系写前临近重读，发现变化先重新评估；单行按原schema仅写一次，核返回 `created=false`、原topic.id，再GET核对type/parentId/updatedAt、完整relations及站点成员；保留完整before／after和稳定逻辑动作键。读回出现预期外边或身份变化即停止后续，记录差异，不盲重试。关键词／SiteKeywordTopic、canonical、任务状态及已发身份保持。

不存在priority字段时，优先建议及复盘回执的默认落点为既有 `POST /api/seo/workflow` 的 `action=save_task`：仅对已有 `kind=research` 且 `status=planned/researching` 的原候选，在 `nextAction`（最多3000字符）和 `evidence`（最多100项）追加有依据的建议及回执引用，稳定关联原rowId／keywordId；不改 `brief` 触发新的六项质量校验，不动ready、已排、已发任务身份。按严格schema剥除只读version/recordedAt/updatedAt后提交完整合法record，顶层expectedVersion保留，其他可写字段原样保持。没有priority字段时不假报正式字段已改；没有合适原任务且结论有真实证据时，按2026-11-22授权先核全量历史任务／issue／计划、CMS及在途意图，再创建planned的research／review候选及关联issue，逐项生产读回taskId。稳定问题身份按站点、市场语言、真实页面／意图与具体问题确定，不含报告ID或周期日期；周报和关键词复盘共用同一taskId，多个匹配或证据不足先核查，不新建替代任务绕过原任务失败／审批。完整去重及字段保留见[内容反馈流程](seo-content-feedback-loop.md)。

原计划 `notes` 最多5000字符、`evidence` 最多100项，虽然已有 `save_plan`＋expectedVersion接口，但备注写入也会重新校验整份计划并触发既有任务市场分配同步，故不作为本流程默认落点。确实需引用原计划时，先核对整个原合同及副作用均在既有权限内且原任务／市场分配不变，才使用原record、版本、ID/weekStart/taskIds/targets/status等完整字段；失败保留未完成，不删旧字段或伪造审核信息绕过。`brief` 的reason/plan各3000字符、problem2000、actions1–20、evidence1–100等现有质量合同不因本复盘豁免。

逐项GET原taskId或对应week，核对 `record.id/version/updatedAt`、精确新增建议与所有保留字段。POST须真实 `stored=true`、`storage=database`，重试若返回 `replay=true` 仍读回；409冲突先重读，不沿用旧版本。不伪造priority/group字段、不增加数据库结构、不绕过状态或租约限制。分别报告已完成的Topic字段／关系增补、候选优先建议和未应用项；仅保存建议时明确相应正式字段未改。

用户授权正常TopicMap内容管理，无需重复询问是否可写；授权只覆盖既有正常接口的可写内容，不授权删除／重建行、改原词／市场／语言／canonical／状态、强行合并已发文、替换已排任务，亦不增额度、付费、发布或产品代码权限。GA／GTM／GSC仍只读，页面分析仅Flatkey／RackRate／ModelFit公开官网，博客仅Flatkey／ModelFit。

## CAS、幂等与生产回执

- 使用稳定rowId／keywordId定位，工作流先读当前完整记录和版本，再用稳定requestId及expectedVersion／CAS提交最小变更；Topic按上述真实无CAS合同写前重读、单行写及读回，不往不支持的schema塞requestId。请求不明时先读回，不盲目重复写；冲突重读并保留并发新增项，只重算原未完成差异。
- LA start/end是每期复盘once主键，reportId绑定输入子版本和reviewKey；这和跨报告／跨周的稳定问题身份分开，不能因新报告ID而重复建任务。每次先查生产同周期回执，逻辑动作键稳定到具体原行／变更；后续报告数值或正文换ID只追加同一review的差分版本、证据和关联，不重跑全表。已成功且无新证据的改动不重复写。
- 生产回执写入现有schema允许的原备注／研究证据／工作流记录，至少保存：LA周期、首次及当前reportId/hash、来源日期与28／90日依据、rowId/keywordId、版本、字段before/after、实际应用／仅建议／未完成数量、原因和生产读回。长证据可由备注引用可追溯产物，不能删除原备注腾空间。
- 若备注长度、schema、状态或接口不足以持久化该回执，保留本地副本和准确缺口但不标生产复盘完成，也不因此重建任务或循环全量写表。最后成功值与回执继续保留。

## 候选与正式计划的并发依赖

周四16:30候选任务与周报任务可能并发。候选可以先做不依赖新优先级的独立关键词／SERP研究，但必须注明本周期回执是否已消费；不能把旧优先级或本地计划描述成本期生产读回。周五10:10正式定稿前，重新读取同周期复盘回执、before／after依据、未完成项及权威表当前值，再选题／定序。

缺少回执时沿原周期补齐或记明确依赖缺口，不造一份替代复盘，不擅自移原日程。研究、去重、真实关键词身份、原站点／语言及完整SERP门槛不变；未通过不进入制作／正式排期。复盘不是新增内容额度或发布审批，也不能把在途任务复制到下一周占位。

## 正式排期及效果回流

候选和周五定稿读取本次生产任务回执；`save_task`成功仅表示候选存在，研究通过并进入原正式计划`taskIds`、CAS保存及生产读回后才算进入执行。已排任务不复制到下周占位，小时执行器继续按原预约／依赖领取。页面、博客及优化按原站点范围、额度、完整研究与审批发布流程处理。

真实上线后的7／14／28天观察沿原任务保存基线、实际可比窗口、指标及下次检查条件，不改原dueAt超出weekStart、不每轮另建同问题任务。交付完成和效果改善分别核实，后续周报消费实际复查结论并据此调整主题／关键词。统计及模板、周四日报不发送、周报确切版本先审后发的要求不变。
