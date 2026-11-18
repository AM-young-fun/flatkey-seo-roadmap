import { z } from "zod";
import { createHash } from "node:crypto";

export const registrationPeriodSchema = z.object({
  version: z.literal(1), siteDomain: z.literal("flatkey.ai"), propertyId: z.literal("541304395"),
  streamId: z.literal("15056169010"), measurementId: z.literal("G-30RCEP2CVH"),
  source: z.literal("google-api"), timezone: z.literal("America/Los_Angeles"),
  channelDimension: z.literal("firstUserPrimaryChannelGroup"), channelName: z.literal("Organic Search"),
  event: z.literal("sign_up_success"), metric: z.literal("totalUsers"), distinctOverWholePeriod: z.literal(true),
  start: z.iso.date(), end: z.iso.date(), observedAt: z.iso.datetime(),
  users: z.number().int().nonnegative(), events: z.number().int().nonnegative(),
  sources: z.array(z.url().refine(value => new URL(value).hostname === "analytics.google.com" && new URL(value).protocol === "https:" && !new URL(value).username && !new URL(value).password)).min(1).max(5),
}).strict().superRefine((row, ctx) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: row.timezone }).format(new Date(row.observedAt));
  const eligibleEnd = new Date(Date.parse(today + "T00:00:00Z") - 3 * 86400000).toISOString().slice(0, 10);
  if (row.start > row.end || Date.parse(row.end) - Date.parse(row.start) > 366 * 86400000 || row.end > eligibleEnd || Date.parse(row.observedAt) > Date.now() + 300000 || row.users > row.events)
    ctx.addIssue({ code: "custom", message: "注册区间、采集时间或去重人数无效" });
});
export type RegistrationPeriod = z.infer<typeof registrationPeriodSchema>;
export const registrationPeriodId = (row: RegistrationPeriod) => `seo-registration:${createHash("sha256").update(JSON.stringify(row)).digest("hex")}`;
export function registrationPeriodSelection(rows: RegistrationPeriod[], start: string, end: string, previousStart: string, previousEnd: string) {
  const latest = (a: string, b: string, partial = false) => rows.filter(row => row.start === a && (partial ? row.end <= b : row.end === b))
    .sort((a, b) => b.end.localeCompare(a.end) || b.observedAt.localeCompare(a.observedAt))[0] ?? null;
  const current = latest(start, end, true);
  // Compare identical covered day counts; never a partial week against seven days.
  const matchedEnd = current ? new Date(Date.parse(current.end) - (Date.parse(end) - Date.parse(previousEnd))).toISOString().slice(0, 10) : previousEnd;
  return { current, previous: latest(previousStart, matchedEnd) };
}
export function registrationPeriodComparison(rows: RegistrationPeriod[], start: string, end: string, previousStart: string, previousEnd: string) {
  const selected = registrationPeriodSelection(rows, start, end, previousStart, previousEnd);
  return { current: selected.current?.users ?? null, previous: selected.previous?.users ?? null };
}
