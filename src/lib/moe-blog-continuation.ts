import { createHash } from "node:crypto";
import { isExecutableWorkflowPlan, type WorkflowPlan, type WorkflowTask } from "./seo-workflow";

const original = "seo-hotspot:123f57bf1543c1f34eb32dab39354a4bfa5807dd";
export const moeBlogTaskId = original + ":blog:flatkey-ai";
export const moeBlogResearchId = original + ":research";
export const moeBlogPlanId = "next-week-plan-20261130";
const runHash = createHash("sha256").update(moeBlogTaskId).digest("hex").slice(0, 24);
export const moeBlogRunId = "task-claim:" + runHash;
export const moeBlogRunStage = "TASK_" + runHash.toUpperCase();

const reservationStart = Date.parse("2026-11-27T10:15:00+08:00");
const reservationEnd = Date.parse("2026-11-27T12:15:00+08:00");
const originalDueAt = Date.parse("2026-11-24T11:30:00+08:00");
const keywordId = "3bc72ab5-7710-4c4b-b1b7-d27dbf34f590";
const keyword = "moe expert streaming";
const quarterHash = "a8f73a80ed763eb606b4876f1337c11a747481a86e1777a8cba68ea6781cbf03";

export function canClaimMoeBlogContinuation(
  task: WorkflowTask | undefined,
  research: WorkflowTask | undefined,
  plan: WorkflowPlan | undefined,
  now: Date,
): boolean {
  if (!(now.getTime() >= reservationStart && now.getTime() < reservationEnd)) return false;
  if (!task || task.id !== moeBlogTaskId || task.deletedAt || !["ready", "drafting"].includes(task.status)
    || task.weekStart !== "2026-11-23" || Date.parse(task.dueAt) !== originalDueAt || task.source !== "human"
    || task.kind !== "blog" || task.channel !== "website" || task.siteDomain !== "flatkey.ai"
    || task.country !== "US" || task.language !== "en" || task.keywordId !== keywordId || task.keyword !== keyword
    || task.pageUrl !== "https://flatkey.ai/blog/moe-expert-streaming"
    || task.dependencies.length !== 1 || task.dependencies[0] !== moeBlogResearchId) return false;
  // This article reused its original pre-existing US/en study. The Flatkey
  // content task carries its own review of that query and website coverage.
  if (!research || research.id !== moeBlogResearchId || research.deletedAt || research.kind !== "research"
    || research.siteDomain !== "modelfit.cc" || research.status !== "verified" || research.keywordId !== keywordId
    || research.keyword !== keyword || research.country !== task.country || research.language !== task.language) return false;
  const review = task.researchReview;
  if (!review || review.keyword !== keyword || review.country !== task.country || review.language !== task.language
    || !review.evidence.length || new Set(review.serpResults).size !== 10 || new Set(review.openedResults).size < 5
    || review.serpResults.slice(0, 5).some(url => !review.openedResults.includes(url))
    || !review.openedResults.every(url => review.serpResults.includes(url))) return false;

  const allocation = plan?.strategyAllocation;
  return Boolean(plan && plan.id === moeBlogPlanId && isExecutableWorkflowPlan(plan.status)
    && allocation?.quarterPlanHash === quarterHash && allocation.preservedTaskIds.includes(task.id)
    && plan.notes.includes("2026-11-27 10:15–12:15 续做 Flatkey US/en「moe expert streaming」"));
}
