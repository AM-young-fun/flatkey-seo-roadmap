# 每周关键词优化清单

每周五北京时间 10:10，沿用已有周报任务核对页面与关键词，保存从当天开始的新工作周优化清单。周报中的「每周优化清单」读取最新真实归档，直接显示工作周、整理时间和草案状态；没有记录时显示尚未生成。

## 周期与状态

- `periodStart` 是北京时间周五开始的工作周，格式 `YYYY-MM-DD`。周五任务使用当天的北京时间日期作为起点，计划覆盖至下周四。
- 工作周和 GA4 流量报告周期分别展示。GA4 继续按 `America/Los_Angeles` 统计已结束日；北京时间周五 10:10 可能仍是洛杉矶周四，此时流量报告和新工作周计划的起始日不同是正常的。
- 优化清单界面默认读取 `week=latest`，始终展示 `工作周 periodStart — periodStart+6`。最新归档早于当前北京时间工作周时明确标为「历史工作周」；晚于当前工作周时标为「未来工作周」。不得把旧计划称为本周计划。
- `preparedAt` 是实际整理时间的 ISO 时间戳。
- `draft` 表示待核对草案；`reviewed` 表示已核对当前 SERP、目标页面和动作依据。站点级排名不能冒充某个目标页面的排名。
- 同一页面、同一国家最多一个主词；其他词标为辅助词。每份最多 10 项，周报先显示前 5 项。

## 保存格式

```json
{
  "periodStart": "2026-10-30",
  "preparedAt": "2026-11-04T03:00:00.000Z",
  "status": "draft",
  "sources": [{ "name": "实际使用的排名或搜索表现快照", "date": "2026-10-30", "url": "https://example.com/evidence" }],
  "actions": [{
    "pageUrl": "https://flatkey.ai/zh/models",
    "country": "US",
    "keyword": "实际核对的关键词",
    "role": "primary",
    "currentRank": null,
    "targetRank": null,
    "monthlySearchVolume": null,
    "estimatedClicks": null,
    "ctrAssumption": null,
    "reason": "为什么该页面和词应优先处理，注明证据与缺口",
    "action": "具体修改项及下次验收方法"
  }]
}
```

示例只说明结构，不是实际关键词建议。`country` 支持 `US / JP / ES / BR`；`role` 支持 `primary / support`。`sources[].url` 可省略，其余示例字段必须提供。

无依据的排名、搜索量和预估填写 `null`。只有同时有月搜索量、目标排名与 CTR 假设时才可填预估月点击，计算为 `monthlySearchVolume × ctrAssumption`，CTR 使用 0–1 的比例。显示为情景估算，不表示承诺或实际新增点击。页面必须是 Flatkey 的 HTTPS 地址。

## 接口与存储

- `GET /api/seo/weekly-actions?week=latest`：读取最新已归档的工作周，供界面使用。可传具体周五日期读取对应计划。
- 兼容参数 `week=current`（API 缺省值）仍按 GA4 属性时区的当前周五至周四取周期；采集任务保存和界面读取工作周计划时不要依赖这个兼容默认值。
- `POST /api/seo/weekly-actions`：保存完整 JSON。采集器使用已有采集凭据且不发送浏览器 Origin；本地预览允许已授权同源请求。
- 本地归档目录为 `.local/seo-analytics/weekly-actions/`，由 Git 忽略。也可调用 `writeWeeklyActionPlan(input, directory)` 完成校验与原子保存。
- 文件名包含周期、实际整理时间和状态。保留旧版本，同周期读取最新版本；已有同名内容不允许静默改写。
- 生产环境默认将周计划保存至 PostgreSQL。挂载持久卷的环境可通过 `SEO_WEEKLY_ACTIONS_STORE_DIR` 指定绝对路径。

周报任务保存后须使用明确的 `?week=periodStart` 回读刚保存的工作周，确认日期、状态、条数和来源日期；任何缺失证据在 `reason` 中说明，避免自动把草案标成已核对。

## 周报内容标准

每期同时遵循 [SEO 周报标准](seo-weekly-report-standard.md)，覆盖业务结果、搜索表现、重点页面、关键词进展、技术与收录异常、下周行动与上期复盘。优先交付已核实数据；缺少的查询词、页面独立排名、索引或CTR来源必须标明，不能用推算的全站总数或健康分填充。

## 优化完成后的持续复盘

关键词机会页保存的目标、优化日期及实际改动使用项目端归档，不依赖浏览器 localStorage。自动任务每次复盘前读取这些记录，与本期真实页面流量及可核实的页面排名关联。旧浏览器草稿不会自动导入。

- `GET /api/seo/optimization-plans` 返回 `plans`，每个国家、规范化关键词、目标页面保留一条最新版本。支持同源已登录请求或不带 Origin 的既有采集凭据。
- `POST /api/seo/optimization-plans` 保存单个目标；严格校验页面、国家、目标排名、人工 CTR 假设、日期与基线字段，最大 64 KiB。
- 本地预览归档位于 `.local/seo-analytics/optimization-plans/`。自动任务可调用 `readOptimizationPlans(directory)` 读取最新记录，传第二参数 `true` 读取全部修订；记录含 `id`、`revision`、`updatedAt`。文件按国家、关键词与页面的 SHA-256 ID、保存时间及修订 UUID 命名。
- 每次保存追加私有历史版本（文件 0600、目录 0700），不覆盖历史。`optimizedAt` 是实际完成日期，`changes` 是实际改动，`notes` 是优化动作与判断依据。首次保存的 `baseline` 保留不改；它表示目标首次保存时的数据，不能自动称为优化前测量。
- 当前快照只能核实站点级排名，故 `baseline.siteRank` 可有值，`baseline.pageRank` 和 `baseline.rankUrl` 必须为 `null`。真实排名 URL 未核实为目标页前，不计算页面排名提升。`snapshotGeneratedAt` 是来源快照生成时间，不冒充独立关键词采集时间。
- 流量复盘从优化次日起查看 7、14、28 天，截止到 GA4 属性时区已结束日，与优化日前等长区间比较。缺日保留提示，未达到完整窗口时注明已结束天数。
- 生产环境默认将优化目标与历史版本保存至 PostgreSQL。挂载持久卷的环境可通过 `SEO_OPTIMIZATION_PLANS_STORE_DIR` 指定绝对路径。

自动周报使用最近有效记录列出已完成动作、对应页面实际流量变化和下次检查日。没有优化记录时写明“暂无已保存的优化完成记录”，不要自动标记页面已优化；已存站点排名、人工目标与情景点击估算均不能替代实测页面排名或实际新增点击。
