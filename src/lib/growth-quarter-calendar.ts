import { z } from "zod";
import type { GrowthTarget } from "./growth-types";
import { growthLogicalTargetIdSchema } from "./growth-target-id-schema";
import { GROWTH_MARKET_LANGUAGES } from "./seo-growth-markets";
import { shiftDay, workWeekDateRange } from "./seo-date-range";
import { isSeoWorkday } from "./seo-workday";

export const QUARTER_NEW_WORD_COUNT = 1000;
export const QUARTER_NEW_WORD_VERSION = "quarter-planning-v3";
export const QUARTER_NEW_MARKET_SHARES = { US: 20, JP: 20, ES: 20, SG: 20, other: 20 } as const;
const otherMarkets = new Set(["BR", "FR", "DE", "VN", "ID"]);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const isWorkday = (date: string) => isSeoWorkday(new Date(date + "T12:00:00+08:00"));

export const quarterCalendarRowSchema = z.object({
  targetId: growthLogicalTargetIdSchema,
  intentId: z.string().trim().min(1).max(200),
  primary: z.boolean(),
  kind: z.enum(["blog", "cluster_landing"]),
  researchDate: z.iso.date(),
  deliveryDate: z.iso.date(),
  ahrefs: z.object({
    keyword: z.string().min(1).max(2000),
    country: z.enum(["US", "JP", "ES", "SG", "BR", "FR", "DE", "VN", "ID"]),
    source: z.literal("ahrefs_web"),
    sourceReference: z.string().trim().min(1).max(3000),
    sourceSha256: sha256,
    sourceRow: z.number().int().positive(),
    observedAt: z.iso.datetime({ offset: true }),
    volume: z.number().int().min(10),
  }).strict(),
}).strict();
type CalendarRow = z.infer<typeof quarterCalendarRowSchema>;
type CalendarTarget = Pick<GrowthTarget, "id" | "site" | "topicId" | "keyword" | "country" | "language">;
type Slot = { site: string; kind: CalendarRow["kind"]; deliveryDate: string };

export function quarterCalendarProblem(calendar: CalendarRow[], targets: CalendarTarget[], now: Date, commitments: Slot[] = []) {
  const byId = new Map(targets.map(row => [row.id, row]));
  const shares = { US: 0, JP: 0, ES: 0, SG: 0, other: 0 };
  const sourceRows = new Set<string>();
  const intents = new Map<string, { key: string; primaries: number; slot: Slot }>();
  for (const row of calendar) {
    const target = byId.get(row.targetId);
    if (!target || !target.topicId || target.keyword !== row.ahrefs.keyword || target.country !== row.ahrefs.country
      || GROWTH_MARKET_LANGUAGES[row.ahrefs.country] !== target.language
      || Date.parse(row.ahrefs.observedAt) > now.getTime()) return "Ahrefs原词、主市场、语种、已有话题与真实证据时间须逐项对平";
    const sourceRow = row.ahrefs.sourceSha256 + ":" + row.ahrefs.sourceRow;
    if (sourceRows.has(sourceRow)) return "同一Ahrefs原始证据行不可复用给不同季度词";
    sourceRows.add(sourceRow);
    if (row.kind === "blog" ? !["flatkey.ai", "modelfit.cc"].includes(target.site) : !["rackrate.org", "modelfit.cc"].includes(target.site)) return "制作类型超出原站点权限";
    const country = row.ahrefs.country;
    const group = otherMarkets.has(country) ? "other" : country as Exclude<keyof typeof shares, "other">;
    shares[group]++;
    const key = JSON.stringify([target.site, target.topicId, target.country, row.kind, row.researchDate, row.deliveryDate]);
    const intent = intents.get(row.intentId) ?? { key, primaries: 0, slot: { site: target.site, kind: row.kind, deliveryDate: row.deliveryDate } };
    if (intent.key !== key) return "同意图工作包须使用同站、同话题、同市场、同制作类型和同一研究及交付日";
    intent.primaries += Number(row.primary);
    intents.set(row.intentId, intent);
  }
  if (Object.values(shares).some(total => total !== QUARTER_NEW_WORD_COUNT / 5)) return "季度新词须按美国、日本、西班牙、新加坡及其他已授权市场各200词";
  if ([...intents.values()].some(intent => intent.primaries !== 1)) return "每个制作意图簇须确定唯一主词";

  const dates = new Set([...intents.values()].map(intent => intent.slot.deliveryDate));
  const blogs = new Map<string, number>();
  const landings = new Map<string, number>();
  const add = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const slot of [...commitments, ...[...intents.values()].map(intent => intent.slot)]) {
    if (slot.kind === "blog") add(blogs, slot.site + ":" + slot.deliveryDate);
    else add(landings, workWeekDateRange(slot.deliveryDate).start);
  }
  for (const date of dates) {
    if ((blogs.get("flatkey.ai:" + date) ?? 0) > 5 || (blogs.get("modelfit.cc:" + date) ?? 0) > 1) return "季度日历扣除既有任务后超出源文日产能";
    const week = workWeekDateRange(date).start;
    const workdays = Array.from({ length: 7 }, (_, index) => shiftDay(week, index)).filter(isWorkday).length;
    if ((landings.get(week) ?? 0) > workdays + Math.min(2, workdays)) return "季度日历扣除既有任务后超出两站新落地页周产能";
  }
  return null;
}

export function quarterCalendarDatesValid(calendar: CalendarRow[], start: string, end: string) {
  return calendar.every(row => row.researchDate >= start && row.researchDate <= row.deliveryDate && row.deliveryDate <= end
    && isWorkday(row.researchDate) && isWorkday(row.deliveryDate));
}
