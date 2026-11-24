import { z } from "zod";
import { reportDayStart } from "./seo-report-time.cjs";

const stamp = z.iso.datetime({ offset: true });
const timezone = z.string().min(1).refine(value => { try { new Intl.DateTimeFormat("en-CA", { timeZone: value }); return true; } catch { return false; } }, "来源时区无效");
const count = z.number().int().nonnegative().safe();
export const growthExactTrafficSchema = z.object({
  id: z.string().min(1).max(200), site: z.enum(["flatkey.ai", "rackrate.org", "modelfit.cc", "rougecue.org"]), propertyId: z.string().regex(/^\d+$/),
  start: z.iso.date(), end: z.iso.date(), timezone: z.literal("America/Los_Angeles"), sourceTimezone: timezone,
  metadata: z.object({ timeZone: timezone, propertyId: z.string().regex(/^\d+$/), observedAt: stamp, reference: z.string().min(1).max(3000) }).strict(),
  source: z.enum(["google-api", "browser-export"]), observedAt: stamp, reference: z.string().min(1).max(3000),
  scope: z.literal("session-organic-search"), channelDimension: z.literal("sessionDefaultChannelGroup"), channelValue: z.literal("Organic Search"),
  hostScope: z.literal("production-hosts-v1"), hostnames: z.array(z.string().min(1)).min(1).max(20), complete: z.literal(true), sessions: count,
  intervalStart: stamp, intervalEnd: stamp,
  method: z.enum(["native_days", "utc_hours"]),
  days: z.array(z.object({ date: z.iso.date(), sessions: count, complete: z.literal(true) }).strict()).max(7).optional(),
  hours: z.array(z.object({ utcStart: stamp, sourceDateHour: z.string().regex(/^\d{10}$/), sessions: count, complete: z.literal(true) }).strict()).max(170).optional(),
}).strict().superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const nextDay = new Date(Date.parse(value.end + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
  const from = Date.parse(reportDayStart(value.start)), to = Date.parse(reportDayStart(nextDay));
  if (Date.parse(value.end) - Date.parse(value.start) !== 6 * 86400000 || Date.parse(value.intervalStart) !== from || Date.parse(value.intervalEnd) !== to) fail("须覆盖同一完整洛杉矶7日的准确UTC起止，不接受仅更改时区标签");
  if (value.metadata.timeZone !== value.sourceTimezone || value.metadata.propertyId !== value.propertyId || Date.parse(value.metadata.observedAt) > Date.parse(value.observedAt) || Date.parse(value.observedAt) < to) fail("须保留对应真实属性metadata时区和已结束区间");
  if (value.hostnames.some(host => value.site === "flatkey.ai" ? !["flatkey.ai", "www.flatkey.ai", "console.flatkey.ai"].includes(host) : ![value.site, "www." + value.site].includes(host))) fail("只接受对应站点真实生产主机，不包含测试域名或IP");
  if (value.method === "native_days") {
    if (value.sourceTimezone !== "America/Los_Angeles" || !value.days || value.days.length !== 7 || value.hours || value.days.some((day, index) => day.date !== new Date(Date.parse(value.start + "T00:00:00Z") + index * 86400000).toISOString().slice(0, 10)) || value.days.reduce((sum, day) => sum + day.sessions, 0) !== value.sessions) fail("原生LA日桶必须为连续完整7天且会话相符");
  } else {
    const hours = value.hours ?? [];
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: value.sourceTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    if (value.days || hours.length !== (to - from) / 3600000 || hours.some((hour, index) => {
      const instant = Date.parse(hour.utcStart), parts = Object.fromEntries(format.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
      return instant !== from + index * 3600000 || hour.sourceDateHour !== `${parts.year}${parts.month}${parts.day}${parts.hour}`;
    }) || hours.reduce((sum, hour) => sum + hour.sessions, 0) !== value.sessions) fail("小时重聚必须保留全部连续UTC小时及对应原属性dateHour，覆盖DST且会话相符");
  }
});
export type GrowthExactTrafficEvidence = z.infer<typeof growthExactTrafficSchema>;
/** The current Flatkey goal includes both website and console. A narrower
 * historic host receipt stays stored, but cannot stand in for the whole goal. */
export function growthTrafficHasCompleteHostScope(row: Pick<GrowthExactTrafficEvidence, "site" | "hostnames">): boolean {
  return row.site !== "flatkey.ai" || JSON.stringify([...new Set(row.hostnames)].sort()) === JSON.stringify(["flatkey.ai", "www.flatkey.ai", "console.flatkey.ai"].sort());
}
