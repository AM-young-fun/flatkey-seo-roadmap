# RougeCue 只读数据接入增量 · 2026-11-24

用户最新授权“现在可以接入rougecue，那边基本都ok了”，覆盖此前 RougeCue Google 暂缓条款。仅恢复现有 GA4/GSC 的正常只读接入与采集资格；全部自动化继续暂停，本次不运行整批采集、不发布、不发群、不修改 Google 配置或权限。

RougeCue 仍仅观察数据，不进入内容、关键词目标、技术制作或优化队列。季度每周 3000 自然搜索会话仍仅计算 Flatkey，本站缺数不成为其目标验收依赖。历史已审文稿及旧 source hash 保留，本增量独立记账。

已在指定受管理 Chrome 账号 `jilin.zhang@mkt.voc.ai` 只读核实：

- GA4 属性 `565596386`，网站流 `16396864047`，官网 `https://rougecue.org`，真实报告时区 `America/Los_Angeles`。
- GSC 正确资源 `sc-domain:rougecue.org`。站点地图 `https://rougecue.org/sitemap.xml` 今日读取成功，已发现 9,804 页；这不是已收录数。
- GSC 效果页当前显示“正在处理数据，请过 1 天左右再来查看”，导出禁用，故暂不能取得点击、曝光和查询明细。Google 的提示不构成准确补齐承诺；后续原采集入口按真实来源日期补齐，不填 0。
- GA4 属性及数据流可见不等于当前 API 权限或流量已齐。11/23 已有服务账号 403 原回执保留；本轮未取得本地 Google 凭据，未冒称今日 API 权限复核成功。GA4 首页本次加载未完成，不能据此确认昨日会话或注册。注册事件仍未经证据核定。

最小代码差分仅解除 `CLUSTER_SITES` 的暂缓标识、登记上述 GSC domain 资源并补 source readiness。现有 `server-seo-daily.cjs` 已通过此注册表读取属性及归档键，无需新建 job。后续执行前同步正式代码至现有采集副本，沿既有凭据正常读取；权限失败如实保留，不自动换账号或授予 Google 权限。

本轮证据保存在原项目 `.local/seo-final-review-20261124/rougecue/source-preflight.json`。代码登记、浏览器可见、API 权限、来源发布和生产归档分别验收，不互相冒充。
