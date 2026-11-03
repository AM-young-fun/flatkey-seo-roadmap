# 自然搜索每日趋势与30天回补

自然搜索日报与周五周报分别保存。日报固定筛选渠道精确为`Organic Search`，不以“全渠道减广告”计算SEO人数，不写入或替换`WeeklyTraffic`及其周五快照。原始全渠道历史、页面流量历史、关键词排名继续保留。

GA4属性使用`541304395`、时区`America/Los_Angeles`。获客维度必须明确为`firstUserPrimaryChannelGroup`或`firstUserDefaultChannelGroup`，二者独立读取，不能混成一条曲线；历史采集使用的首次用户主要渠道维度继续按原口径保存。

- 新用户：相同筛选下按日查询GA4 `newUsers`。
- 注册：在相同首次用户渠道筛选下，限制事件`sign_up_success`并查询当日去重用户人数；不使用事件次数。
- 注册人数包含当日注册的老访客，表示首次获客为自然搜索的用户在当天完成注册，不代表注册时的会话来源。
- 日注册人数不能相加成为整周或30天去重注册人数，也不能用注册人数除新用户人数冒充同一批新访客转化率。

## 回补流程

首次回补GA4属性时区中最近已结束的30个日期，不包含当地当天。采集时限定本站主机`flatkey.ai`和`www.flatkey.ai`、同一个属性和首次用户渠道维度；分别核对新用户和注册用户查询的日期、渠道及指标。将已核对结果保存为下述`daily-seo-traffic`文件，并在已登录的`/collect`页面上传或粘贴预览后保存。

真实零人数填`0`；未取得或无法核实的指标填`null`，可在`missingReason`说明缺失原因。不要把GA4空白、阈值限制或未采集日期一律改成零。日期必须早于`collectedAt`在属性时区对应的当地日期，不能将进行中的一天当作完整日。

每批使用固定`requestId`。网络超时或回执不完整时保留原文件，用同一`requestId`重传；相同内容幂等，不重复写入，不因重试生成新批次。真实修订使用新的`requestId`和实际采集时间，保留旧证据。读取时每个日期、每个指标取同口径最新有效值，较新的`null`不抹掉已知值，确认的`0`是有效值。

日报趋势按日期补齐横轴，未采集日期显示缺口。覆盖天数只表示有效日数据的数量，不表示已取得整个区间的去重人数。完成30天回补后，后续只追加新结束日期；需要更正时补采相应日期。

## 导入 API

`POST /api/traffic/daily`接收JSON，文件大小上限2MB，每批1—366个不重复日期。POST带有`Origin`头时必须与请求地址同源，跨站或`Origin: null`会被拒绝；无`Origin`的命令行采集仍按凭据鉴权。GET和POST均在接口内部校验当前登录会话或现有导入凭据的`Authorization: Bearer …`，无有效认证时不返回数据或接受写入；登录功能未配置也不会因此公开。也可使用`/collect`页面的文件上传或粘贴入口，复用当前登录会话；页面预览自然搜索口径、站点、日期范围、天数和缺失天数。

以下数字仅演示结构：

```json
{
  "kind": "daily-seo-traffic",
  "requestId": "flatkey-organic-daily-2026-11-03-example-v1",
  "siteDomain": "flatkey.ai",
  "ga4PropertyId": "541304395",
  "timezone": "America/Los_Angeles",
  "trafficScope": "organic_search",
  "channelDimension": "firstUserPrimaryChannelGroup",
  "channelName": "Organic Search",
  "registrationMetric": "sign_up_success_distinct_users",
  "collectedAt": "2026-11-03T02:00:00Z",
  "sources": ["https://analytics.google.com/analytics/web/"],
  "points": [
    {"date": "2026-10-31", "newUsers": 12, "newRegistrations": 2},
    {"date": "2026-11-01", "newUsers": null, "newRegistrations": null, "missingReason": "尚未完成核对"}
  ]
}
```

`missingReason`可省略；提供时必须为非空字符串，最长500字，不能传`null`。`collectedAt`保留实际采集时间，不得超过当前时间5分钟；`sources`只接受不含凭据的HTTPS Google Analytics链接。页面登录口令、采集密钥和其他凭据不得写入文件或来源链接。

新批次返回201；同批次相同内容重放返回200，格式为`{kind:"daily-seo-traffic",requestId,imported,duplicate,importedAt}`，其中`imported`为本批日期数。同一`requestId`的不同内容冲突不能覆盖已有批次。

## 查询 API

`GET /api/traffic/daily?site=flatkey.ai`默认读取GA4属性时区最近30个已结束日期。可用成对的`start=YYYY-MM-DD&end=YYYY-MM-DD`指定区间，`channelDimension`可选择上述两个首次用户维度，默认`firstUserPrimaryChannelGroup`。

响应包含顶层`start`、`end`、完整日期轴`points`及`coverage:{days,newUsersDays,registrationDays,completeDays}`。缺失指标保持`null`；新用户和注册各保留自己的采集时间，不能把不同时间取得的指标伪装成同一份原始查询。整个接口只读取独立自然搜索日报，不使用旧全渠道周报填补空缺。

## 发布与数据边界

从当前`origin/main`建立独立`codex/`分支提交日报功能，通过普通PR、项目检查及Vercel Preview验证后合并。Vercel由GitHub的`main`更新自动发布，生产构建使用`prisma/ranking-import.sql`执行幂等增量SQL；不要对生产库运行`prisma db push`。

回补通过新增日报导入入口写入，独立于周五`FRIDAY_1010_SNAPSHOT`及历史周二周报。没有相同筛选下的页面组、全站分母或顺序漏斗时，不把旧全渠道页面占比、漏斗和总结当作自然搜索证据。

周报显示层也只读取明确的`Organic Search`渠道行，保留周五快照的截止校验并重新生成SEO结论；全渠道页面历史、注册漏斗与旧总结不用于自然搜索展示。源记录不改写，缺少渠道明细时保持待补采。
