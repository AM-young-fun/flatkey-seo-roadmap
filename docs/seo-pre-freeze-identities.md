# 冻结前市场身份审核

在原“季度1600关键词与方向决定”审核区，先使用“核定同一1600原词的正式成员与已审话题”，再使用“冻结前核定原词市场身份”。仅真实登录用户同源操作；采集token和本地预览不能代替人审。原`quarter-membership`的成员核定动作保持独立，身份部分不升池、不标记研究ready、不改原词/主父/任务/排名或旧历史。

成员审核组件接受原完整selection，或包含同一selection的身份审核包。先读取真实预览，显示全部原ID/词/已审Topic及仅RESEARCH→FORMAL的实际变化数，再明确确认。提交使用预览返回的canonical manifest，原来源文件字节和sourceHash不改。未知结果只GET同一`membershipRequestId`的原审计，读回原请求、完整名单及当前全部成员/真实TopicMap边；不会再次apply、覆盖后续编辑、自动补身份或批准季度。审计验证成功的已审话题只供当前季度目标投影消费，不修改DB主父/旧边或历史期次。

## 审核包

上传JSON，外层为`{review,quarterPlan?}`，或直接上传review。每批1–200项、文件小于1.9MB；每批都携带同一完整1600规范原词清单，不截取名单或扩大N。

`review`字段：

- `version`: `pre-freeze-identities-v1`。
- `selection`: 原`quarter-membership-v1`确切名单，包含quarterId、sourceReference、sourceHash及真实`siteDomain/keywordId/keyword/topicId`成员，1600个规范原词（跨站成员可多条）。
- `selectionHash`: 对成员按siteDomain/keywordId排序后，使用现有`quarterMembershipHash(selection)`计算。
- `assignments`: 本批真实原成员及本次`country/language`，必须精确匹配selection和当地语言。俄语不新增研究初始化；旧CN不改为SG。

每条assignment包含两个证据对象：

| 对象 | 字段 |
|---|---|
| demand | reference、observedAt、content、sha256、quote、exactKeyword、country、language、metric、value |
| wordLanguage | reference、observedAt、content、sha256、quote、language、spans、reason |

`content`是实际来源的UTF8文本；`sha256`是其确切字节SHA256；`quote`必须是content中的原文片段。服务器复核字节和时间，不自动外查。需求必须来自同词/同国/同语种，`metric`为monthly_searches、clicks或impressions，value为真实正数且原文包含该数值，不能借种子量。人审仍必须核对实际来源行，哈希绑定不冒充供应商真实性证明。

需求来源只有真实日日期时，`demand.observedAt`使用原日历日`YYYY-MM-DD`，同时提供`timePrecision:"day"`及`observedAtOriginal`（来源的真实`YYYY-MM-DD`或`YYYY/MM/DD`原值，须在content中可核、归一后为同一天）。原值、日精度和缺少钟点/时区的事实保留到审计及市场说明，不补00:00或编造offset。这是已知日期，不计入113条历史时间未知例外。原ISO时点路径不变；语种证据仍必须真实ISO时点。

需求来源已明确列为人审历史时间未知例外时，仅`demand.observedAt`可保留`null`，不得用本次审核时间冒充指标采集时间。此时必须提供`demand.historicalTimeUnknown`：`acknowledgement:"historical-time-unknown"`、`selectionSourceHash`（精确等于selection.sourceHash）、`keyword/country/language`（当前原词原国原语种）、`sourceSha256`（该需求原文SHA）和不少于12字的`reason`。缺任一绑定或错贴其他行均拒绝；已有真实指标日期的行不使用该例外。

界面在真实预览后单列未知数量、逐词来源SHA及原因，须另行勾选接受本批例外。应用命令也必须带`historicalTimeUnknownAcknowledged:true`；审计保留原`null`、逐词绑定及明确确认，新增市场evidence注明历史指标日期未知。`reviewedAt`仅指本次人审。`wordLanguage.observedAt`仍须真实ISO时间，正需求值、原词语种、主国冲突、排名新鲜度和效果观察时间规则均未放松。

`spans`为原关键词的准确`{text,start,end}`，索引按JavaScript UTF16位置；语种来源摘录须包含该原词或全部申报span，不能错贴另一词的证据。不能用查询locale或页面译文推定语种。仅型号、品牌、共享缩写和型号版本不足以确认，和既有明确词语种证据冲突也拒绝。没有可核来源的项继续留缺口，不伪造证据。

两类明确词义按精确语境核验：美国英语词的`base URL`端点短语中对应的`base` span可作为该短语证明，普通模型名中的base仍不通过；德国德语原词`ki api`的`ki` span仅在真实语种摘录同时明确`KI`与`Künstliche Intelligenz`展开时通过。不会因为locale或任意缩写放宽门槛；兼容性问题可增补原词内真实`compatible` span，不能凭两字母is确认语种。

可选`quarterPlan`是原完整`quarter-planning-v2`方向/预算方案，不是简化身份表。没有这个字段时，界面复用当前已保存的完整草稿。

## 预览与确认

1. 读取真实预览，核对每条原身份、需求、语言证据和create/reuse结果。
2. 确认本批缺失身份。原主国同国同语言有效记录逐字节复用；不同主国/语言、无效旧记录或冲突语种一律409，不覆盖、不加副国。
3. 同事务仅创建缺少的`SEO_MARKET_ASSIGNMENT`与独立`SEO_HUMAN_WORD_LANGUAGE_REVIEW`记录，并存KeywordCurationAudit。原成员、词、话题、季度状态及旧源完整读回必须不变。语种审核独立存放，后续正常研究更新市场记录不会擦掉证明。
4. 原请求编号在浏览器会话保留；未知结果只按原编号读回，不能自动换ID或重提。只有原审计和完整源状态读回一致才显示成功。

现有API新增`preview_identities`/`apply_identities`动作，仍走原真实human cookie和同源鉴权。应用命令额外带`requestId`及本次preview的`expectedStateHash`；GET `?identityRequestId=...`只读原回执。首冻或截止后拒绝新初始化，原幂等审计仍可读。

## 继续季度方案

市场从null补成US会改变派生targetId及sourceVersion。身份apply不暗改quarterPlan。全部身份准备后，点击重读方案，严格从同一稳定1600原ID清单解析当前目标，只更新targetIds/sourceVersion，保留方向、预算和原任务预留。正常`save_quarter_plan`保存后仍是待审，需另外明确批准才能首冻；此页面不会approve/freeze。

新human语言证明只影响当前目标。workspace读取前校验原词/ID、snapshotHash及human审计批准的逐行哈希；旧期投影过滤current-target-only证明，不重写历史。缺失身份初始化也不授权任何新付费、Google配置、采集任务或发送。
