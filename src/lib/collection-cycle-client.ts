import type { CollectionControlMutation, CollectionCycleProgress, CollectionSchedulePreview } from "./collection-control";

export type CollectionBudget = { maxRunCostMicros: number; maxMonthCostMicros: number; discoveryMaxCostMicros: number };
export function collectionFitsExistingBudget(quote: CollectionSchedulePreview, budget: CollectionBudget) {
  return [quote.serpMaxCostMicros, quote.maxMonthSerpCostMicros, quote.discoveryMaxCostMicros, budget.maxRunCostMicros, budget.maxMonthCostMicros, budget.discoveryMaxCostMicros]
    .every(value => Number.isSafeInteger(value) && value > 0)
    && quote.serpMaxCostMicros <= budget.maxRunCostMicros && quote.maxMonthSerpCostMicros <= budget.maxMonthCostMicros
    && quote.discoveryMaxCostMicros <= budget.discoveryMaxCostMicros;
}

/** One enable and serial continuation of its signed period. Errors are never retried. */
export async function continueCollectionCycle(options: {
  quote: CollectionSchedulePreview; budget: CollectionBudget;
  post: (command: CollectionControlMutation) => Promise<unknown>;
  stopped: () => boolean; progress: (value: CollectionCycleProgress) => void; wait: () => Promise<void>;
}) {
  const { quote, budget, post, stopped, progress, wait } = options;
  if (!collectionFitsExistingBudget(quote, budget)) throw new Error("本轮费用超过原计划上限，请先核对预算；未开启或提交查询。");
  if (stopped()) return;
  const enabled = await post({ action: "enableSchedule", previewToken: quote.previewToken }) as { action?: string; enabled?: boolean };
  if (enabled.action !== "enableSchedule" || enabled.enabled !== true) throw new Error("开启回执未确认，请核对原计划，未开始本期续跑。");
  while (!stopped()) {
    const value = await post({ action: "runCycle", previewToken: quote.previewToken }) as CollectionCycleProgress;
    if (value.action !== "runCycle" || typeof value.finished !== "boolean") throw new Error("本期回执不完整，请核对原账本，勿重复提交。");
    progress(value);
    if (value.finished) return;
    await wait();
  }
}
