# 每周核心业务访客占比

2026-10-23更新。沿用原 `automation`，每周五北京时间10:10执行，统计上周五至本周四。GA4属性541304395、America/Los_Angeles，取当时可见数据并保留实际collectedAt，使用FRIDAY_1010_SNAPSHOT；不等待当地周四结束。

周报重点展示模型详情与Prompt Library：本周占比、上周占比、百分点变化，同时保留两期访客人数、增减和人数环比。

- 模型详情：`/models/<slug>`及支持的语言前缀；排除`/models`目录页。
- Prompt Library：`/prompts`、所有下级页面、`/models/<slug>/prompts`及下级页面，包括语言前缀。
- 支持en/zh/es/fr/pt/ru/ja/vi/de/id，实际正则以`src/lib/weekly-page-visitors.ts`为准。

每组分别查询同区间、hostName为flatkey.ai/www.flatkey.ai、eventName=page_view的GA4 totalUsers（包含新老访客），按组直接去重，不相加页面、语言或每日人数。另以完全相同区间、主机和事件条件查询全站去重totalUsers作分母。占比=每组访客/全站访客；同一个人可访问两组，允许重叠，不归一化为100%。分母为零或缺失时占比不可用，不假填0%。

保存格式：

```json
{
  "metric":"totalUsers",
  "eventName":"page_view",
  "ruleVersion":2,
  "sourceUrl":"https://analytics.google.com/analytics/web/",
  "siteUsers":{"current":200,"previous":null},
  "groups":[
    {"key":"models","users":{"current":120,"previous":null}},
    {"key":"prompts","users":{"current":100,"previous":null}}
  ]
}
```

示例数字仅演示结构。上述对象存入analysis.pageVisitors。previous仅复用已保存、同为周五至周四、同ruleVersion=2、同截数口径的相邻期。没有基线时用null，不重抓历史快照。旧ruleVersion=1含模型目录，保留历史展示，不当成新模型详情基线；旧证据无全站分母时不计算占比。两组本期人数或全站分母缺失时只能PARTIAL，不能GA4 COMPLETED。完成后将两组占比与变化写入本周总结。


## 核心页面历史折线图（2026-10-23）

三张独立每日totalUsers曲线：模型详情＋列表（/models、/models/<slug>），GPU Compute（/compute及子页面），Prompt Library（既有提示词规则）。含支持的语言前缀，eventName=page_view，主机名限定flatkey.ai/www.flatkey.ai。曲线模型组与仅模型详情占比表不同，名称明确区分。

每次仅采新一周每日去重人数和浏览次数，存traffic[].analysis.pageTrends：{metric:"totalUsers",eventName:"page_view",ruleVersion:1,timezone:"America/Los_Angeles",sourceUrl:GA4链接,groups:[{key:"models",points:[{date:"YYYY-MM-DD",users:数字或null,pageViews:数字或null}]},{key:"compute",points:[...]},{key:"prompts",points:[...]}]}。首次可回填已核对三周；未取得日期用null，不能填零，不相加每日人数当周去重人数。

WeeklyTraffic.analysis存于PostgreSQL，每周追加，保留旧记录；历史曲线读取所有已保存周，按组和日期拼接，重复日期采用最新有效证据，空缺不抹除已知值。默认全部历史，可切换最近三周/90天。无需重抓历史、浏览器缓存或重新部署维持数据。


## 按周总数（2026-10-23追加）

图表默认按周汇总，保留按天切换。每组除points每日记录外，另存weeks:[{periodStart:"YYYY-MM-DD",periodEnd:"YYYY-MM-DD",users:整周去重totalUsers,pageViews:整周浏览次数}]，按周五至周四连续7天单独查询。不能相加每日访客冒充整周去重用户；不能使用GA4默认周日/周一分周。每期只追加新周weeks，读取历史合并成整体周曲线，旧日报永久保留。缺少整周查询时显示待采集，不由points推算。


## 页面访问后注册转化（2026-10-23追加）

每周曲线增加注册人数（右轴）。使用同一GA4属性、相同周五至周四区间的闭合顺序漏斗：第一步page_view，事件page_location限制flatkey.ai/www.flatkey.ai及对应页面组（含语言、允许查询参数）；间接后跟第二步sign_up_success。不要把页面过滤器施加到整个漏斗导致注册事件因页面地址不同被剔除；不限定首次访问，不将全站注册人数或独立事件人数当页面组转化。用户可跨组重叠，组间不相加。

每个weeks记录可保存registrationFunnel:{ruleVersion:1,entrants:入口去重人数,users:完成注册去重人数,sourceUrl:GA4来源,collectedAt:实际采集ISO时间}。users不得超过entrants；未知留空，真实零保存0。漏斗入口与流量totalUsers口径可能不同，不能直接用流量人数计算该漏斗转化率。没有每日归因证据时，注册曲线仅在按周视图显示。

后续每周随新一期采集，永续追加；没有registrationFunnel的新流量导入不得清除已保存转化。历史转化证据保留来源和时间，禁止相加每日注册去重数代替整周顺序漏斗。
