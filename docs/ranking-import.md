> 2026-10-23 最新要求：周报每周五北京时间10:10执行，统计上周五至本周四；快照标记 `FRIDAY_1010_SNAPSHOT`，不等洛杉矶周四结束。流量重点展示模型详情和 Prompt Library 的访客占全站去重访客比例。DataForSEO 保留14天相位与期次ID，改为隔周周四08:00，下次11-05，之后11-19、12-03；旧账本和费用授权不改写。下文历史时间说明以此为准。

> 2026-10-22 更新：最新执行口径见 [运行日程](./project-schedules.md)和[每周工作流](./weekly-workflow.md)。服务器关键词改为隔周周一晚24:00（周二00:00），原Codex流量周报改为每周二10:10。费用权限以已有管理开关为准；下文早期时间说明与旧来源协议保留作历史兼容。

# 每日浏览器采集与导入

2026-10-22 用户指定的周报截数：周二10:10读取GA4当时可见数据，直接作为该周正式快照，不等待洛杉矶周一结束。报告仍标记周二至周一范围，保留属性时区、实际collectedAt，不宣称属性当地完整七天。在 `traffic[].analysis` 中附 `reportingCutoff: {kind:"TUESDAY_1010_SNAPSHOT",scheduledAt:"该期结束后的周二10:10:00+08:00的ISO时间"}`；实际采集不得早于排定截数。普通导入仍要求属性周已结束；明确标记的快照允许在排定截数后导入，`complete:true` 表示约定快照证据齐全。

新用户、注册、渠道、顺序漏斗、模型页和提示词页使用同次快照及原有去重指标。环比只对相邻且同截数口径的两期计算，首期不拿历史完整周直接计算增长率。已发布快照不因后来数据更新而自动重采。未来服务器关键词自11-03起在周二00:00（周一晚24:00）独立运行，保留隔周频率、原期次、已授权开关和预算。

以下早期日程已经被上述最新时间替代：

当前核心排名改为DataForSEO SERP实测，计划隔周周二北京时间10:30，付费执行保持关闭；当前正式目标共1,629词。每天10:30的独立采集器继续读取三张协作表、筛选增量和检查技术健康，GSC／Ahrefs原始导入保留历史兼容，不再每天重复采集均位填作真实排名。流量周报和关键词环比仍仅在每周二10:30准备、18:30核对完整周后补充。周二傍晚保证GA4的America/Los_Angeles时区上一周已结束。下文既有GSC／Ahrefs请求格式描述历史兼容能力；最新默认口径以文末SERP一节为准。

## 上线配置

1. 线上沿用已有 `DATABASE_URL`、`SEO_TARGET_DOMAIN` 和 `LOGIN_PWD`。
2. 推送到 `main` 后，Vercel 的生产构建会自动执行 `scripts/prepare-production-db.mjs`，应用 `prisma/ranking-import.sql`。只新增表、索引和枚举，不删除或重建既有数据；重复构建可重复执行，数据库变更失败时构建停止，保留旧部署。仅在 `VERCEL_ENV=production` 时执行。
3. 导入密钥优先使用 `RANKING_IMPORT_SECRET`。未配置时，以已有 `CRON_SECRET`（否则 `LOGIN_PWD`）通过 HMAC-SHA256 派生独立密钥；不能用原始登录密码或 Cron 密钥直接调用导入接口。更改根密钥会改变派生密钥。
4. 登录线上「数据管理」，点击「复制导入密钥」，将其配置为采集会话本地的 `RANKING_IMPORT_SECRET`。读取密钥的 `GET /api/rankings/credential` 必须使用网页登录态；导入 Bearer 密钥不能访问它。密钥不会出现在 Git 或部署日志中。
5. 如需单独轮换，可后续在 Vercel 配置独立的 `RANKING_IMPORT_SECRET`；这不是首次发布的必需步骤。

生产 SQL 采用事务与锁，仅做幂等增量变更（PostgreSQL 12+）。首次建库仍需原有基础表；当前发布针对已经存在的线上数据库。已有数据库尚未建立 Prisma migration baseline，因此此 SQL 不作为 `migrate deploy` 的首个迁移。
主页、关键词明细在可见时每 60 秒刷新，回到标签页时复用 30 秒内的已读数据；页面切换共享同一个进行中的请求。词库和趋势在当前标签页保留最多 15 分钟的压缩会话缓存，重新打开先显示已加载结果，再后台读取；词库恢复期间明确提示正在更新。退出登录或认证失败会清除缓存，浏览器禁用存储时正常回退到网络读取。服务端按网站与来源缓存 30 秒，四个地区共享缓存；全部网站通过一组批量查询读取，不逐站串行加载，也不传输完整声量历史。上传完成后强制刷新。图表库按需加载，仅包含使用的折线图、关系图和必要组件。页面的「每天 10:30 更新」对应本地独立采集任务；底层数据刷新日期仍以来源为准。

## 1. 获取当前关键词

采集使用 Chrome 工作资料 `mkt.voc.ai`（`jilin.zhang@mkt.voc.ai`）。先核验页面账号和资源选择器：Flatkey 为网域资源 `sc-domain:flatkey.ai`；RackRate 与 ModelFit 分别为 URL 前缀资源 `https://rackrate.org/`、`https://modelfit.cc/`。同名网域资源未验证时会报无权访问，不能因此认定该站没有数据。

导入保留长查询原文，关键词最多 2000 个 UTF-8 字节，不截断或改写。超长查询应单独保留并报告校验失败，不让其阻止其他批次。GSC 导出要核对过滤器 CSV 中的国家、Web 搜索类型与绝对起止日期，并核对查询行数是否达到导出上限。查询与页面须在同一查询过滤条件下联合读取，不能把导出文件中独立的查询表和网页表按顺序拼接。

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $RANKING_IMPORT_SECRET" \
  https://flatkey-seo-roadmap.vercel.app/api/rankings/import
```

返回 `targetDomain`、`regions` 和 `keywords`（有核实页面的监控词），另保留 `candidates`（待建设或核实的候选词）。采集时使用返回的关键词原文，按四个国家分别过滤。没有采集到的记录不要编造排名或用 0 代替。

## 2. 上传结果

`POST /api/rankings/import`，请求头：

```text
Authorization: Bearer <RANKING_IMPORT_SECRET>
Content-Type: application/json
```

示例 `payload.json`：

```json
{
  "requestId": "flatkey-2026-10-14-gsc-ahrefs-part-001",
  "targetDomain": "flatkey.ai",
  "observations": [
    {
      "keyword": "claude api",
      "region": "US",
      "source": "gsc",
      "collectedAt": "2026-10-14T10:30:00+08:00",
      "rank": 23.6,
      "clicks": 4,
      "impressions": 120,
      "ctr": 0.033333,
      "periodStart": "2026-09-16",
      "periodEnd": "2026-10-13"
    },
    {
      "keyword": "claude api",
      "region": "US",
      "source": "ahrefs",
      "collectedAt": "2026-10-14T10:30:00+08:00",
      "volume": 39000
    }
  ]
}
```

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $RANKING_IMPORT_SECRET" \
  -H 'Content-Type: application/json' \
  --data-binary @payload.json \
  https://flatkey-seo-roadmap.vercel.app/api/rankings/import
```

## 字段口径

| 字段 | 规则 |
| --- | --- |
| `requestId` | 必填，全局唯一，每个分批请求使用独立编号；失败重试必须复用同一编号和内容 |
| `targetDomain` | 必须匹配线上 `SEO_TARGET_DOMAIN`，防止跨站导错 |
| `observations` | 1–1000 行，请求体不超过 2 MB；超出时分批，每批独立编号 |
| `keyword` | 必须已存在且启用、关联话题；忽略大小写匹配，不会自动创建关键词；匹配不唯一时拒绝导入 |
| `region` | `US` / `JP` / `ES` / `BR`；禁止用全球数据冒充某个地区 |
| `source` | `gsc` / `ahrefs`；同一批的关键词、地区、来源不能重复 |
| `collectedAt` | ISO 8601，必须含时区；表示浏览器采集时间，不可在未来 |
| `rank` | GSC 必填，可为小数；Ahrefs 可选，提供时必须为整数；最小 1。显式 `null` 表示本次查不到排名；省略表示本次没有采集排名，不覆盖已有排名 |
| `volume` | 非负整数，Ahrefs 可提供；禁止把 GSC 曝光量当声量；0 是真实的零，不是缺失值 |
| `periodStart` / `periodEnd` | `YYYY-MM-DD`，GSC 必填，表示实际统计区间；其他来源如提供，必须成对提供 |
| `clicks` / `impressions` / `ctr` | GSC 可选；次数为非负整数，CTR 为 0–1 的比例，不是百分数 |

GSC 没有匹配查询时，只能表示该统计区间「暂无数据」，不能声称该关键词没有 Google 排名。应先确保选择了正确国家、查询和日期。Ahrefs 如只采集声量，不要传 `rank: null`。

### 浏览器补充各地区声量

Ahrefs Keywords Explorer 可按国家查询当前关键词，读取 `SV`（所选国家的月搜索量），不要读取 `GSV`（全球月搜索量）。先核对国家按钮与报告地区，再遍历所有分页，保存原始单元格、报告链接与采集时间。只给已有关键词补充声量，不把工具拆分、改写出的短语创建为新词。

- 文本入口会按逗号或换行拆词；包含逗号的查询须使用支持正确引号转义的文件入口，或暂留未知，不能删除逗号后查询。文件权限不可用时不扩大浏览器权限。
- 导出换行造成的展示断行可归一为空格后匹配；导入复用词库已有拼写。无法精确匹配的结果跳过并记录。
- `0–10` 是区间，`N/A`、未收录也不是零；当前接口仅接收整数，因此这些值不导入。明确的点估计可按显示单位换算，例如 `1.9K` 为 1900；仍是来源估计值。
- 声量单独导入仅提供 `keyword`、`region`、`source: "ahrefs"`、`collectedAt`、`volume`，省略 `rank`、`rankStatus` 与 `url`，`allowNewKeywords` 设为 `false`，保留已有排名和页面。

## 成功与重试

首次成功返回 HTTP 201：

```json
{
  "importId": "...",
  "requestId": "flatkey-2026-10-14-gsc-ahrefs-part-001",
  "imported": 2,
  "duplicate": false,
  "importedAt": "2026-10-14T02:31:00.000Z"
}
```

相同 `requestId`、相同内容再次上传返回 HTTP 200、`duplicate: true`，不重复插入。行顺序变化不影响重试；改变数据内容返回 409，修正数据应使用新编号。批次元数据与全部观测值在同一数据库事务中写入。

| 状态码 | 含义 / 处理 |
| --- | --- |
| 400 | JSON 或数据字段无效、域名不匹配；修改后用新编号上传 |
| 401 | 密钥错误或缺失 |
| 409 | 编号已被不同内容占用；使用新编号 |
| 413 | 超过 2 MB，分批上传 |
| 415 | 必须使用 JSON |
| 422 | 存在未知或未启用关键词；整批未写入，重新读取列表 |
| 503 | 环境变量尚未配置 |
| 500 | 数据库写入失败；保留原内容与编号重试 |

旧日期的补录会保存为历史记录，不会覆盖更新的采集结果。排名与声量独立选择最新采集时间；声量单独导入不会清空排名。同一地区存在多个排名来源时，页面使用最新采集结果并展示来源、统计区间，不计算跨来源排名变化。该版本不提供浏览器采集排名的历史升降值。

页面按原始数值分为 1–10、11–30、31–50、51–100、无前 100 排名。右侧分布是互斥区间，所有比例以当前关键词总数为分母。

旧SerpApi手动同步入口`/api/sync/run`已返回410；旧Labs付费`action:update`也返回410。Vercel每天10:30的`/api/cron/daily-rankings`现在只负责来源健康与新的SERP计划到期检查，付费双闸关闭时不请求供应商。现有独立采集器每天负责三表增量和技术健康，详细新口径见文末及DataForSEO说明；下文保留历史导入兼容约定。
# SEO 洞察：多网站、页面与周报（2026-10）

支持 `flatkey.ai`、`rackrate.org`、`modelfit.cc`。每条排名、页面、完整采集批次与周报都归属网站；关键词可在多个网站跟踪，话题和计划页面通过网站词库维护。页面登录与导入 Bearer 密钥保持原有权限范围。

自动采集使用 `GET /api/rankings/import?site=rackrate.org` 读取词库，再 `POST /api/rankings/import`。管理页面的 JSON 文件导入走仅允许已登录会话的 `/api/seo/import`；支持单个请求对象，或 `{ "batches": [...] }`，最多 300 批，文件最多 4 MB。每个 API 请求最多 1000 条/2 MB，推荐将含词库维护的请求分成 25–50 条。每批原子写入；重传同一 requestId 和相同内容自动去重，失败后可重传完整文件。

新增可选字段：

- `topics`: `[{text, parentTopic?}]`，仅导入话题与关系。
- `inventory`: `[{keyword, topic, parentTopic?, origin, targetUrls, sourceUrl?, marketVolumes, volumeObservedAt?}]`。origin 为 PLANNED / CLUSTER / DISCOVERED / RESEARCH。声量仅写入实际提供的地区；未知留空，不能用曝光量或全球声量代替美国月搜索量。多话题归属会保留，规划词优先于研究候选。targetUrls 为计划页面，不能代替已观测的排名 URL。
- `observations[].url` 实际排名页面；`rankStatus` 为 ranked / outside_top100 / no_data。未提供时由 rank 推导，null 默认 no_data。`dataUpdatedAt` 记录来源更新时间，必须不晚于 collectedAt。
- `pages`: 与 observations 相同字段，url 必填；保留关键词与每个页面的独立 GSC/Ahrefs记录。排名 URL 必须属于 targetDomain（含子域），GSC 必须带统计起止日期。
- `allowNewKeywords: true` 允许自动发现词，归入“自然搜索发现词”；默认为 false，未知词整批拒绝。
- `capture`: `{id,date,source,region,coverage,complete}`。date 为北京时间采集日期。coverage 为 tracked（规划词）或 site_top100（全站自然关键词）。全部分批写入后最后一批置 complete=true；也允许无观测行的单独完成请求。仅 COMPLETE 的 site_top100 批次参与每日新增/减少分析，同网站/来源/地区比较最近两个不同日期。缺失的上次排名词会标“缺失待核实”；只有明确 outside_top100 才标“确认排名外”。首批只建立基线。批次一旦完成不可追加；同一请求重传可返回已写结果。

周报通过同一个 Bearer 接口导入 `traffic` 数组，也可上传 JSON：

```json
{
  "requestId": "flatkey-ga4-week-2026-10-12-v1",
  "targetDomain": "flatkey.ai",
  "traffic": [{
    "periodStart": "2026-10-06",
    "periodEnd": "2026-10-12",
    "timezone": "Asia/Shanghai",
    "scope": "all_users",
    "registrationMetric": "sign_up_distinct_users",
    "ga4PropertyId": "123456789",
    "newUsers": 1000,
    "newRegistrations": 80,
    "collectedAt": "2026-10-14T02:30:00Z"
  }]
}
```

示例属性和数字仅说明格式，采集时必须替换为实际值。周报按两个相邻、已完成的周二至周一的 7 天区间展示，支持选择历史周期。新用户数为 GA4 newUsers；注册人数为整个区间注册成功事件的用户总数（去重），不能使用事件次数、出站点击，也不能相加每日去重人数。保留实际 GA4 报告时区并验证该时区下周一已经结束。Flatkey 已核验属性 541304395、时区 America/Los_Angeles、事件 sign_up_success，导入时使用 registrationMetric=sign_up_success_distinct_users。标准 sign_up 的去重用户数使用 sign_up_distinct_users。两期属性、事件、时区和采集网站范围相同时才计算环比；缺失网站不补零。

注册率 = 去重注册用户 / 新用户。展示计数环比、注册率环比和百分点差；缺数据、分母为 0、上一期为 0 时保留无基线状态，不输出无穷值。注册人数可能包含回访用户，这一比值不是严格的新访客群转化率。若后续需要自然搜索专属流量或新访客群转化，应另建一致的过滤口径。

每天打开后台采集并不保证底层排名每天刷新：Ahrefs Rank Tracker 通常每周更新；Site Explorer 各词更新频率不同。必须保留来源日期，不把历史 GSC 表格快照当作今日、指定地区的排名。定时任务应将失败批次保留 PARTIAL，禁止用空结果覆盖成功数据。

## 汇总展示

默认使用最近已导入的完整7天GSC查询报告窗口，报告结束日须在最近7个完整自然日内；响应携带真实 reportingPeriod，所有网站和国家共用同一窗口。没有合格周报告时回退最近7个完整自然日并保留待核验。GSC仅使用起止日精确匹配该周的查询报告，单日、28天或90天报告不充当周排名。Ahrefs使用dataUpdatedAt判断数据是否在该周，没有来源日期或仍是旧数据时不充当近期排名。period=history仅供历史审计。GSC与Ahrefs在明细分列，展示原始曝光、点击、实际页面及日期；GSC均值仅是参考位置，不代表当前浏览器可复现。独立页面记录必须与关键词、网站、国家、来源及精确统计期匹配，查询均值不分配给某一个页面。单日记录不插值、不补零、不重算成周均值。

关键词明细默认显示 Flatkey 业务目标，尚无已核实页面的目标标为候选／待建设；候选研究、归档和归并记录在同一表格切换查看。概览和趋势只统计有效业务词，Flatkey 限正式词池，研究词不进入分母或排名数量。每日清单分为 keywords（有对应页面的可监控词）和 candidates（持续保留的候选），不因缺行、没曝光、排名下降或没有前100记录删除候选。普通排名／CSV导入只返回业务和声量筛检建议，不自动归档；禁止把单次0、未知或12个月均值0当作连续两个月0。只有另行核实外部平台真实月度历史连续零量、词已成熟且无新模型／真实需求保护信号后，日检才可执行有证据的可恢复归档，保留三表原行和所有历史。SiteKeyword.active=false 的已审核记录不会被导入自动复活。

历史声量采样只产生筛检建议，不能独立证明连续两个月没有搜索需求。归档前须按上述外部实际月度历史规则复核；60天是本项目运营阈值，不是行业统一删除标准。新词、模型词、缺失数据或历史不足保留。KeywordVolume.observedAt记录真实声量来源日期，旧CSV的fetchedAt只是上传时间，不能回填为来源日期；CSV可选volume_observed_at，JSON清单使用volumeObservedAt。重复上传同一来源日期只算一个采样日。原始采集记录始终保留。

概览折线按当前已导入的真实报告回算最近 7 个完整日期各自截止的连续 7 天，点日期为统计期末，终点与明细本周区间一致。它不是当日采集历史；晚到的真实周报可补相应统计期，不伪造采集日期。业务目标总数、有效前100证据、明确前100外和待核验分别展示；同一网站同一关键词跨来源只计一次。来源与报告期筛选复用明细证据规则，GSC 单日、28天或90天均值不填充周排名，Ahrefs 来源更新日期必须在该期内；新无数据报告保留为待核验，不复活旧排名。缺少有效周证据的点留空，不沿用过期排名。实际 Google 搜索核验须固定国家、语言、设备、采集时间和抓取深度，另存实际自然结果名次和页面；未核验时明确标注，不能用 GSC 区间均值或模拟值代替。缺少 SERP 配置会明确失败，不生成演示排名。

关键词环比也位于流量周报中，比较两个相邻已完成周期各自的最后一天（周一），按网站、国家、来源分别比较再汇总。例：2026-10-13 出的周报，本期 10/6–10/12，上期 9/29–10/5，关键词比较 10/5 与 10/12；下期比较 10/12 与 10/19。只统计有对应国家月搜索量的前100词，不用附近日期替代端点。确认排名外与未检出待核实分开记录。周报没有国家选择，关键词环比汇总四个国家（关键词×网站×国家分别计数）；概览、明细、管理保留国家选择。

流量汇总是各 GA4 属性的区间去重用户数之和，不做跨网站身份去重，注册率使用汇总人数相除而非各站注册率的平均值。可以展示已采集网站的部分汇总，只有两期网站范围、属性、事件和时区完全相同才算环比。三个网站各自状态单独列出，缺失不补0。人工新增话题与 CSV 默认归入 Flatkey；跨网站 JSON 根据 targetDomain 自动归属。

每日任务“每日10:30 SEO统一日检（词库与技术健康）”统一执行三表增量筛检、真实排名证据更新、Flatkey机会词分析与GSC技术健康检查；相同来源日期和数据跳过，新报告日期即使数值相同仍保留观测。原09:00排名监控与原10:30技术检查日程已合并移除，历史配置保留在.local/automations-merge/2026-10-16/，避免重复日检。博客生产流水线仍保持每30分钟的原有独立节奏。独立周报任务“每周二补充流量与关键词环比周报”仅周二18:30运行，其他日期不补充周报。需要本机开机且桌面应用运行，浏览器保留相关账号登录。来源未公布端点数据时留待下一周二补齐，不改在周三补。

## 历史单日排名与周二发布

仍使用同一个导入接口，传 `dailyRankings` 数组。每项格式：

```json
{
  "date": "2026-10-12",
  "region": "US",
  "source": "gsc",
  "top10": 1,
  "top30": 1,
  "top50": 0,
  "top100": 0,
  "totalKeywords": 2,
  "rankings": [{"keyword":"example keyword","rank":8}, {"keyword":"another keyword","rank":20.5}],
  "complete": true,
  "sourceUrl": "https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain%3Aexample.com",
  "collectedAt": "2026-10-13T18:30:00+08:00",
  "publishForWeek": "2026-10-06"
}
```

四段互不重叠：1–10、>10–30、>30–50、>50–100；必须与完整去重 rankings 明细一致，totalKeywords 包含报告中100名外的查询。完整展开/导出全部行后才能 complete=true。GSC只包含公开查询，不含匿名查询。真实无查询与采集失败不同，未初始化/未出数不能导入空数组冒充0。

`date` 是来源报告的单日，`collectedAt` 是实际读取时间，不能伪造过去的采集时间。来源链接必须为 search.google.com 或 app.ahrefs.com。同一网站/国家/来源/日期重复修正保留版本，读取最新版本；稳定 requestId 重传幂等。只补单日趋势时省略 publishForWeek。

`publishForWeek` 指定这条记录用于哪期关键词环比（该期周二日期）。仅接受北京时间周二采集、已结束的周期、上期期末或本期期末周一的数据。周报只读取带对应 publishForWeek 的已发布记录，其他天补录趋势不会改变已发布的关键词周报。例10/13发布10/6这一期，分别导入10/5、10/12的完整报告，各带publishForWeek=2026-10-06。可在后续周二补历史期，每个周期单独批次。趋势历史最早保留10/8，概览固定显示最近7天；10/5等更早基线仅供周报比较。

排名概览统计完整词库，不设500条上限。关系图将全部关键词排列为完整圆形，使用预计算坐标避免持续力导向计算，支持缩放和搜索。明细仅展示顶部所选国家的声量、排名页面与排名，支持排名区间和词库来源筛选。词库来源直接解释：页面目标词、集群页面词、实际搜索词、待评估词。

### 周报界面指标口径

注册成功用户使用注册成功事件的整周去重用户数，不是事件次数。界面「注册人数 / 新用户数」为原有导入字段派生的自定义比例；它与 GA4 用户关键事件率不同，也不代表仅首次访问新用户群体的注册转化率。不得为对齐事件次数而覆盖已导入的去重人数，也不得把 GA4 用户关键事件率写入这个派生字段。

### 临时故障与安全重试

导入接口对可重试的数据库初始化、连接或连接池故障返回 HTTP 503、retryable=true、安全错误码、原 requestId 和 Retry-After=2。格式校验、认证、requestId 内容冲突等错误不自动重试。响应丢失时无法断言事务是否已经提交，保留原始文件和 requestId 重传以核实；已提交批次会返回 duplicate=true，不会重复写入。管理页最多原样重试两次（1秒、2秒退避），逐批展示进度，成功后区分新增批次和重复跳过批次。多批次文件中已确认的批次保留，重传整个原文件安全；不要生成新 requestId 或改变原 payload 来重试同一批。


## DataForSEO SERP默认排名来源

默认排名概览、关键词实测明细和期次趋势统一围绕当前1,629个正式目标词，使用DataForSEO Google Organic SERP Standard前100核验。固定美国／英语／桌面端；其他地区没有实测结果时明确待采集。目标页面与实际排名页面分开保存，同一词可有多个实际页面，各页保留自然名次，汇总取同一轮最佳名次且关键词只计一次。

计划固定隔周周二北京时间10:30，锚点2026-10-20，每14天一次，不按任务完成时间漂移。每期唯一账本绑定目标快照，目标变化须重新预览；未采集期次不补零或延用旧值伪造本期检查。待采集、失败和深度不足单独统计，只有成功完成前100且本站未出现才能标“暂无前100排名”。Labs数据库、GSC均位和Ahrefs旧数据仅作历史证据，不参与核心实测分布。

管理页通过`/api/serp-monitor`查看计划、保存关闭状态并预览目标去重查询和费用，通过`/api/serp-monitor/results`查看已存实测结果。部署环境`DATAFORSEO_SERP_PAID_ENABLED`和数据库计划`paidEnabled`双闸保持关闭；本次部署、状态刷新和预览不发付费请求。旧`/api/sync/run`及Labs付费`action:update`已停用并返回410，旧SerpApi开关不能恢复它们。凭据仍通过原管理页加密保存，不回显密码。

三表由现有采集器每天10:30经DWS读取，按稳定行增量、逐词筛选、缺行不删和人工映射保护规则提交。`GET /api/keywords/source-sync`只显示已存行数及变更时间，不能冒充当天完整检查回执；Vercel每日Cron不直接抓取钉钉，付费关闭时只检查健康与计划状态。连接、预算和错误恢复见[DataForSEO线上说明](dataforseo.md)，来源增量规则见[三表同步说明](keyword-source-sync.md)。本节取代上文GSC周窗及Labs默认排名的旧默认设置，历史导入接口与审计继续兼容。
