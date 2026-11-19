import { createHash } from "node:crypto";
import { z } from "zod";
import { analyticsObservationSchema, analyticsStorageKind } from "./seo-analytics";
import { clusterDomainForProperty } from "./seo-cluster-sites";
export function analyticsHash(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
const common = { requestId: z.string().regex(/^analytics-correction:[a-zA-Z0-9:_-]{8,160}$/), reason: z.string().min(10).max(1000), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/) };
export const analyticsCorrectionSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("create_missing_ga4"), observation: analyticsObservationSchema }).strict(),
  z.object({ ...common, action: z.literal("revise_gsc_quality"), kind: z.string().regex(/^gsc-pages(?::(?:US|JP|ES|BR))?(?::(?:rackrate\.org|modelfit\.cc))?$/), date: z.iso.date(), expectedObservedAt: z.iso.datetime(), expectedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export class AnalyticsCorrectionConflict extends Error {}
export function prepareAnalyticsCorrection(input: unknown, saved: { payload: unknown; observedAt: Date; complete: boolean } | null) {
  const command = analyticsCorrectionSchema.parse(input);
  if (command.action === "create_missing_ga4") {
    const row = command.observation;
    if (row.kind !== "ga4-site" || !["558899190", "558978062"].includes(row.property) || row.source !== "google-api"
        || row.sessions !== 0 || row.registrations !== null || row.complete || row.country) throw new Error("Invalid zero backfill scope");
    if (saved) throw new AnalyticsCorrectionConflict("archive_already_exists");
    return { kind: analyticsStorageKind(row.kind, row.country, clusterDomainForProperty(row.property)), date: row.date, payload: row, observedAt: new Date(row.observedAt), complete: false };
  }
  if (!saved || saved.observedAt.toISOString() !== new Date(command.expectedObservedAt).toISOString() || analyticsHash(saved.payload) !== command.expectedPayloadHash)
    throw new AnalyticsCorrectionConflict("archive_changed");
  const raw = saved.payload as Record<string, unknown>;
  const before = analyticsObservationSchema.parse({ ...raw, complete: false });
  if (before.kind !== "gsc-pages" || !saved.complete || raw.complete !== true) throw new AnalyticsCorrectionConflict("quality_not_complete");
  // Only the quality flag changes. Original values, source and collection time survive.
  return { kind: command.kind, date: command.date, payload: { ...raw, complete: false }, observedAt: saved.observedAt, complete: false };
}

export function assertAnalyticsImportQuality(row: { kind: string; source: string; complete: boolean }) {
  if (row.kind === "gsc-pages" && row.source === "browser-export" && row.complete) throw new Error("browser_page_completeness_unverified");
}
