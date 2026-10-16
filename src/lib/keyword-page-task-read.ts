import type { KeywordContentTask } from "./keyword-okr";
import type { PageAuditDomain } from "./page-audit";

export type SitePageTask = KeywordContentTask & { siteDomain: PageAuditDomain };
export type KeywordPageTasksResponse = {
  kind: "keyword-page-tasks";
  tasks: SitePageTask[];
  sites: Array<{ siteDomain: PageAuditDomain; taskCount: number; pendingKeywords: number; assignedKeywords: number }>;
  summary: { taskCount: number; pendingKeywords: number; assignedKeywords: number };
};
