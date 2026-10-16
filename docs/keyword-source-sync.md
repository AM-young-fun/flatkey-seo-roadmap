# 三张协作表的每日增量同步

每天北京时间10:30的现有任务先通过DWS读取三表，确认真实表头后按稳定编号／语言／slug定位，不能以当前行号作身份：

| sourceId | 节点 | 工作表 |
| --- | --- | --- |
| api_main | P7QG4Yx2JpQn6qlZHqdNP3n989dEq3XD | kgqie6hm／总表 |
| cloud_main | EpGBa2Lm8a0NEam1UzaaEwBbJgN7R35y | kgqie6hm／总表 |
| optimization | YQBnd5ExVEYy670pc6vvKzDzVyeZqMmz | kgqie6hm／SEO优化清单 |

`POST /api/keywords/source-sync`接受既有导入Bearer密钥或管理页登录会话。管理页原有JSON导入框可直接识别`kind: "source-sync"`，不用另建页面。字段完整定义在`src/lib/source-sync.ts`。

```json
{
  "kind": "source-sync",
  "requestId": "source-api_main-content-hash",
  "targetDomain": "flatkey.ai",
  "action": "preview",
  "sourceId": "api_main",
  "rows": [{
    "rowKey": "id-001-en",
    "completion": "PENDING",
    "publication": { "pageVerified": false },
    "keywords": [{
      "keyword": "example model api",
      "role": "PRIMARY",
      "relevance": "REVIEW",
      "reason": "需核实业务意图和对应页面",
      "pageIntentMatched": false
    }]
  }]
}
```

先逐批preview，再立即用当前stateHash作为expectedStateHash应用同一批；应用前状态变化会409，重新预览后处理。重传相同规范内容只读不重复写入；每批不超过30行以便核对。首次读取会建立来源基线，以后只保存新增／变化行；缺行、移除副词或换行排序均不删除旧关键词。不把采集时间、排名回填列、样式或每天改写的审核措辞算作来源内容变化，未变化行沿用上次规范化审核结果。

每词单独筛检业务相关性和主意图，不能把一行全部副词随主词一起通过。新模型和新词先保留；尚未完成或未核实公开页面的业务词留候选。有已完成内容、真实对应页面且逐词意图匹配的新增词才进入正式监控。HTTP200不是意图匹配证明，完整正文／canonical／语言／主词须一致；publication.verificationReason保存核验依据，pageIntentMatched逐词确认。历史人工审计、已有正式页面、保护模型和归并／停用状态不被表格覆盖；不同页面记为冲突，既有页面不自动重挂。

排名和搜索量不从协作表历史单元格同步。GSC/Ahrefs证据仍用原排名导入接口，保存真实国家、来源、数据日期、区间和页面。完全相同的旧来源记录跳过；新的真实来源日期保留新观测，不能因名次没变丢掉历史。没有本期证据显示暂无前100证据，只有明确确认才标outside_top100。

成熟词清退的唯一自动例外是外部平台证明持续无需求：读取Ahrefs Keywords Explorer的月度历史，不能用默认12个月均量、GSC零曝光或Organic Keywords未检出替代。连续至少60天或两个完整月的明确零值才进入归档复核；任一跟踪市场有正量、数据未知、新词／新模型、近期曝光点击或真实排名页面等保护信号则保留。保存实际月度数据、市场、来源URL和读取时间，达到条件才通过显式筛检归档并保留可恢复记录；权限、历史月份不足或单次0均不执行。当前没有启用付费SERP，也不调用收费声量API。

## 既有页面的逐词复核

管理页同一JSON导入入口接受 `kind: "page-audit"`，每批1–30词，只能使用登录会话。先 `action: "preview"`，从“本次导入回执”读取逐词变化与 `stateHash`，核对后以相同内容和 `expectedStateHash` 应用。回执可留存；重复同一证据不重复写入，遇人工配置变化或旧核验时间会409。

每词提供 `keyword`、`verdict`、`checkedAt`、`reason`、`evidence`，有明确结论时附 `pageUrl` 与 `httpStatus`。VERIFIED 还须实际最终页面的同址 `canonicalUrl`、HTTP200及标题/H1/正文证据，设置 READY 并补齐对应页面；MISSING 只接受404/410，旧页面移到候选并标待建设；MISMATCH 须HTTP200和具体不匹配理由，旧页面保留候选并标待重新关联；REVIEW 只保存核验记录，不覆盖既有确认。保护模型仍保留保护标记，但错误的页面关联也可根据真实证据纠正。此接口不新建、删除、停用或变更关键词池，不修改固定历史审计文件。

用户已明确取消付费 SERP 计划。当前不启用 DataForSEO、SerpApi，也不安排每两周付费抓取；保留既有 GSC/Ahrefs 的真实日期证据。GSC只代表已出现曝光的查询，周平均排名不等于实时Google名次，未检出不等于确认前100之外。
