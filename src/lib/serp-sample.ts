import { createHash } from "node:crypto";
import { z } from "zod";
import { groupSerpQueries, quoteSerpTargets, SERP_MARKETS, SERP_PRICE_PER_QUERY_MICROS } from "@/lib/dataforseo-serp";
import type { SerpMonitorRunDto, SerpQuote } from "@/lib/serp-monitor-types";
import { serpTargetKey, type SerpTarget } from "@/lib/serp-targets";

// This names the single trial authorized by the user. A fresh preview, request
// ID, deployment, or process cannot create a second spending authorization.
export const SERP_SAMPLE_AUTHORIZATION_ID = "SERP_BRAND_MODEL_PRICE_2026_10_16_FOUR_MARKETS_V1";
export const SERP_SAMPLE_AUTHORIZATION_HASH = createHash("sha256").update(SERP_SAMPLE_AUTHORIZATION_ID).digest("hex");
export const SERP_SAMPLE_MAX_QUERIES = 200;
export const SERP_SAMPLE_MAX_COST_MICROS = 950_000;
export const SERP_SAMPLE_MAX_BUDGET_MICROS = SERP_SAMPLE_MAX_COST_MICROS;
export const SERP_SAMPLE_SAFETY_MARGIN_MICROS = 20_000;
export const SERP_SAMPLE_PREVIEW_TTL_MS = 10 * 60_000;
export const SERP_USER_DATA_URL = "https://api.dataforseo.com/v3/appendix/user_data";

export type SerpSampleCategory = "BRAND" | "MODEL_PRICE";
export type SerpSampleSelection = { targets: SerpTarget[]; categories: Record<string, SerpSampleCategory> };
export type SerpSamplePreview = {
  action: "previewSample"; scope: "SAMPLE"; authorizationId: string;
  subsetHash: string; targets: Array<SerpTarget & { category: SerpSampleCategory }>;
  quote: SerpQuote; liveBalanceMicros: number; maxBudgetMicros: number;
  safetyMarginMicros: number; balanceCheckedAt: string; expiresAt: string;
  authorizationToken: string; scheduledPaidEnabled: false;
  existingRun: SerpMonitorRunDto | null;
};
export type SerpSampleStartResult = {
  action: "startSample"; scope: "SAMPLE"; duplicate: boolean;
  run: SerpMonitorRunDto; scheduledPaidEnabled: false;
};
export type SerpSampleResult = SerpSampleStartResult;

export const serpSampleMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sampleBalance") }).strict(),
  z.object({ action: z.literal("previewSample") }).strict(),
  z.object({ action: z.literal("startSample"), idempotencyKey: z.string().regex(/^[a-zA-Z0-9-]{8,100}$/),
    expectedSubsetHash: z.string().regex(/^[a-f0-9]{64}$/), authorizationToken: z.string().min(30).max(6000),
    maxBudgetMicros: z.number().int().min(SERP_PRICE_PER_QUERY_MICROS).max(SERP_SAMPLE_MAX_COST_MICROS) }).strict(),
]);
export type SerpSampleMutation = z.infer<typeof serpSampleMutationSchema>;

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Only expose the balance from this free endpoint, never account usage/login. */
export function parseSerpSampleBalance(raw: unknown): number {
  const root = record(raw), tasks = Array.isArray(root.tasks) ? root.tasks.map(record) : [];
  if (root.status_code !== 20000 || root.cost !== 0 || tasks.length !== 1 || tasks[0].status_code !== 20000 || tasks[0].cost !== 0) throw new Error("BALANCE_NOT_VERIFIED");
  const results = Array.isArray(tasks[0].result) ? tasks[0].result.map(record) : [];
  const balance = record(results[0]?.money).balance;
  if (results.length !== 1 || typeof balance !== "number" || !Number.isFinite(balance) || balance < 0 || balance > 1_000_000) throw new Error("BALANCE_NOT_VERIFIED");
  // Round down: a fractional micro-dollar cannot authorize additional spend.
  return Math.floor((balance + Number.EPSILON) * 1_000_000);
}

export function serpSampleSubsetHash(selection: SerpSampleSelection): string {
  const snapshot = selection.targets.map(target => ({ ...target, targetUrls: [...new Set(target.targetUrls)].sort(),
    category: selection.categories[serpTargetKey(target)] })).sort((a, b) => serpTargetKey(a).localeCompare(serpTargetKey(b)));
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/** Keep the existing selection order (brand first) when the balance is small. */
export function affordableSerpSample(selection: SerpSampleSelection, liveBalanceMicros: number): SerpSampleSelection {
  if (!Number.isSafeInteger(liveBalanceMicros) || liveBalanceMicros < 0) throw new Error("BALANCE_NOT_VERIFIED");
  const budget = Math.max(0, Math.min(SERP_SAMPLE_MAX_COST_MICROS, liveBalanceMicros - SERP_SAMPLE_SAFETY_MARGIN_MICROS));
  const groups = groupSerpQueries(selection.targets), selected: SerpTarget[] = [], categories: Record<string, SerpSampleCategory> = {};
  const order = new Map(selection.targets.map((target, index) => [serpTargetKey(target), index]));
  groups.sort((a, b) => Math.min(...a.targets.map(target => order.get(serpTargetKey(target)) ?? Infinity)) - Math.min(...b.targets.map(target => order.get(serpTargetKey(target)) ?? Infinity)));
  let count = 0;
  for (const group of groups) {
    if ((count + 1) * SERP_MARKETS.length > SERP_SAMPLE_MAX_QUERIES) break;
    if (quoteSerpTargets([...selected, ...group.targets], SERP_MARKETS).maxCostMicros > budget) break;
    if (group.targets.some(target => !["BRAND", "MODEL_PRICE"].includes(selection.categories[serpTargetKey(target)]))) throw new Error("SAMPLE_CATEGORY_REQUIRED");
    selected.push(...group.targets); count++;
    for (const target of group.targets) categories[serpTargetKey(target)] = selection.categories[serpTargetKey(target)];
  }
  return { targets: selected, categories };
}
