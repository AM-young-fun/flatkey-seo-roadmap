import type { SerpTarget } from "./serp-targets";

/** Fixed original saved ledgers. This list never authorizes a new capture. */
export const HISTORICAL_EXPORT_RUNS = [
  { runId: "sample-111563ab-3ccd-48b8-9751-929786947c62", periodKey: "2026-10-2", scope: "SAMPLE", label: "2026年10月第1期" },
  { runId: "serp-cycle-2026-10-20", periodKey: "2026-10-20", scope: "SCHEDULED", label: "2026年10月第2期" },
  { runId: "serp-cycle-2026-11-03", periodKey: "2026-11-03", scope: "SCHEDULED", label: "2026年11月第1期" },
] as const;
export type HistoricalExportSelection = { run: typeof HISTORICAL_EXPORT_RUNS[number]; kind: "cohort" | "tasks"; offset: number; limit: number };
export function historicalExportSelection(params: URLSearchParams): HistoricalExportSelection {
  const run = HISTORICAL_EXPORT_RUNS.find(run => run.runId === params.get("runId")), kind = params.get("kind") ?? "tasks";
  const offset = Number(params.get("offset") ?? "0"), limit = Number(params.get("limit") ?? "100");
  const unexpected = [...params.keys()].some(key => !["runId", "kind", "offset", "limit"].includes(key));
  if (!run || !["cohort", "tasks"].includes(kind) || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000 ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || unexpected || kind === "cohort" && offset !== 0) throw new Error("INVALID_SAVED_HISTORY_EXPORT_SELECTION");
  return { run, kind: kind as "cohort" | "tasks", offset, limit };
}

/** Export the original target identity, never arbitrary saved JSON extensions. */
export function historicalExportTargets(value: unknown): SerpTarget[] {
  const targets: SerpTarget[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.keywordId !== "string" || typeof row.keyword !== "string" || typeof row.siteDomain !== "string" ||
      !["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(row.siteDomain)) continue;
    targets.push({ keywordId: row.keywordId, keyword: row.keyword, siteDomain: row.siteDomain,
      targetUrls: Array.isArray(row.targetUrls) ? row.targetUrls.filter((url): url is string => typeof url === "string") : [] });
  }
  return targets;
}
