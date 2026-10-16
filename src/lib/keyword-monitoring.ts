import { validSitePage } from "./keyword-volume-review";
import type { PageAuditVerdict } from "./page-audit";

export type MonitoringTarget = { siteDomain: string; pool?: string; mappingStatus?: string; targetUrls?: string[]; latestPageAuditVerdict?: PageAuditVerdict | null };

export function readPageAuditVerdict(snapshot: unknown): PageAuditVerdict {
  const verdict = snapshot && typeof snapshot === "object" && "verdict" in snapshot ? snapshot.verdict : null;
  return verdict === "VERIFIED" || verdict === "MISSING" || verdict === "MISMATCH" || verdict === "REVIEW" ? verdict : "REVIEW";
}

// A planned URL does not prove that the page exists or matches this query.
// Candidates remain in the inventory while only verified pages are monitored.
export function canMonitorKeyword(target: MonitoringTarget) {
  if (target.latestPageAuditVerdict && target.latestPageAuditVerdict !== "VERIFIED") return false;
  const hasPage = (target.targetUrls ?? []).some(url => validSitePage(url, target.siteDomain));
  return hasPage && (target.siteDomain !== "flatkey.ai" || (target.pool === "FORMAL" && target.mappingStatus === "READY"));
}
