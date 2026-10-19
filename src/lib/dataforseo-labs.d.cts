export const ENDPOINT: string;
export const DEFAULT_RUN_ID: string;
export class CollectorError extends Error { code: string; constructor(code: string, message: string); }
export function fail(code: string, message: string): never;
export type DataForSeoQuote = { currency: "USD"; baseCostMicros: number; perItemCostMicros: number; limit: number; maxCostMicros: number; maxCostUsd: string };
export type DataForSeoObservation = { source: "dataforseo_labs"; keyword: string; rawKeyword: string; region: "US" | "JP" | "ES" | "BR"; locationCode: number; languageCode: string;
  itemIndex: number; rank_group: number; rank_absolute: number | null; url: string; title: string | null; sourceSerpUpdatedAt: string | null;
  sourceSerpUpdatedAtRaw: string | null; sourceSerpDateField: string | null; volume: number | null; volumeUpdatedAt: string | null; checkUrl: string | null; collectedAt: string };
export type DataForSeoNormalized = { schemaVersion: 1; source: "dataforseo_labs"; datasetType: string; runId: string; targetDomain: string; region: "US" | "JP" | "ES" | "BR"; languageCode: string;
  collectedAt: string; historicalSerpMode: string; realTimeSerpFetch: false; taskId: string | null; estimatedMaxCostUsd: string;
  actualCostMicros: number | null; actualCostUsd: string | null; costWithinEstimate: boolean | null; requestedLimit: number; returnedItems: number;
  totalMatchingCount: number; truncated: boolean; additionalRequestsPerformed: number; uniqueKeywords: number; rows: DataForSeoObservation[]; rejectedItems: Array<{ itemIndex: number; reason: string }> };
export function quoteForLimit(limit: number): DataForSeoQuote;
export function parseCliArgs(argv: string[]): { execute: boolean; runId: string; limit: number; help?: boolean };
export function buildRankedKeywordsTask(limit: number, runId: string, scope?: { targetDomain: string; region: "US" | "JP" | "ES" | "BR" }): Record<string, unknown>;
export function normalizeRankedKeywords(raw: unknown, options: { runId: string; collectedAt: string; limit?: number; scope?: { targetDomain: string; region: "US" | "JP" | "ES" | "BR" } }): DataForSeoNormalized;
