import { z } from "zod";
import { createHash } from "node:crypto";
import { shiftWorkflowDay } from "./seo-workflow";

export const organicPeriodSchema = z.object({
  siteDomain: z.literal("flatkey.ai"), propertyId: z.literal("541304395"),
  start: z.iso.date(), end: z.iso.date(), timezone: z.literal("America/Los_Angeles"),
  country: z.enum(["all", "US", "JP", "BR", "ES"]), source: z.literal("google-api"),
  scope: z.literal("session-organic-search"), channelDimension: z.literal("sessionDefaultChannelGroup"),
  users: z.number().int().nonnegative().nullable(), registrations: z.number().int().nonnegative().nullable(),
  registrationEvent: z.literal("sign_up_success"), distinctOverWholePeriod: z.literal(true),
  observedAt: z.iso.datetime(), complete: z.boolean(), reasons: z.array(z.string().max(1000)).max(30),
}).strict().superRefine((row, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (row.end < row.start || Date.parse(row.end) - Date.parse(row.start) > 365 * 86400000) issue("周期日期无效");
  if (row.end >= new Intl.DateTimeFormat("en-CA", { timeZone: row.timezone }).format(new Date(row.observedAt)) || Date.parse(row.observedAt) > Date.now() + 300000) issue("只能归档已结束且非未来的区间");
  if (row.complete && (row.users === null || row.registrations === null || row.reasons.length)) issue("完整区间必须有独立去重用户数据且无质量缺口");
});
export type OrganicPeriod = z.infer<typeof organicPeriodSchema>;
export const organicPeriodId = (row: OrganicPeriod) => `organic-period:${createHash("sha256").update(JSON.stringify(row)).digest("hex")}`;

export function organicReportWindows(date: string, lastClosed: string) {
  z.iso.date().parse(date); z.iso.date().parse(lastClosed);
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  // On Friday prepare the closing week; other days refresh the ongoing Fri–Thu interval.
  const start = shiftWorkflowDay(date, weekday === 5 ? -7 : -((weekday + 2) % 7));
  const end = [shiftWorkflowDay(start, 6), lastClosed].sort()[0];
  if (end < start) return [];
  return [{ start, end }, { start: shiftWorkflowDay(start, -7), end: shiftWorkflowDay(end, -7) }];
}

export function compareOrganicPeriods(rows: OrganicPeriod[], date: string) {
  const currentStart = shiftWorkflowDay(date, -7), currentEnd = shiftWorkflowDay(date, -1);
  const valid = rows.filter(row => row.country === "all" && row.complete && row.distinctOverWholePeriod && row.scope === "session-organic-search");
  const current = valid.filter(row => row.start === currentStart && row.end <= currentEnd)
    .sort((a, b) => b.end.localeCompare(a.end) || b.observedAt.localeCompare(a.observedAt));
  for (const row of current) {
    const previous = valid.filter(other => other.start === shiftWorkflowDay(row.start, -7) && other.end === shiftWorkflowDay(row.end, -7) && other.propertyId === row.propertyId && other.timezone === row.timezone && other.registrationEvent === row.registrationEvent)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    if (previous) return { current: row, previous };
  }
  return null;
}
