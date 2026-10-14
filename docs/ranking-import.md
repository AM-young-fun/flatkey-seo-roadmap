# 每日浏览器采集与导入

采集在独立会话中进行：每天北京时间 10:30，浏览器读取 GSC / Ahrefs，随后调用本项目接口。该仓库负责接收与展示，不调用 GSC / Ahrefs API，也不负责唤醒采集会话。定时任务尚需另行创建。

## 上线配置

1. 线上沿用已有 `DATABASE_URL`、`SEO_TARGET_DOMAIN` 和 `LOGIN_PWD`。
2. 推送到 `main` 后，Vercel 的生产构建会自动执行 `scripts/prepare-production-db.mjs`，应用 `prisma/ranking-import.sql`。只新增表、索引和枚举，不删除或重建既有数据；重复构建可重复执行，数据库变更失败时构建停止，保留旧部署。仅在 `VERCEL_ENV=production` 时执行。
3. 导入密钥优先使用 `RANKING_IMPORT_SECRET`。未配置时，以已有 `CRON_SECRET`（否则 `LOGIN_PWD`）通过 HMAC-SHA256 派生独立密钥；不能用原始登录密码或 Cron 密钥直接调用导入接口。更改根密钥会改变派生密钥。
4. 登录线上「数据管理」，点击「复制导入密钥」，将其配置为采集会话本地的 `RANKING_IMPORT_SECRET`。读取密钥的 `GET /api/rankings/credential` 必须使用网页登录态；导入 Bearer 密钥不能访问它。密钥不会出现在 Git 或部署日志中。
5. 如需单独轮换，可后续在 Vercel 配置独立的 `RANKING_IMPORT_SECRET`；这不是首次发布的必需步骤。

生产 SQL 采用事务与锁，仅做幂等增量变更（PostgreSQL 12+）。首次建库仍需原有基础表；当前发布针对已经存在的线上数据库。已有数据库尚未建立 Prisma migration baseline，因此此 SQL 不作为 `migrate deploy` 的首个迁移。
主页、关键词明细在可见时每 15 秒刷新，回到标签页时也刷新。上传完成后无需人工刷新。页面的「每天 10:30 更新」是预定采集时间，不代表定时任务已创建。

## 1. 获取当前关键词

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $RANKING_IMPORT_SECRET" \
  https://flatkey-seo-roadmap.vercel.app/api/rankings/import
```

返回 `targetDomain`、`regions` 和 `keywords`（`id`、`keyword`、`topic`）。仅包含启用且已关联话题的关键词。采集时使用返回的关键词原文，按四个国家分别过滤。没有采集到的记录不要编造排名或用 0 代替。

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

旧的 Vercel SerpApi 同步 Cron 已移除，以免和新的浏览器采集重复运行。每天 10:30 的独立会话在导入能力上线后配置。
