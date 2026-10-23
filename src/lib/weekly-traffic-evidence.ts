import archive from "./data/weekly-traffic-evidence.json";
import type { WeeklyPageVisitors } from "./weekly-page-visitors";
import type { WeeklyReportingCutoff } from "./weekly-cutoff";

export type WeeklyTrafficEvidence = {
  complete: boolean;
  pageTrends?: import("./page-traffic-history").PageTrafficHistory;
  reportingCutoff?: WeeklyReportingCutoff;
  pageVisitors?: WeeklyPageVisitors;
  totals: { current: { newUsers: number; newRegistrations: number }; previous: { newUsers: number; newRegistrations: number } };
  channels: { name: string; newUsers: { current: number; previous: number }; registrations: { current: number; previous: number } }[];
  sources: string[];
  codexSummary?: {preparedAt:string;text?:string;findings:{title:string;evidence:string;action:string;level:"issue"|"finding"|"unresolved"}[]};
  formFunnel?: { current: { name: string; users: number; completionRate: number | null }[]; previous: { name: string; users: number; completionRate: number | null }[] };
  newVisitorFunnel?: WeeklyTrafficEvidence["formFunnel"];
  directRegistrationCountries?: Record<string, { current: number; previous: number }>;
  search?: { clicks: { current: number; previous: number }; impressions: { current: number; previous: number };
    decliningPages: { url: string; clicks: { current: number; previous: number }; position: { current: number | null; previous: number | null } }[] };
};

// Audited browser exports are a dated supplement, never a replacement for a
// newer finalized import. No supplier requests occur when reading this file.
export function weeklyTrafficEvidence(start: string) {
  const data = (archive.weeks as Record<string, WeeklyTrafficEvidence>)[start];
  return data ? { ...data, siteDomain: archive.siteDomain, timezone: archive.timezone, propertyId: archive.propertyId, collectedAt: archive.collectedAt } : null;
}
