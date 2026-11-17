import { z } from "zod";
import { shiftDay, type DateRange } from "./seo-date-range";

export const accountRegistrationStorageKind = "FLATKEY_ACCOUNT_REGISTRATIONS";
export const accountRegistrationRangeSchema = z.object({ start: z.iso.date(), end: z.iso.date() })
  .refine(range => range.start <= range.end && range.end <= shiftDay(range.start, 89), "最多读取 90 天");

export const accountRegistrationSnapshotSchema = z.object({
  version: z.literal(1),
  source: z.literal("flatkey-console-usage-report"),
  timezone: z.literal("UTC"),
  group: z.literal("all"),
  observedAt: z.iso.datetime(),
  days: z.array(z.object({ date: z.iso.date(), registered: z.number().int().nonnegative().max(100_000_000) }).strict()).min(1).max(90),
}).strict().superRefine((row, ctx) => {
  const dates = row.days.map(day => day.date);
  if (new Set(dates).size !== dates.length || dates.some(date => date >= row.observedAt.slice(0, 10))) {
    ctx.addIssue({ code: "custom", message: "只接收已结束的 UTC 自然日，日期不得重复" });
  }
  if (Date.parse(row.observedAt) > Date.now() + 5 * 60_000) ctx.addIssue({ code: "custom", message: "采集时间不能在未来" });
});

export type AccountRegistrationSnapshot = z.infer<typeof accountRegistrationSnapshotSchema>;

export function accountRegistrationSummary(range: DateRange, rows: AccountRegistrationSnapshot[] = []) {
  accountRegistrationRangeSchema.parse(range);
  const dayCounts = new Map<string, number>();
  for (const snapshot of [...rows].sort((a, b) => a.observedAt.localeCompare(b.observedAt))) {
    for (const { date, registered } of snapshot.days) dayCounts.set(date, registered);
  }
  let users = 0;
  const missing: string[] = [];
  for (let date = range.start; date <= range.end; date = shiftDay(date, 1)) {
    const count = dayCounts.get(date);
    if (count === undefined) missing.push(date);
    else users += count;
  }
  return { ...range, users: missing.length ? null : users, missing, timezone: "UTC" as const };
}

export type AccountRegistrationSummary = ReturnType<typeof accountRegistrationSummary>;
