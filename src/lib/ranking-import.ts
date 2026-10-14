import { z } from "zod";

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

const observationSchema = z
  .object({
    keyword: z.string().trim().min(1).max(500),
    region: z.enum(["US", "JP", "ES", "BR"]),
    source: z.enum(["gsc", "ahrefs"]),
    collectedAt: z.iso.datetime({ offset: true }),
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
    observations: z.array(observationSchema).min(1).max(1000),
  })
  .strict()
  .superRefine((batch, ctx) => {
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
