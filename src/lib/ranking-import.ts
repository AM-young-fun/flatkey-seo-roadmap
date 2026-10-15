import { z } from "zod";
import { isWeeklyPeriod, reportPeriods, weeklyPeriods } from "@/lib/weekly-traffic";

export const MAX_IMPORT_BYTES = 2_000_000;
export const IMPORT_API_PATH = "/api/rankings/import";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "日期无效");
const count = z.number().int().min(0).max(2_147_483_647);

export const observationSchema = z
  .object({
    keyword: z.string().trim().min(1).max(500),
    region: z.enum(["US", "JP", "ES", "BR"]),
    source: z.enum(["gsc", "ahrefs"]),
    collectedAt: z.iso.datetime({ offset: true }),
    url: z.url().max(2000).optional(),
    dataUpdatedAt: z.iso.datetime({ offset: true }).optional(),
    rankStatus: z.enum(["ranked", "outside_top100", "no_data"]).optional(),
    rank: z.number().min(1).max(1_000_000).nullable().optional(),
    volume: count.optional(),
    clicks: count.optional(),
    impressions: count.optional(),
    ctr: z.number().min(0).max(1).optional(),
    periodStart: dateOnly.optional(),
    periodEnd: dateOnly.optional(),
  })
  .strict()
  .superRefine((row, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (row.rankStatus === "ranked" && !(row.rank != null && row.rank <= 100)) issue("ranked 必须提供前 100 排名");
    if (row.rankStatus === "outside_top100" && row.rank != null && row.rank <= 100) issue("前 100 排名不能标为排名外");
    if (row.rankStatus === "no_data" && row.rank != null) issue("no_data 不能提供排名");
    if (row.dataUpdatedAt && Date.parse(row.dataUpdatedAt) > Date.parse(row.collectedAt)) issue("来源更新时间不能晚于采集时间");
    if (row.source === "gsc") {
      if (row.rank === undefined)
        issue("GSC 必须提供 rank；没有数据时显式传 null");
      if (!row.periodStart || !row.periodEnd) issue("GSC 必须提供统计区间");
      if (row.volume !== undefined) issue("GSC 曝光量不能作为关键词声量");
    } else {
      if (row.rank === undefined && row.volume === undefined)
        issue("Ahrefs 必须提供 rank 或 volume");
      if (row.rank != null && !Number.isInteger(row.rank))
        issue("Ahrefs 排名必须是整数");
      if (
        row.clicks !== undefined ||
        row.impressions !== undefined ||
        row.ctr !== undefined
      ) {
        issue("点击、曝光、CTR 仅适用于 GSC");
      }
    }
    if (Boolean(row.periodStart) !== Boolean(row.periodEnd))
      issue("统计起止日期必须同时提供");
    if (row.periodStart && row.periodEnd) {
      if (row.periodStart > row.periodEnd)
        issue("统计开始日期不能晚于结束日期");
      if (row.periodEnd > row.collectedAt.slice(0, 10))
        issue("统计结束日期不能晚于采集日期");
    }
    if (
      row.clicks !== undefined &&
      row.impressions !== undefined &&
      row.clicks > row.impressions
    ) {
      issue("点击次数不能超过曝光次数");
    }
    if (Date.parse(row.collectedAt) > Date.now() + 5 * 60_000)
      issue("采集时间不能在未来");
  });

export const rankingImportSchema = z
  .object({
    requestId: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[\w.:-]+$/),
    targetDomain: z.string().trim().min(1).max(253),
    observations: z.array(observationSchema).max(1000).default([]),
    pages: z.array(observationSchema.safeExtend({ url: z.url().max(2000) })).max(1000).default([]),
    allowNewKeywords: z.boolean().default(false),
    topics: z.array(z.object({ text: z.string().trim().min(1).max(500), parentTopic: z.string().trim().min(1).max(500).optional() }).strict()).max(1000).default([]),
    inventory: z.array(z.object({
      keyword: z.string().trim().min(1).max(500),
      topic: z.string().trim().min(1).max(500),
      parentTopic: z.string().trim().min(1).max(500).optional(),
      origin: z.enum(["PLANNED", "CLUSTER", "DISCOVERED", "RESEARCH"]).default("PLANNED"),
      targetUrls: z.array(z.url().max(2000)).max(20).default([]),
      sourceUrl: z.url().max(2000).optional(),
      volumeObservedAt: z.iso.datetime({ offset: true }).optional(),
      marketVolumes: z.object({ US: count.optional(), JP: count.optional(), ES: count.optional(), BR: count.optional() }).strict().default({}),
    }).strict()).max(1000).default([]),
    capture: z.object({
      id: z.string().regex(/^[\w.:-]+$/).max(160),
      date: dateOnly,
      source: z.enum(["gsc", "ahrefs"]),
      region: z.enum(["US", "JP", "ES", "BR"]),
      coverage: z.enum(["tracked", "site_top100"]).default("tracked"),
      complete: z.boolean().default(false),
    }).strict().optional(),
    dailyRankings: z.array(z.object({
      date: dateOnly,
      publishForWeek: dateOnly.optional(),
      region: z.enum(["US", "JP", "ES", "BR"]),
      source: z.enum(["gsc", "ahrefs"]),
      top10: count, top30: count, top50: count, top100: count,
      totalKeywords: count,
      rankings: z.array(z.object({ keyword: z.string().trim().min(1).max(10000), rank: z.number().min(1).max(1000000) }).strict()).max(10000),
      complete: z.literal(true),
      sourceUrl: z.url().max(2000),
      collectedAt: z.iso.datetime({ offset: true }),
    }).strict().superRefine((row, ctx) => {
      const issue = (message: string) => ctx.addIssue({ code: "custom", message });
      if (row.date > row.collectedAt.slice(0, 10) || Date.parse(row.collectedAt) > Date.now() + 300000) issue("单日排名日期不能晚于采集日期，采集时间不能在未来");
      if (row.publishForWeek) {
        try {
          const periods = reportPeriods(row.publishForWeek);
          const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(row.collectedAt));
          if (new Date(day).getUTCDay() !== 2 || row.publishForWeek > weeklyPeriods(new Date(row.collectedAt)).current.start || ![periods.previous.end, periods.current.end].includes(row.date)) issue("关键词环比仅在周二发布已结束周期，使用上期与本期的周一数据");
        } catch { issue("关键词环比发布周期无效"); }
      }
      if (row.top10 + row.top30 + row.top50 + row.top100 > row.totalKeywords) issue("排名区间必须互不重叠，数量之和不能超过报告关键词总数");
      const unique = new Set(row.rankings.map(rank => rank.keyword.toLowerCase()));
      const counts = [0, 0, 0, 0];
      for (const rank of row.rankings) {
        const index = rank.rank <= 10 ? 0 : rank.rank <= 30 ? 1 : rank.rank <= 50 ? 2 : rank.rank <= 100 ? 3 : -1;
        if (index >= 0) counts[index]++;
      }
      if (unique.size !== row.totalKeywords || row.rankings.length !== unique.size || counts.some((value, index) => value !== [row.top10, row.top30, row.top50, row.top100][index])) issue("单日统计必须与完整去重关键词明细一致");
      try {
        const url = new URL(row.sourceUrl);
        if (url.protocol !== "https:" || url.username || url.password || url.hostname !== (row.source === "gsc" ? "search.google.com" : "app.ahrefs.com")) issue("单日报告必须提供对应来源的报告链接");
      } catch { issue("报告链接无效"); }
    })).max(1000).default([]),
    traffic: z.array(z.object({
      periodStart: dateOnly, periodEnd: dateOnly,
      timezone: z.string().max(80).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "报告时区无效"),
      newUsers: count, newRegistrations: count,
      scope: z.literal("all_users"),
      registrationMetric: z.enum(["sign_up_distinct_users", "sign_up_success_distinct_users"]),
      ga4PropertyId: z.string().regex(/^\d+$/),
      collectedAt: z.iso.datetime({ offset: true }),
    }).strict().superRefine((row, ctx) => {
      if (!isWeeklyPeriod(row.periodStart, row.periodEnd)) ctx.addIssue({ code: "custom", message: "周报必须为周二至周一的连续 7 天" });
      let closedEnd: string;
      try { closedEnd = weeklyPeriods(new Date(row.collectedAt), row.timezone).current.end; } catch { ctx.addIssue({ code: "custom", message: "报告时区或采集时间无效" }); return; }
      if (row.periodEnd > closedEnd || Date.parse(row.collectedAt) > Date.now() + 300000) ctx.addIssue({ code: "custom", message: "只能导入已结束的周报，采集时间不能在未来" });
    })).max(52).default([]),
  })
  .strict()
  .superRefine((batch, ctx) => {
    if (batch.observations.length + batch.pages.length + batch.inventory.length + batch.traffic.length + batch.topics.length + batch.dailyRankings.length > 1000 ||
        !(batch.observations.length + batch.pages.length + batch.inventory.length + batch.traffic.length + batch.topics.length + batch.dailyRankings.length || batch.capture?.complete)) {
      ctx.addIssue({ code: "custom", message: "每批必须有数据且最多 1000 条" });
    }
    for (const row of [...batch.observations, ...batch.pages]) {
      if (batch.capture && (row.region !== batch.capture.region || row.source !== batch.capture.source ||
          new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(row.collectedAt)) !== batch.capture.date)) {
        ctx.addIssue({ code: "custom", message: "采集批次的日期、来源、地区必须一致" });
      }
    }
    const pageKeys = new Set<string>();
    const dailyKeys = new Set<string>();
    for (const row of batch.dailyRankings) {
      const key = `${row.date}:${row.region}:${row.source}`;
      if (dailyKeys.has(key)) ctx.addIssue({ code: "custom", message: "单日排名的日期、地区、来源不能重复" });
      dailyKeys.add(key);
    }
    for (const row of batch.pages) {
      const key = `${row.keyword.toLowerCase()}:${row.source}:${row.region}:${row.url}`;
      if (pageKeys.has(key)) ctx.addIssue({ code: "custom", message: "页面记录重复" });
      pageKeys.add(key);
    }
    if (new Set(batch.traffic.map((row) => row.ga4PropertyId)).size > 1) ctx.addIssue({ code: "custom", message: "周报必须来自同一 GA4 属性" });
    const weeks = new Set<string>();
    for (const row of batch.traffic) {
      if (weeks.has(row.periodStart)) ctx.addIssue({ code: "custom", message: "周报区间不能重复" });
      weeks.add(row.periodStart);
    }
    const seen = new Set<string>();
    batch.observations.forEach((row, index) => {
      const key = `${row.keyword.toLowerCase()}:${row.region}:${row.source}`;
      if (seen.has(key))
        ctx.addIssue({
          code: "custom",
          path: ["observations", index],
          message: "同一批次中关键词、地区、来源不能重复",
        });
      seen.add(key);
    });
  });

export type RankingImportPayload = z.infer<typeof rankingImportSchema>;

export function importSecretMatches(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice(7);
  // Compare every character without an early return on a matching prefix.
  let mismatch = supplied.length ^ secret.length;
  for (let index = 0; index < secret.length; index += 1) {
    mismatch |= secret.charCodeAt(index) ^ (supplied.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export async function readImportJson(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw new ImportRequestError("需要 application/json", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ImportRequestError("请求体不能为空", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMPORT_BYTES) {
        await reader.cancel();
        throw new ImportRequestError("请求体不能超过 2 MB", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new ImportRequestError("JSON 格式无效", 400);
  }
}

export class ImportRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
