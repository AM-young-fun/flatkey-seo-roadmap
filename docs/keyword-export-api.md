# 未获前100排名关键词导出：接口接入文档

## 1. 接口用途

**仅从网站的在用目标词中排除已有前100排名的词，返回其余目标词及规划信息。Flatkey 只包含正式词库，不包含研究池。页面绑定与任务进度不影响是否返回。**

- 第1–100名全部排除，包括第51–100名。
- 有对应页面但没有前100排名的词返回，并通过 `hasPage`、`pageUrls` 说明页面情况。
- 没有对应页面且没有前100排名的词同样返回。
- 未采集、采集失败、正在采集、Google纠词或检查深度不足的词也返回，并标记 `NEEDS_VERIFICATION`；不会将未知状态冒充已确认没有排名。
- Flatkey 仅包含 `FORMAL` 正式词，未分配主题的正式词也保留；研究池、归档及合并词不返回。RackRate、ModelFit 按已分配主题的在用目标词筛选。停用或已移除的词不返回。
- 任务是否已开始、受阻或已完成不决定是否返回，任务进度随结果提供。

筛选按所选地区最近保存的有效 Google SERP 名次判断：存在第1–100名就排除；没有有效前100名次就返回。返回结果进一步区分 `OUTSIDE_TOP100`（已完整核验、未命中）与 `NEEDS_VERIFICATION`（排名未知）。接口不会现场查询Google。

## 2. 获取 API Key

1. 登录系统，进入「数据管理 → API Key · 关键词导出」。
2. 输入密钥名称，选择「全部网站」或限定 `flatkey.ai`、`rackrate.org`、`modelfit.cc` 中的一个网站。
3. 点击「创建 API Key」，然后点击「复制 API Key」。点击「复制请求示例」可直接取得包含当前部署域名与密钥的 curl 命令。

刷新页面后仍可复制已有密钥。浏览器禁止剪贴板操作时，页面会显示可选中的密钥框，支持手动复制。停用密钥后，不能继续使用它请求接口。

## 3. 地址与鉴权

```text
GET {BASE_URL}/api/keywords/content-opportunities
```

`BASE_URL` 为 `https://flatkey-seo-roadmap.vercel.app`。管理页面的「复制请求示例」也会自动填入当前部署地址。

以下请求头任选一种：

```http
X-API-Key: seo_export_你的密钥
```

```http
Authorization: Bearer seo_export_你的密钥
```

外部调用不需要登录 Cookie，但每次请求必须携带专用 API Key。网页登录密码、排名导入密钥、定时任务密钥不能替代它。不要通过 URL 参数传密钥；两个鉴权头同时传入时，值必须一致。

## 4. 查询参数

| 参数 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `siteDomain` | 否 | 密钥授权范围 | `flatkey.ai`、`rackrate.org`、`modelfit.cc`。全部网站密钥省略时查询所有启用网站，单网站密钥省略时查询其授权网站。 |
| `region` | 否 | `all` | `all`、`US`、`JP`、`ES`、`BR`。指定地区只判断该地区；`all` 只要四个地区任一个有前100排名就排除；其余返回，包括排名未知或仅部分地区有数据的词。 |
| `format` | 否 | `json` | `json` 返回结构化数据，`csv` 下载带 UTF-8 BOM 的 CSV。 |

单网站密钥不能请求其他网站；空字符串和不支持的参数值返回 `400`。

## 5. 请求示例

将示例中的 API Key 替换成数据管理页面复制的真实密钥即可使用。

### 导出美国没有排名的关键词

```bash
curl 'https://flatkey-seo-roadmap.vercel.app/api/keywords/content-opportunities?siteDomain=flatkey.ai&region=US' \
  -H 'X-API-Key: seo_export_你的密钥'
```

### 排除任一地区已有前100排名的词，导出其余目标词

```bash
curl 'https://flatkey-seo-roadmap.vercel.app/api/keywords/content-opportunities' \
  -H 'Authorization: Bearer seo_export_你的密钥'
```

### 下载 CSV

```bash
curl --fail-with-body \
  'https://flatkey-seo-roadmap.vercel.app/api/keywords/content-opportunities?siteDomain=flatkey.ai&region=US&format=csv' \
  -H 'X-API-Key: seo_export_你的密钥' \
  -o content-opportunities.csv
```

### JavaScript / Node.js

```js
const url = new URL('/api/keywords/content-opportunities', process.env.SEO_BASE_URL);
url.searchParams.set('siteDomain', 'flatkey.ai');
url.searchParams.set('region', 'US');

const response = await fetch(url, {
  headers: { 'X-API-Key': process.env.SEO_EXPORT_API_KEY },
});
if (!response.ok) {
  throw new Error(`导出失败（${response.status}）：${await response.text()}`);
}
const { total, rows } = await response.json();
console.log(`没有排名的关键词：${total}`);
for (const row of rows) {
  console.log(row.keyword, row.hasPage ? '已有对应页面' : '没有对应页面', row.pageUrls);
}
```

## 6. JSON 返回示例

示例数据仅演示结构。有页面和无页面的词均可返回。

```json
{
  "kind": "content-opportunities",
  "generatedAt": "2026-10-19T08:00:00.000Z",
  "siteDomain": "flatkey.ai",
  "region": "US",
  "targetRank": 100,
  "rankingSource": "dataforseo_serp",
  "total": 1,
  "summary": { "outsideTop100": 1, "needsVerification": 0 },
  "rows": [
    {
      "keywordId": "example-keyword-id",
      "keyword": "example api guide",
      "siteDomain": "flatkey.ai",
      "pool": "FORMAL",
      "searchVolume": 100,
      "hasPage": true,
      "pageStatus": "MATCHED",
      "pageUrls": ["https://flatkey.ai/blog/example-api-guide"],
      "candidateUrls": [],
      "currentRank": null,
      "isTop100": false,
      "opportunityStatus": "OUTSIDE_TOP100",
      "recommendedAction": "OPTIMIZE",
      "rankingEvidence": [
        {
          "region": "US",
          "status": "OUTSIDE_TOP100",
          "rank": null,
          "url": null,
          "checkedAt": "2026-10-19T07:00:00.000Z",
          "coveredThroughRank": 100,
          "periodKey": "2026-10-2"
        }
      ],
      "taskStatus": "DONE",
      "taskStatuses": ["DONE"],
      "taskIds": ["example-page-task-id"],
      "plannedUrls": [],
      "proposedTitle": null,
      "requirements": [],
      "acceptance": []
    }
  ]
}
```

该示例表示页面已有且内容任务已完成，但尚无前100排名，因此仍返回。不是要求调用方再次新建相同页面。

### 响应字段

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `kind` | string | 固定 `content-opportunities`。 |
| `generatedAt` | string | 导出时间，ISO 8601 UTC。 |
| `siteDomain` | string / null | 实际筛选网站；全部授权范围时为 `null`。 |
| `region` | string | 实际排名判断范围：`all`、`US`、`JP`、`ES`、`BR`。 |
| `targetRank` | number | 固定 `100`，前100词全部排除。 |
| `rankingSource` | string | 固定 `dataforseo_serp`，使用已保存实测，不混用 GSC / Ahrefs / Labs 历史名次。 |
| `total` | number | 当前返回的网站目标词条数；每个 `(siteDomain, keywordId)` 一条。地区证据和关联任务不会增加条数。跨网站相同词分别计数。 |
| `summary.outsideTop100` | number | 所选地区均已确认不在前100的条数。 |
| `summary.needsVerification` | number | 排名未知或地区覆盖不完整、仍保留在结果中的条数。两项相加等于 `total`。 |
| `rows` | array | 关键词清单。无符合条件的数据时为 `[]`，仍返回 `200`。 |
| `rows[].keywordId` | string | 关键词 ID。 |
| `rows[].keyword` | string | 关键词文本。 |
| `rows[].siteDomain` | string | 所属网站。 |
| `rows[].pool` | string | 已保存的词池；Flatkey 仅返回 `FORMAL`，其他网站按已分配主题的目标范围筛选。 |
| `rows[].searchVolume` | number | 已保存的默认搜索量，未知时可能为 `0`，不是实时或特定地区最新搜索量。 |
| `rows[].hasPage` | boolean | 是否有已记录的对应页面，即 `pageUrls` 是否非空；规划地址和候选地址不计入。是保存的关联信息，不是本次请求现场验证页面。 |
| `rows[].pageStatus` | string | `MATCHED` 已匹配、`EXPAND` 待优化、`BUILD` 待建设、`MISMATCH` 错配、`REVIEW` 待核实。 |
| `rows[].pageUrls` | string[] | 已记录的本站对应页面。已确认缺页或无匹配页的历史地址不作为当前页面返回。 |
| `rows[].candidateUrls` | string[] | 候选地址，供后续核实；不计入 `hasPage`。 |
| `rows[].currentRank` | null | 未取得有效前100名次，包括未命中和排名未知两种情况。 |
| `rows[].isTop100` | false / null | `false` 表示所选地区均已确认不在前100；`null` 表示排名未知。`true` 的词已被排除。 |
| `rows[].opportunityStatus` | string | `OUTSIDE_TOP100` 已确认未命中；`NEEDS_VERIFICATION` 排名未知。两者均返回。 |
| `rows[].recommendedAction` | string | `BUILD` 建议新建、`OPTIMIZE` 建议优化已有页、`REVIEW_PAGE` 先核实页面。建议操作不影响是否返回。 |
| `rows[].rankingEvidence` | array | 所选地区最近保存的排名依据。`all` 时四条，指定地区时一条。 |
| `rows[].rankingEvidence[].region` | string | 地区代码。 |
| `rows[].rankingEvidence[].status` | string | `OUTSIDE_TOP100`、`PENDING`、`QUEUED`、`FAILED`、`INCOMPLETE`、`QUERY_CHANGED` 或 `NOT_FOUND_CAPTURE`，如实保留各地区状态。 |
| `rows[].rankingEvidence[].rank` | null | 未获得本站前100名次。 |
| `rows[].rankingEvidence[].url` | null | 本次排名核验未命中本站 URL；对应页面请看 `pageUrls`。 |
| `rows[].rankingEvidence[].checkedAt` | string / null | SERP 实测时间，ISO 8601 UTC；未采集时为 `null`。 |
| `rows[].rankingEvidence[].coveredThroughRank` | number / null | 保存的连续自然排名核验深度；旧版回执可能缺少此字段，完整性仍由已保存的有效完整核验结论确定。 |
| `rows[].rankingEvidence[].periodKey` | string / null | 已保存的采集期标识。 |
| `rows[].taskStatus` | string | 单个任务状态、`UNASSIGNED` 未分配，或多个状态并存时的 `MIXED`。 |
| `rows[].taskStatuses` | string[] | 实际任务状态列表，如 `TODO`、`IN_PROGRESS`、`DONE`、`BLOCKED`。 |
| `rows[].taskIds` | string[] | 关联任务 ID，可据此避免重复制作。 |
| `rows[].plannedUrls` | string[] | 新建任务的规划地址，不代表页面已存在。 |
| `rows[].proposedTitle` | string / null | 已审核方案的建议标题，缺少方案时为 `null`。 |
| `rows[].requirements` | string[] | 已保存的逐词内容要求，可能为空。 |
| `rows[].acceptance` | string[] | 已保存的逐词验收标准，可能为空。 |

CSV 同步包含页面情况、是否前100、当前排名、排名依据、建议操作和任务进度等字段。数组字段在单元格内以换行分隔，地区排名依据为 JSON；以公式符号开头的文本加单引号，避免被表格软件执行。

## 7. 数据范围与使用规则

- 网站、网站关键词和关键词本身均需启用。Flatkey 限 `pool=FORMAL`，不要求主题或页面已绑定；RackRate、ModelFit 限已分配主题的目标词。研究池不因在用或已有规划而自动成为 Flatkey 正式目标。
- 同一词在不同网站分别判断，使用 `(siteDomain, keywordId)` 唯一标识。某个网站有排名不影响另一个网站的无排名词。
- 每个地区使用最近保存的 SERP 任务结论；最新任务失败时仍返回该词，并显示失败/待核实，不用更旧的无排名回执冒充本次成功核验。
- 页面关联、建设任务进度不作为排名筛选条件。已合并、已恢复的历史任务不影响当前任务状态。
- 按网站、默认搜索量降序、关键词排序，一次返回完整清单，无分页。
- 导出不触发付费采集、不分配任务，也不会改变任务进度。重复调用可以返回相同关键词，调用方需根据任务 ID 与状态协调后续工作。

## 8. 错误处理

错误响应为 JSON：

```json
{ "message": "API Key 缺失、无效或已停用" }
```

| HTTP 状态码 | 含义 | 处理建议 |
| --- | --- | --- |
| `200` | 成功，包括空列表。 | 正常读取 `rows`。 |
| `400` | 网站、地区或格式参数无效。 | 修正参数取值。 |
| `401` | 密钥缺失、无效、已停用或鉴权头冲突。 | 重新复制有效密钥。 |
| `403` | 密钥不允许访问指定网站。 | 使用授权范围内的网站或创建对应权限密钥。 |
| `503` | 数据库未配置、排名证据读取失败或服务不可用。 | 有限次数退避重试；持续失败时检查连接和数据库升级。 |

所有响应设置 `Cache-Control: private, no-store`。数据库读取失败返回 `503`；已保存的采集失败则作为词级排名状态随清单返回。

## 9. 部署与密钥存储

- 需要配置 `DATABASE_URL` 与 `LOGIN_PWD`，登录后才能管理密钥。
- 新增 Prisma 模型 `KeywordExportApiKey`，已接入 `prisma/ranking-import.sql` 幂等增量建表流程。现有 Vercel 生产构建会自动执行；其他部署方式应在启动新版前执行已有数据库准备流程。
- 手动执行增量 SQL：`npx prisma db execute --file prisma/ranking-import.sql --schema prisma/schema.prisma`，在已配置数据库连接的项目环境中执行。该 SQL 同时包含项目原有升级步骤。
- 鉴权用 SHA-256 摘要查询，密钥另以 AES-256-GCM 加密保存，以便登录后再次复制；列表不返回明文或密文。
- 更改 `LOGIN_PWD` 后，旧密钥无法再次解密复制，但已分发密钥仍可鉴权。轮换时先停用旧密钥，再新建并更新调用方。

管理页面：`/manage`。管理接口 `/api/api-keys` 受网页登录保护；外部工作流只需本文的只读导出接口。
