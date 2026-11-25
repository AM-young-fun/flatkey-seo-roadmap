import { hasQuarterDelivery, QUARTER_NEW_WORD_VERSION } from "./growth-quarter-calendar";
import type { GrowthStrategy } from "./growth-strategy";
import { seoToday } from "./seo-date-range";
import type { WorkflowTask } from "./seo-workflow";
import type { GrowthTarget } from "./growth-types";

export type QuarterDeliveryTask = Pick<WorkflowTask, "siteDomain" | "topicId" | "keywordId" | "keyword" | "country" | "language" | "dueAt">;
const identityKey = (site: string, topic: string | undefined | null, id: string | null, keyword: string | null, country: string | null, language: string | null) =>
  JSON.stringify([site, topic ?? null, id, keyword?.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase() ?? null, country, language]);

export function quarterCalendarDisplay(state: GrowthStrategy, targets: GrowthTarget[], committedTasks: QuarterDeliveryTask[] = []) {
  const review = state.quarterPlanning;
  if (review?.plan.version !== QUARTER_NEW_WORD_VERSION || !review.plan.calendar) return null;
  const byId = new Map(targets.map(target => [target.id, target]));
  const committed = new Map<string, string>();
  for (const task of committedTasks) {
    const key = identityKey(task.siteDomain, task.topicId, task.keywordId, task.keyword, task.country, task.language);
    const day = seoToday(new Date(task.dueAt));
    if (!committed.has(key) || day < committed.get(key)!) committed.set(key, day);
  }
  const rows = review.plan.calendar.map(row => {
    const target = byId.get(row.targetId);
    const actualDate = target ? committed.get(identityKey(target.site, target.topicId, target.keywordId, target.keyword, target.country, target.language)) : undefined;
    return {
      id: row.targetId, keyword: row.ahrefs.keyword, country: row.ahrefs.country, volume: row.ahrefs.volume,
      site: target?.site ?? null, topicId: target?.topicId ?? null, topicName: target?.topicName ?? null,
      researchDate: row.researchDate, deliveryDate: actualDate ?? (hasQuarterDelivery(row) ? row.deliveryDate : null),
    };
  });
  return { rows, total: review.plan.targetIds.length, start: review.plan.executionStart, end: review.plan.executionEnd,
    frozen: state.baseline?.planHash === review.hash, deliveryPending: rows.filter(row => !row.deliveryDate).length,
    days: [...new Set(rows.map(row => row.researchDate))].sort() };
}

export type QuarterCalendarDisplay = NonNullable<ReturnType<typeof quarterCalendarDisplay>>;
