import { growthWebsitePageUrl } from "./growth-live-page";
import { growthWordKey } from "./growth-workspace";
import { isExecutableWorkflowPlan, type WorkflowHistoricalImport, type WorkflowPlan, type WorkflowPublication, type WorkflowTask } from "./seo-workflow";
import type { WorkflowStoredRow } from "./seo-workflow-state";

const execution = new Set(["ready", "drafting", "review_pending", "approved", "published", "verified", "observing"]);
const isPageMaintenance = (task: WorkflowTask) => task.kind === "optimization" && task.workClass !== "internal_linking" && !task.deletedAt;
const identity = ["siteDomain", "keywordId", "keyword", "country", "language", "topicId", "pageUrl", "dueAt", "workClass"] as const;

export function publishedMaintenanceMutationTasks(kind: string, record: { id: string }, all: WorkflowStoredRow[]) {
  if (kind !== "task" && kind !== "plan") return [];
  const taskIndex = new Map(all.flatMap(row => row.kind === "task" ? [[row.record.id, row.record as WorkflowTask] as const] : []));
  const plan = kind === "plan" ? record as WorkflowPlan : null;
  const tasks = plan
    ? isExecutableWorkflowPlan(plan.status) ? plan.taskIds.flatMap(id => taskIndex.get(id) ?? []) : []
    : execution.has((record as WorkflowTask).status) ? [record as WorkflowTask] : [];
  const committed = new Set(all.flatMap(row => {
    if (row.kind !== "plan") return [];
    const saved = row.record as WorkflowPlan;
    return [...(saved.committedTaskIds ?? []), ...(isExecutableWorkflowPlan(saved.status) ? saved.taskIds : [])];
  }));
  return tasks.filter(isPageMaintenance).filter(task => {
    const original = taskIndex.get(task.id);
    return !original || identity.some(key => task[key] !== original[key])
      || !committed.has(task.id) && !["published", "verified", "observing"].includes(original.status);
  });
}

export function hasMaintenanceIntentReview(task: WorkflowTask) {
  const review = task.researchReview;
  return task.workflowContract === "growth-v1.5" && Boolean(
    task.research?.intent.trim() && review?.quality.intent.trim() && review.evidence.length
    && review.country === task.country && review.language === task.language && review.keyword === task.keyword
    && new Set(review.serpResults).size === 10 && review.serpResults.slice(0, 5).every(url => review.openedResults.includes(url))
    && review.openedResults.every(url => review.serpResults.includes(url)),
  );
}

export type MaintenanceMember = {
  siteDomain: string; keywordId: string; keyword: string; active: boolean; targetUrls: string[];
  markets: { country: string; language: string }[];
};

export function hasPublishedMaintenanceSource(task: WorkflowTask, member: MaintenanceMember | undefined, inventory: ReadonlySet<string>,
  records: WorkflowStoredRow[], now: Date) {
  if (!member?.active || !task.keywordId || !task.keyword || !task.country || !task.language || !task.topicId || !task.pageUrl
    || member.siteDomain !== task.siteDomain || member.keywordId !== task.keywordId || growthWordKey(member.keyword) !== growthWordKey(task.keyword)) return false;
  const page = growthWebsitePageUrl(task.pageUrl, task.siteDomain);
  if (!page || member.markets.length && !member.markets.some(market => market.country === task.country && market.language === task.language)) return false;
  const samePage = (url: string) => growthWebsitePageUrl(url, task.siteDomain) === page;
  const mapped = member.targetUrls.some(samePage);
  if (mapped && member.markets.length && inventory.has(page)) return true;

  const originals = new Map(records.flatMap(row => row.kind === "task" ? [[row.record.id, row.record as WorkflowTask] as const] : []));
  const matchesScope = (publication: { pageUrl: string; publishedAt: string; country: string | null; language: string | null; keyword: string | null }) => {
    const at = Date.parse(publication.publishedAt);
    return publication.country === task.country && publication.language === task.language && samePage(publication.pageUrl)
      && Number.isFinite(at) && at <= now.getTime()
      && (mapped || Boolean(publication.keyword && growthWordKey(publication.keyword) === growthWordKey(member.keyword)));
  };
  return records.some(row => {
    if (row.kind === "historical_import") {
      const archive = row.record as WorkflowHistoricalImport;
      return archive.siteDomain === task.siteDomain && archive.publications.some(publication => publication.verificationState === "live_verified" && matchesScope(publication));
    }
    if (row.kind !== "publication") return false;
    const publication = row.record as WorkflowPublication;
    const original = originals.get(publication.taskId);
    return publication.siteDomain === task.siteDomain && publication.taskId !== task.id
      && (!original || original.siteDomain === task.siteDomain && original.channel !== "product" && original.channel !== "github")
      && (mapped || original?.keywordId === task.keywordId)
      && ["published", "verified"].includes(publication.status) && matchesScope(publication);
  });
}
