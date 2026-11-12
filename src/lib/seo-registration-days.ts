import { z } from "zod";
import { GA4_REGISTRATION_METRIC } from "./ga4-host-scope";
import { shiftDay, type DateRange } from "./seo-date-range";
import { businessCountrySchema } from "./seo-business-analytics";

export const registrationDaysKind = "GA4_REGISTRATION_DAYS";
const registrationDaySchema = z.object({ date: z.iso.date(), users: z.number().int().nonnegative() }).strict();

export const registrationDaysSchema = z.object({
  siteDomain: z.literal("flatkey.ai"),
  propertyId: z.literal("541304395"),
  timezone: z.literal("America/Los_Angeles"),
  source: z.literal("google-api"),
  scope: z.literal("all-channels"),
  registrationMetric: z.literal(GA4_REGISTRATION_METRIC),
  country: businessCountrySchema,
  start: z.iso.date(),
  end: z.iso.date(),
  observedAt: z.iso.datetime(),
  days: z.array(registrationDaySchema).max(366),
}).strict().superRefine((record, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  const observedAt = new Date(record.observedAt);
  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: record.timezone }).format(observedAt);
  if (record.end < record.start || Date.parse(record.end) - Date.parse(record.start) > 365 * 86400000
    || record.end >= localDay || observedAt.getTime() > Date.now() + 300000) issue("注册区间必须是已结束的日期");
  if (new Set(record.days.map(row => row.date)).size !== record.days.length
    || record.days.some(row => row.date < record.start || row.date > record.end)) issue("注册日期重复或超出区间");
});
export type RegistrationDays = z.infer<typeof registrationDaysSchema>;

export function registrationDaySeries(range: DateRange, snapshots: RegistrationDays[]) {
  const counts = new Map<string, number>();
  for (const snapshot of [...snapshots].sort((a, b) => b.observedAt.localeCompare(a.observedAt))) {
    for (const { date, users } of snapshot.days) {
      if (!counts.has(date)) counts.set(date, users);
    }
  }
  const daily = [];
  for (let date = range.start; date <= range.end; date = shiftDay(date, 1)) {
    daily.push({ date, users: counts.get(date) ?? null });
  }
  return daily;
}
