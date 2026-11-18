# SEO 注册报告口径

日报与周报的主注册指标统一为 GA4 属性 `541304395`、`America/Los_Angeles`，`firstUserPrimaryChannelGroup = Organic Search` 下 `sign_up_success` 的 `totalUsers`。这是首次由自然搜索获客的用户在所选期间完成注册的人数；会话归因、全渠道账户总量和事件次数不替代它。

每日趋势仍保存至 `/api/traffic/daily`。报告区间使用独立的 `/api/traffic/registrations`：POST 仅接受既有导入凭据，GET 接受登录会话或导入凭据。区间证据按内容散列追加保存于既有 `SeoReportVersion`，kind 为 `SEO_REGISTRATION_PERIOD`；不需要数据库迁移。

运行 `SEO_IMPORT_TOKEN=… GOOGLE_APPLICATION_CREDENTIALS=… node scripts/collect-seo-registration-periods.cjs --import`，或者以 `SEO_GOOGLE_SERVICE_ACCOUNT_JSON` 提供既有只读凭据。不带 `--import` 仅查询并保存本机预览载荷。须先通过自动化官方工作日门槛。脚本先核验属性、唯一数据流、测量 ID 和默认站点，再查询已存日报/周报、下一周五报告覆盖期间和对应可比期间。

注册成功事件由 Flatkey 后端发送，缺少页面地址导致 `hostName` 为空；已通过唯一数据流 `15056169010` / `G-30RCEP2CVH` 与后端配置核对站点归属。此专用成功事件区间查询不追加主机名过滤；这不是页面组、落地页或其他共享属性的归因依据。

每个报告期间独立查询区间去重人数，不能相加每日去重人数。零值需要明确返回行；无行保留未知。阈值、采样、截断或时区变化停止导入。采用至少 48 小时处理等待政策（洛杉矶今天减 3 日作为截止），不是提供商永久最终标记；定期重查历史修订。周五未覆盖整个七日时，仅显示已入库的覆盖期间，并独立查询上周匹配的同星期期间。

归档“最新详情”会叠加已补采的注册证据，标明实际采集时间和修订说明；原发送快照的显式 `reportId` 不改写。新报告直接读取相同区间证据。回补过程不发送或重新发送通知，也不重算其他历史业务指标。
