import { z } from "zod";

export const collectionControlSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspectDiscovery"), requestId: z.string().regex(/^discovery-\d{4}-\d{2}-\d{2}-(flatkey-ai|modelfit-cc|rackrate-org)-(US|JP|ES|BR)$/) }).strict(),
  z.object({ action: z.literal("replayDiscovery"), requestId: z.string().regex(/^discovery-\d{4}-\d{2}-\d{2}-(flatkey-ai|modelfit-cc|rackrate-org)-(US|JP|ES|BR)$/) }).strict(),
  z.object({ action: z.literal("previewSchedule") }).strict(),
  z.object({ action: z.literal("pauseSchedule") }).strict(),
  z.object({ action: z.literal("enableSchedule"), previewToken: z.string().min(20).max(5000) }).strict(),
  z.object({ action: z.literal("runCycle"), previewToken: z.string().min(20).max(5000) }).strict(),
]);
export type CollectionControlMutation = z.infer<typeof collectionControlSchema>;
export type CollectionSchedulePreview = {
  action: "previewSchedule"; periodKey: string; periodLabel: string; dueAt: string;
  keywordCount: number; queryCount: number; discoveryJobs: number;
  serpMaxCostMicros: number; discoveryMaxCostMicros: number; totalMaxCostMicros: number;
  maxMonthSerpCostMicros: number; balanceMicros: number; checkedAt: string; previewToken: string;
};
export type CollectionCycleProgress = { action: "runCycle"; phase: "DISCOVERY" | "SERP" | "COMPLETE"; finished: boolean; message: string; runId?: string; remainingQueries?: number };
