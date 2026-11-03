# 自然搜索页面组日报

此协议补充四类页面的每日访客、浏览次数和同日访问后注册人数。独立保存为`daily-seo-page-groups`，不覆盖原全站自然搜索日报，不改写`WeeklyTraffic`、周五快照或历史全渠道页面流量。

## 四组与固定口径

| key | 页面组 | 范围 |
| --- | --- | --- |
| `gpu_compute` | GPU Compute | `/compute`、`/compute/prices`及`/compute/prices/<GPU>`白名单；GPU仅`b300/b200/h200/h100/a100/l40s/rtx-pro-6000/rtx-5090/rtx-4090`，不包含`/cloud`或未知子路径 |
| `model_list` | 模型列表 | 精确`/models`及其尾斜线版本 |
| `model_detail` | 模型详情 | `/models/<slug>`单层详情，排除保留的Prompts目录及所有更深路径 |
| `prompts` | Prompt Library | `/prompts`、`/prompts/<slug>`、`/prompts/{image,video,model,use-case}/<slug>`及`/models/<slug>/prompts/<id>`，不泛收未知深层路径 |

`ruleVersion: 1`固定页面规则，实际匹配以`src/lib/daily-seo-page-groups.ts`中的共享规则为准。支持语言前缀`en/zh/es/fr/pt/ru/ja/vi/de/id`；入口只接受`flatkey.ai`和`www.flatkey.ai`。未知路径不按相邻主题猜测归组，组间人数也不相加为全站人数。

页面路径筛选同时应用`pathPattern`与非空的`excludePathPattern`。漏斗第一步若使用完整`page_location`，对应应用`pageLocationPattern`与非空的`excludePageLocationPattern`；模型详情组须排除保留的`/models/prompts`目录。GET返回两套规则，页面详情也展示对应规则，便于核对采集条件。

本协议只接受GA4属性`541304395`、时区`America/Los_Angeles`，用户维度`firstUserPrimaryChannelGroup`精确为`Organic Search`。`firstUserDefaultChannelGroup`、会话渠道、广告排除后剩余流量均不能代替。获客维度表示首次来源，不表示注册时的会话来源。

- `totalUsers`：当天相同页面组、主机、`eventName = page_view`和首次用户渠道筛选下的去重访客，包含新老访客；不能用新用户数代替。
- `pageViews`：相同筛选的页面浏览次数，不是去重用户数。
- `funnel.entrants`与`funnel.registrations`：当天闭合顺序漏斗的入口和注册人数，必须成对取得；不拼凑独立事件人数。

## 同日注册漏斗

日期选择为单个已结束的洛杉矶自然日。关闭开放漏斗，第一步为`page_view`，在第一步内限制主站入口及对应页面组；间接后跟第二步`sign_up_success`。Organic首次用户渠道筛选覆盖同一用户群体。第二步不套第一步的页面或主机条件，允许用户在Console等注册页完成注册。

不能把`page_view`或页面组路径作为整个漏斗的全局事件筛选，否则注册事件可能被剔除。不能用“曾访问过某组”的用户细分替代第一步路径条件，否则可能将注册前后的其他访问错误归因给该组。

30天趋势漏斗不是30个单日闭合漏斗：GA4在整个日期区间中每用户只报告首条序列，趋势图也有首次日期归属规则。“24小时内”仍可能跨自然日。因此严格同日回补需逐日设置日期，并轮读四组各自的第一步定义，保留每组每天的来源与实际采集时间。[Google漏斗探索说明](https://support.google.com/analytics/answer/9327974?hl=en)

漏斗入口与页面流量使用的GA4用户指标可能不同，不用`totalUsers`作漏斗转化率分母。每日注册人数不能求和冒充整周或30天去重注册人数。

## 首次回补与每日续采

首次回补最近30个已结束的GA4当地日期。自由探索可一次查询整段：日期为行、用户总数和浏览次数为值，每组保持相同Organic渠道与主站页面筛选；显示足够行数并逐日保存。漏斗仍按上述单日规则分别查询，不能由流量表推算注册人数。

后续仅追加新结束的日期；如存在待补采日期或已核实修订，再采相应日期、组和指标。允许分批、分组回补，不为完成覆盖率而填入估计数。渠道、路径、日期、指标、采样或阈值限制均需核对，并把原始核对证据留在本地忽略目录。

确认的零保存`0`；未取得的流量保存`null`，未取得的漏斗整体保存`funnel: null`，用`missingReason`说明。已有流量但缺漏斗时保留流量数值，不把漏斗补成零。入口和注册人数不能分别从两次不同漏斗结果拼接。

## 导入

`POST /api/traffic/daily/groups`接收`dailySeoPageGroupsSchema`校验的JSON。文件也可在已登录的`/collect`上传或粘贴，预览显示各组范围、天数、待补采天数和已有同日漏斗天数。

每批1—4个不同页面组，每组1—366个不同日期，文件上限2MB。日期必须早于实际`collectedAt`在属性时区对应的当地日期。顶层`collectedAt`、`sources`是本批证据；流量点可另附`collectedAt`与`sources`，漏斗始终保留自身实际时间与来源。

以下数字仅演示结构：

```json
{
  "kind": "daily-seo-page-groups",
  "requestId": "flatkey-seo-pages-2026-11-03-example-v1",
  "siteDomain": "flatkey.ai",
  "ga4PropertyId": "541304395",
  "timezone": "America/Los_Angeles",
  "trafficScope": "organic_search",
  "channelDimension": "firstUserPrimaryChannelGroup",
  "channelName": "Organic Search",
  "registrationMetric": "sign_up_success_distinct_users",
  "ruleVersion": 1,
  "collectedAt": "2026-11-03T04:00:00Z",
  "sources": ["https://analytics.google.com/analytics/web/"],
  "groups": [
    {"key": "gpu_compute", "points": [{"date": "2026-11-01", "totalUsers": 14, "pageViews": 24, "funnel": {"entrants": 12, "registrations": 2, "collectedAt": "2026-11-03T03:50:00Z", "sources": ["https://analytics.google.com/analytics/web/"]}}]},
    {"key": "model_list", "points": [{"date": "2026-11-01", "totalUsers": 8, "pageViews": 12, "funnel": {"entrants": 7, "registrations": 0, "collectedAt": "2026-11-03T03:51:00Z", "sources": ["https://analytics.google.com/analytics/web/"]}}]},
    {"key": "model_detail", "points": [{"date": "2026-11-01", "totalUsers": 20, "pageViews": 35, "funnel": null, "missingReason": "流量已核对，同日注册漏斗待补采"}]},
    {"key": "prompts", "points": [{"date": "2026-11-01", "totalUsers": null, "pageViews": null, "funnel": null, "missingReason": "尚未完成该日数据核对"}]}
  ]
}
```

来源只使用不含凭据的HTTPS Google Analytics链接。密钥、登录口令不得放入JSON或来源URL。使用当前登录会话或现有导入Bearer认证；有`Origin`头的POST须与请求地址同源。

固定`requestId`与原文件一起保存，网络超时或未收到完整回执时重传同一文件。首次成功返回201，相同内容重放返回200；回执为`{kind,requestId,imported,duplicate,importedAt}`，`imported`表示本批“组×日期”记录数。相同`requestId`的不同内容不能覆盖，真实修订使用新批次并保留旧证据。

## 读取与缺失

`GET /api/traffic/daily/groups?site=flatkey.ai`默认最近30个已结束的洛杉矶日期，可成对传入`start=YYYY-MM-DD&end=YYYY-MM-DD`指定区间。仅接受Primary首次用户渠道口径；不会借用另一个渠道维度或旧全渠道证据。

响应提供四组各自完整的每日横轴；缺失指标保持`null`，真实零保留。流量与漏斗各自按实际采集时间读取有效修订，较新的缺失值不抹掉已知值，漏斗的入口与注册始终作为一对读取。趋势图和数据表保留来源、采集时间及待补采状态，不生成模拟值，不把每日人数求和标作区间去重人数。
