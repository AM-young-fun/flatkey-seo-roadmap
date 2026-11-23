import { z } from "zod";
import { weeklyReportRange } from "./seo-date-range";

export const weeklySupplementInput = z.object({
  reportId: z.string().regex(/^seo-digest:\d{4}-\d{2}-\d{2}:[a-f0-9]{16}$/),
  expectedRevision: z.number().int().min(0).max(999999),
  text: z.string().max(10000),
}).strict();
export type WeeklySupplement = {
  id: string; periodStart: string; periodEnd: string; revision: number; text: string; updatedAt: string | null;
};
export function emptyWeeklySupplement(date: string): WeeklySupplement {
  const period = weeklyReportRange(date);
  return { id: `weekly-supplement:${period.start}:${period.end}`, periodStart: period.start, periodEnd: period.end, revision: 0, text: "", updatedAt: null };
}
export function nextWeeklySupplement(current: WeeklySupplement, input: z.infer<typeof weeklySupplementInput>, now = new Date()): WeeklySupplement {
  if (input.expectedRevision !== current.revision) throw new Error("supplement_conflict");
  return { ...current, revision: current.revision + 1, text: input.text, updatedAt: now.toISOString() };
}
