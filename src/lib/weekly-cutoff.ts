export type WeeklyReportingCutoff = { kind: "TUESDAY_1010_SNAPSHOT" | "FRIDAY_1010_SNAPSHOT"; scheduledAt: string };

export function weeklySnapshotAt(periodEnd: string): string {
  const end = Date.parse(`${periodEnd}T00:00:00Z`);
  if (!Number.isFinite(end)) return "";
  const nextDay = new Date(end + 86400000).toISOString().slice(0, 10);
  return new Date(`${nextDay}T10:10:00+08:00`).toISOString();
}

export function reportingCutoff(analysis: unknown): WeeklyReportingCutoff | null {
  if (!analysis || typeof analysis !== "object" || !("reportingCutoff" in analysis)) return null;
  const cutoff = analysis.reportingCutoff;
  return cutoff && typeof cutoff === "object" && "kind" in cutoff && (cutoff.kind === "TUESDAY_1010_SNAPSHOT" || cutoff.kind === "FRIDAY_1010_SNAPSHOT") &&
    "scheduledAt" in cutoff && typeof cutoff.scheduledAt === "string" && Number.isFinite(Date.parse(cutoff.scheduledAt))
    ? { kind: cutoff.kind, scheduledAt: cutoff.scheduledAt } : null;
}

// Historical full-property weeks and Tuesday-morning snapshots have different
// cutoffs. They may be shown side by side but must not imply like-for-like growth.
export function comparableWeeklyCutoffs(currentAnalysis: unknown, previousAnalysis: unknown): boolean {
  const current = reportingCutoff(currentAnalysis), previous = reportingCutoff(previousAnalysis);
  return current || previous ? Boolean(current && previous && current.kind === previous.kind && Date.parse(current.scheduledAt) - Date.parse(previous.scheduledAt) === 7 * 86400000) : true;
}
