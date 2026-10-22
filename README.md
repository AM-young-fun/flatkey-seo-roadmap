# SEO Rank Monitor

Next.js + PostgreSQL + Prisma + ECharts 的关键词排名监控面板。

## 当前页面与浏览器采集

- `/`：按当前1,629个正式目标词展示SERP实测进度、前10／30／50／100互斥分布及每月期次趋势；待采集和失败与实测未进前100分别统计。
- `/keywords`：同一词表展示正式目标、研究池、可恢复归档、目标页面、实际排名页面及真实采集证据；同页切换按页面合并的内容任务与审计记录，多个关键词复用同一页面任务。
- `/okr`：兼容旧地址，跳转关键词明细。
- `/keywords` 的页面状态支持「已优化」，在关键词行抓取关联页面的四国排名，每页每天一次。原 `/monitor` 重定向至该筛选，不再单独展示。详见[已优化关键词与抓取说明](docs/page-ranking-monitor.md)。
- `/manage`：DataForSEO连接、SERP目标／费用预览与关闭状态配置、三表同步状态、话题维护及CSV导入。
- `GET /api/rankings/import`：定时采集任务读取当前关键词列表。
- `POST /api/rankings/import`：批量导入 GSC / Ahrefs 浏览器采集结果，支持密钥认证、事务写入和幂等重试。

上线准备与请求格式见[导入接口文档](docs/ranking-import.md)和[SERP说明](docs/dataforseo.md)。Vercel生产构建会自动应用幂等增量SQL；导入密钥可从登录后的「数据管理」复制。现有独立采集器每天北京时间10:30读取三表、筛选增量及检查技术健康，线上只如实显示已存来源状态；服务端不直接拉取钉钉。Vercel每日10:30另检查来源健康和SERP计划；网页刷新不等于重新采集排名。旧SerpApi手动入口已退役。

## 功能

- 维护主关键词和长尾关键词
- 用 ECharts graph 渲染关键词父子及同话题关联
- 当前SERP计划为美国／英语／桌面端；日本、西班牙、巴西保留筛选与历史证据，未采集范围不冒充已有实测
- 排名颜色：前 10 绿色、11–30 蓝色、31–50 黄色、51–100 橙色、无前 100 排名灰色
- 外部真实搜索量作为辅助分析；未知值和单次零不用于删除词，模型／新词／需求信号优先保护
- 每月1日、16日北京时间10:30两期计划，保存真实SERP时间及同词多个页面，不用GSC均位／Labs数据库补作当次排名
- 支持现有采集器每日三表增量导入；旧SerpApi同步API和旧Labs付费更新均返回410

## 环境变量

复制 `.env.example` 为 `.env`，至少填：

```bash
DATABASE_URL="postgresql://..."
CRON_SECRET="..."
LOGIN_PWD="..."
DATAFORSEO_SERP_PAID_ENABLED="false"
```

没有 `DATABASE_URL` 时，原仪表盘会显示 demo 数据；OKR 页明确显示未连接数据库，不会将内置审计冒充已应用数据。浏览器采集导入接口只保存上传的真实采集结果。

排名付费执行保持关闭，即使已有供应商凭据也不会启动。新SERP必须同时通过部署环境`DATAFORSEO_SERP_PAID_ENABLED`和数据库计划`paidEnabled`两道闸门；本版本网页配置只允许保存关闭状态。保存连接、预览费用、刷新状态、部署和三表同步不会发起付费请求；旧`SERP_MONITORING_ENABLED`不能重新启用已退役的SerpApi入口。

当前所有网站正式目标合计1,629词，其中Flatkey1,512词并保留95个受保护的模型词；查询按规范化关键词去重，跨网站相同查询可共享SERP结果，网站目标仍分别核对。149个内容补充／待建设词已归入96项页面任务，加上保留旧任务共126项。未进入正式名单的词保留研究及历史，无关词可恢复归档，不删除全局词或历史观测。后续同步不覆盖人工页面关联。持续零声量只能在外部真实月度历史、至少60天和足够有效采样支持下复核归档；未知、新词、模型和真实需求信号优先保留，当前没有自动调用收费声量接口。

设置 `LOGIN_PWD` 后，页面和普通 API 会要求先登录；不设置时登录保护不启用。登录态通过 `httpOnly` cookie 保持 30 天。

旧Ahrefs导入与接口模板保留历史兼容，不是新SERP核心排名源；无需为当前接入配置SerpApi或Ahrefs付费密钥。DataForSEO API login/password通过已登录管理页保存为加密凭据，不能放入前端构建或源码。

## 本地开发

```bash
npm install
npm run db:push
npm run dev
```

打开 `http://localhost:3000`。

## CSV 导入

页面右侧可以下载模板 CSV，也可以上传 CSV。格式：

```csv
keyword,parent keyword
seo tools,
daily rank tracker,seo tools
japan seo tracking,seo tools
```

- 第一列：关键词
- 第二列：父关键词
- 父关键词为空时导入为主关键词
- 父关键词不为空时，用关键词文本完全匹配父关键词，并导入为长尾关键词
- 父关键词只出现在第二列时，会自动创建为主关键词

## 关键词导出 API

在「数据管理 → API Key · 关键词导出」创建并复制密钥，通过 `GET /api/keywords/content-opportunities` 从网站启用的正式词与候选词中排除已有前100排名的词，导出其余业务目标词、规划词和候选词。已有绑定或规划仅限博客文章，绑定或规划到模型、产品、文档等非博客页面的词整条排除；没有绑定页面的词继续保留。排名状态分别标明已确认前100之外、已采集但未命中、未采集和采集结果需核实，不限主题分配和任务状态；同时返回词池、博客页面、已有规划、排名依据和任务进度。每个网站关键词只返回一条，地区证据和关联规划不增加条数。支持网站权限范围、地区筛选、JSON / CSV 和密钥停用。完整参数、请求示例与返回字段见 [接口接入文档](docs/keyword-export-api.md)。

## Vercel 部署

1. 在 Vercel 项目里添加 `.env.example` 中的环境变量。
2. 使用支持连接池的 PostgreSQL URL 填 `DATABASE_URL`。
3. 生产构建自动执行 `prisma/ranking-import.sql` 的幂等增量迁移，保留已有数据；不要对现有生产库运行 `db:push`。
4. 登录「数据管理」维护来源导入密钥、DataForSEO连接与SERP关闭配置。每日Cron只检查计划和健康；付费双闸保持关闭，不触发首次整库抓取。

Vercel 运行时每个实例限制为 1 个数据库连接；识别到 Supabase 共享连接池的 5432 端口时，使用同主机的 6543 事务模式并开启 `pgbouncer=true`，避免会话池 15 个连接被多个函数实例占满。生产增量 SQL 优先使用 `DIRECT_URL`，未配置时使用原 `DATABASE_URL` 的端口与连接模式；每次执行最多 60 秒、最多重试 3 次。构建准备与应用运行时各自选择连接配置。

## API

- `GET /api/dashboard`：仪表盘数据
- `GET /api/keywords`：关键词列表
- `POST /api/keywords`：新增关键词
- `GET /api/keywords/import/template`：下载 CSV 模板
- `POST /api/keywords/import`：CSV 导入关键词
- `GET /api/keywords/okr?site=flatkey.ai`：已持久化的正式名单、页面及任务
- `POST /api/keywords/okr`：登录态下预览、应用或恢复固定审计批次
- `GET /api/keywords/source-sync`：登录态只读三表来源健康，变更时间不等于每日完整检查回执
- `POST /api/keywords/source-sync`：逐批预览／应用三表增量；缺行不删词、人工页面关联保持
- `GET /api/serp-monitor`：SERP配置、正式目标与费用、当前闸门及期次账本
- `POST /api/serp-monitor`：费用预览、保存付费关闭配置；付费执行需双闸且本次不启用
- `GET /api/serp-monitor/results`：正式目标实测结果、逐页自然名次与采集时间
- `POST /api/sync/run`：已退役，返回410，不再调用SerpApi
- `POST /api/dataforseo`的`action:update`：旧Labs付费更新已停用，返回410；连接与历史缓存兼容保留
- `GET /api/cron/daily-rankings`：Vercel每30分钟推进已授权任务；新排名周期为隔周周二10:30，接收真实执行回执，不重复创建周期
- `GET/POST /api/operations`：登录管理页的运行记录、免费费用预览、隔周更新开关与本轮提前执行；付费默认关闭，旧授权不自动启用
- `GET /api/health`：健康检查
