# 日报模块独立标量

原 `server-seo-daily.cjs` 采后调用 `server-seo-report-scalars.cjs`，不新增定时任务，也不改变17:30的时间、启停、模型或外发权限。显式历史窗口或未选择 Flatkey/all/GA4 的局部补采不触发此步骤。

默认取完整已结束的洛杉矶自然日及前一日。`--source-date=YYYY-MM-DD` 明确指定统计日，`--out=/absolute/path` 指定输出目录，重复 `--reuse-dir=/absolute/path` 提供已有源目录；`--offline` 仅读缓存、绝不调用Google。凭据仍由原 `google-read-auth.ts` 从原环境读取，范围仅 `analytics.readonly`。

输出优先在原 `SEO_COLLECTION_RESULT` 所在运行目录的 `report-scalars/daily-report-scalars.json`，路径同时写入原采集结果的 `reportScalars.summaryPath`。独立运行默认 `.local/seo-report-scalars/<统计日>/daily-report-scalars.json`，也可由 `SEO_REPORT_SCALAR_OUTPUT_DIR` 指定；共享缓存由 `SEO_REPORT_SCALAR_CACHE_DIR` 指定。缓存只接受相同属性、精确请求、实际LA元数据、完整且无质量限制的明确标量；保留原 observedAt。缺行、metadata-only、失败、未结束日、异属性或质量受限结果不会变成0。每次只补缺失项，旧源不覆盖。

17:30原准备入口先读取该目录的 `complete`、`moduleShares`、`moduleSessions`、`sourceEvidenceSha256` 和 `records`。`complete=false` 保留具体 missing，不宣称齐全；不能以此裸prepare覆盖已有完整来源看板。以原基础日报确切ID/hash，合并现有站点/国家/GSC证据，按原 `/api/seo/digest` 的 `save_daily_dashboard` 保存并 `read_saved` 读回；这里不创建发送批准、不发群、不替换GSC缺口或其他来源。

用户数按原 PILLAR_PAGE_GROUPS：session Organic Search＋production-hosts-v1＋page_view/pagePath，整段去重totalUsers。五模块会话按原 DAILY_SEO_PAGE_GROUPS：session_start/landingPage，Console归other，五个官网模块只包含flatkey/www。两类查询不混firstUser，不用逐页用户数相加，不把模块和当全站分母。

历史16份真实工件可以通过 `--reuse-dir` 读取，带 `sourceFiles/sourceHashes/propertyId` 的源清单会先校验SHA。新写源带属性与完整请求；重复运行消费已有完整缓存，不重发源请求。现有独立runtime同步时需一起复制两个新增脚本和本库文件，原自定义selected/history分支保留。
