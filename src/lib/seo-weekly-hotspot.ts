import { activeHotspotPriority } from "../../scripts/lib/seo-hotspot-priority.cjs";
import { seoToday, shiftDay, workWeekDateRange } from "./seo-date-range";
import { isSeoWorkday } from "./seo-workday";
import type { WorkflowTask } from "./seo-workflow";

const marker = /^seo-weekly-hotspot-v1;outcome=new-topic;batch=(\d{4}-\d{2}-\d{2})$/u;
const key = (value: string | null) => (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

export function weeklyDerivedHotspot(task: WorkflowTask, now = new Date()) {
  if (task.source !== "automation" || !task.id.startsWith("seo-hotspot:")) return null;
  const priority = activeHotspotPriority(task, now);
  if (!priority) return null;
  return task.evidence.some(row => {
    const batch = marker.exec(row.label)?.[1], observed = Date.parse(row.observedAt);
    if (!batch || !Number.isFinite(observed) || observed > now.getTime() || observed < Date.parse(priority.at)
      || seoToday(new Date(observed)) !== batch) return false;
    const weekday = new Date(batch + "T00:00:00Z").getUTCDay();
    const monday = shiftDay(batch, weekday === 0 ? -6 : 1 - weekday);
    return isSeoWorkday(new Date(batch + "T12:00:00+08:00")) && !Array.from(
      { length: weekday === 0 ? 6 : weekday - 1 }, (_, index) => shiftDay(monday, index),
    ).some(day => isSeoWorkday(new Date(day + "T12:00:00+08:00")));
  }) ? priority : null;
}

export function linkedWeeklyHotspot(task: WorkflowTask, tasks: readonly WorkflowTask[], asOf = new Date()) {
  if (task.capacityClass !== "authorized_hotspot_extra" || task.kind !== "blog" || task.directionId || task.experimentId
    || !task.country || !task.language || task.language === "ru" || !task.keywordId || !task.topicId || !task.sourceRowId) return null;
  const own = weeklyDerivedHotspot(task, asOf);
  if (!own) return null;
  const research = tasks.find(row => row.id === task.sourceRowId && !row.deletedAt && row.kind === "research"
    && ["verified", "observing"].includes(row.status) && task.dependencies.includes(row.id)
    && row.siteDomain === task.siteDomain && row.topicId === task.topicId && row.keywordId === task.keywordId
    && row.country === task.country && row.language === task.language && key(row.keyword) === key(task.keyword));
  if (!research) return null;
  const original = weeklyDerivedHotspot(research, asOf);
  if (original?.eventKey !== own.eventKey || original.at !== own.at) return null;
  const review = research.researchReview;
  if (!review || review.keyword !== task.keyword || review.country !== task.country || review.language !== task.language
    || Date.parse(review.reviewedAt) < Date.parse(own.at) || Date.parse(review.duplicateCheckedAt) < Date.parse(own.at)
    || Date.parse(review.reviewedAt) > asOf.getTime() || Date.parse(review.duplicateCheckedAt) > asOf.getTime()) return null;
  return own;
}

export function weeklyHotspotAdmissionProblem(task: WorkflowTask, tasks: readonly WorkflowTask[], now: Date) {
  const priority = linkedWeeklyHotspot(task, tasks, now);
  if (!priority || task.status !== "ready") return "自动热点任务须来自本周热点抓取的新话题，且原词研究完成并关联原研究任务";
  const due = new Date(task.dueAt), day = seoToday(due), period = workWeekDateRange(seoToday(now));
  if (due < now || due.getTime() > Date.parse(priority.expiresAt) || day < period.start || day > period.end || !isSeoWorkday(due)) {
    return "自动热点须在当周工作时段安排，交付不得晚于事件后 7 天";
  }
  if (tasks.some(row => !row.deletedAt && row.id !== task.id && ["blog", "landing", "cluster", "optimization"].includes(row.kind)
    && row.siteDomain === task.siteDomain && row.country === task.country && row.language === task.language
    && (key(row.keyword) === key(task.keyword) || Boolean(task.pageUrl && task.pageUrl === row.pageUrl)))) return "同页或同原词已有内容任务，须沿原任务处理";
  return null;
}
