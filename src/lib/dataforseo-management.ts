import { z } from "zod";
import type { DataForSeoQuote } from "./dataforseo-labs.cjs";

export const DATAFORSEO_API_PATH = "/api/dataforseo";
export const DATAFORSEO_TRIAL_BUDGET_MICROS = 1000000;
const requestId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const dataForSeoMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), apiLogin: z.string().trim().min(1).max(256).refine(value => !value.includes(":")), apiPassword: z.string().min(1).max(512).refine(value => Boolean(value.trim())) }).strict(),
  z.object({ action: z.literal("disconnect") }).strict(),
  z.object({ action: z.literal("preview"), requestId }).strict(),
  z.object({ action: z.literal("update"), requestId, previewToken: z.string().min(1).max(4000) }).strict(),
  z.object({ action: z.literal("replay"), requestId }).strict(),
]);
export type DataForSeoMutation = z.infer<typeof dataForSeoMutationSchema>;
export type DataForSeoRunStatus = "PENDING" | "UNKNOWN" | "FAILED" | "RECEIVED" | "IMPORT_FAILED" | "COMPLETED";
export type DataForSeoSummary = { returnedItems: number; normalizedRows: number; matchedExisting: number; matchedPages?: number; unknownCandidates: number; unrelatedFiltered: number;
  missingFormal: number; missingResearch?: number; importedObservations: number; truncated: boolean; totalMatchingCount: number };
export type DataForSeoRunDto = { requestId: string; status: DataForSeoRunStatus; startedAt: string; completedAt: string | null;
  errorCode: string | null; actualCostMicros: number | null; budgetCostMicros: number; summary: DataForSeoSummary | null };
export type DataForSeoTrialBudget = { limitMicros: number; usedMicros: number; remainingMicros: number };
export type DataForSeoStatus = { connection: { configured: boolean; loginMasked: string | null; canDecrypt: boolean; scheduleEnabled: false };
  quote: DataForSeoQuote; trialBudget: DataForSeoTrialBudget; runs: DataForSeoRunDto[] };
export type DataForSeoPreview = { action: "preview"; requestId: string; previewToken: string; expiresAt: string; quote: DataForSeoQuote; trialBudget: DataForSeoTrialBudget };
export type DataForSeoRunResult = { action: "update" | "replay"; requestId: string; status: DataForSeoRunStatus; duplicate: boolean; run: DataForSeoRunDto };
export type DataForSeoMutationResult = DataForSeoStatus | DataForSeoPreview | DataForSeoRunResult;
