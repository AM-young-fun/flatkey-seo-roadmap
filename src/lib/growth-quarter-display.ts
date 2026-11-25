import { hasQuarterDelivery, QUARTER_NEW_WORD_VERSION } from "./growth-quarter-calendar";
import type { GrowthStrategy } from "./growth-strategy";
import type { GrowthTarget } from "./growth-types";

export function quarterCalendarDisplay(state: GrowthStrategy, targets: GrowthTarget[]) {
  const review = state.quarterPlanning;
  if (review?.plan.version !== QUARTER_NEW_WORD_VERSION || !review.plan.calendar) return null;
  const byId = new Map(targets.map(target => [target.id, target]));
  const rows = review.plan.calendar.map(row => {
    const target = byId.get(row.targetId);
    return {
      id: row.targetId, keyword: row.ahrefs.keyword, country: row.ahrefs.country, volume: row.ahrefs.volume,
      site: target?.site ?? null, topicId: target?.topicId ?? null, topicName: target?.topicName ?? null,
      researchDate: row.researchDate, deliveryDate: hasQuarterDelivery(row) ? row.deliveryDate : null,
    };
  });
  return { rows, total: review.plan.targetIds.length, start: review.plan.executionStart, end: review.plan.executionEnd,
    frozen: state.baseline?.planHash === review.hash, deliveryPending: rows.filter(row => !row.deliveryDate).length,
    days: [...new Set(rows.map(row => row.researchDate))].sort() };
}

export type QuarterCalendarDisplay = NonNullable<ReturnType<typeof quarterCalendarDisplay>>;
