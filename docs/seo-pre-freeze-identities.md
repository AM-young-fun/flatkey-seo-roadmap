# 冻结前市场身份审核

在原“季度1600关键词与方向决定”审核区使用“冻结前核定原词市场身份”。仅真实登录用户同源操作；采集token和本地预览不能代替人审。原`quarter-membership`的成员升池动作保持独立，本功能不升池、不标记研究ready、不改原词/主父/任务/排名或旧历史。

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

`spans`为原关键词的准确`{text,start,end}`，索引按JavaScript UTF16位置；语种来源摘录须包含该原词或全部申报span，不能错贴另一词的证据。不能用查询locale或页面译文推定语种。仅型号、品牌、共享缩写和型号版本不足以确认，和既有明确词语种证据冲突也拒绝。没有可核来源的项继续留缺口，不伪造证据。

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
