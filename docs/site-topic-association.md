# 本站关键词仅增话题关联

`/api/keywords/topic-associations` 只为已有本站关键词增加一条已有本站真实话题关联。仅正常登录用户可用；写入还必须同源。采集凭据、本地预览、数据观察站点均不接受。

它不创建词或话题，不提升正式池，不改变季度成员、主话题、全局父词、来源、页面、审批、任务或旧边，不跨站共享话题。制作/排期仍须通过原研究、方向审批及正常任务资格检查。

## 预览和写入

先GET带 `siteDomain`、`keywordId`、原文 `keyword`、`topicId`。三个可写站点为 `flatkey.ai`、`rackrate.org`、`modelfit.cc`。响应的 `state` 是完整原词、本站成员、目标话题、本站话题关系及旧关联，`stateHash` 为本次完整状态指纹；不以不存在的成员updatedAt冒充版本。

核对后POST单条严格命令：

```json
{
  "action": "add",
  "requestId": "topic-association:stable-operation-id",
  "siteDomain": "flatkey.ai",
  "keywordId": "original-keyword-id",
  "keyword": "original exact keyword",
  "topicId": "existing-site-topic-id",
  "expectedStateHash": "<fresh GET stateHash>"
}
```

服务器在Serializable事务中锁定请求、本站导入与原实体/旧边，重读源hash；仅增加所选`SiteKeywordTopic`边，并用既有`KeywordCurationAudit`保存完整before/after及原回执。完整读回必须恰好等于“原状态加这一边”，否则整事务取消。没有新schema或宽泛成员导入。

`receipt.status` 是 `created` 或 `reused`，含确切 `beforeHash`、`afterHash`、`createdEdge`、`appliedAt`。相同requestId与完全相同命令返回原回执及时间，`replay:true,currentStateVerified:false`；不能将历史afterHash当作此刻状态未变化的证明。按同一身份重新GET才取得当前状态。

## 冲突和不明响应

- 预览后任何保护字段或旧边变化：409，未提交写入。重读预览和具体差异，不自动重试。
- 同requestId换payload、审计不匹配或事务并发冲突：409，不覆盖原记录。
- 原词/本站成员不匹配：404；跨站、inactive或占位/候选容器：422。
- 未登录401；collector、本地预览或异源写入403；额外payload字段400。
- 写响应不明时先GET `?requestId=<原requestId>` 读原审计；没有原回执时再读当前预览，不以新编号盲重发。

原回执GET同样要求真实登录，不修改关系。接口没有删除或替换旧边的动作。
