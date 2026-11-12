export type SourceSyncStage = "preview_snapshot" | "transaction_acquire" | "write_lock" | "site_read" | "source_rows_read"
  | "keyword_read" | "membership_read" | "plan" | "keyword_write" | "membership_write" | "source_rows_write" | "transaction_commit";
type Diagnostic = { stage: SourceSyncStage; elapsedMs: number; stageElapsedMs: number; reason: string };
const diagnostics = new WeakMap<object, Diagnostic>();

function reason(error: object): string {
  const meta = "meta" in error && error.meta && typeof error.meta === "object" ? error.meta : null;
  const text = ["message" in error ? error.message : "", meta && "error" in meta ? meta.error : ""].filter(value => typeof value === "string").join(" ").toLowerCase();
  // Match only fixed labels. Never retain or print raw provider text, SQL,
  // supplied row data or credentials from an error message.
  if (/unable to start a transaction|timed out.*(?:acquir|start)|acquir.*timed out/.test(text)) return "TRANSACTION_ACQUIRE_TIMEOUT";
  if (/expired|transaction.*timeout|timeout.*transaction/.test(text)) return "TRANSACTION_EXPIRED";
  if (/transaction.*not found|transaction.*no longer valid/.test(text)) return "TRANSACTION_NOT_FOUND";
  if (/transaction.*closed/.test(text)) return "TRANSACTION_CLOSED";
  if (/lock timeout|could not obtain lock/.test(text)) return "LOCK_TIMEOUT";
  if (/source_preview_snapshot_invalid/.test(text)) return "SNAPSHOT_INVALID";
  return "UNCLASSIFIED";
}

export function sourceSyncFailure(error: unknown): Diagnostic | null {
  return error && typeof error === "object" ? diagnostics.get(error) ?? null : null;
}

export function sourceSyncTrace(initial: SourceSyncStage) {
  const started = performance.now();
  let stage = initial, phaseStarted = started;
  return {
    stage(next: SourceSyncStage) { stage = next; phaseStarted = performance.now(); },
    capture(error: unknown) {
      if (!error || typeof error !== "object") return;
      const now = performance.now();
      diagnostics.set(error, { stage, elapsedMs: Math.max(0, Math.round(now - started)), stageElapsedMs: Math.max(0, Math.round(now - phaseStarted)), reason: reason(error) });
    },
  };
}
