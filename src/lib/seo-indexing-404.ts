import type { WorkflowRun } from "./seo-workflow";

export const indexing404RunPrefix = "gsc-indexing:flatkey.ai:all-known:";
export const indexing404Stage = "GSC_INDEXING_DAILY";
const metricLabel = "未找到 (404)：";
const decisionLabel = "404 处置：";
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 86_400_000;
export const indexing404HistoryLimit = 30;

export function isIndexing404Day(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);
  return isoDay.test(day) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

export function indexing404History(runs: readonly WorkflowRun[], throughDate?: string) {
  return runs.flatMap(run => {
    const collectedDate = run.id.slice(indexing404RunPrefix.length);
    if (run.stage !== indexing404Stage || !run.id.startsWith(indexing404RunPrefix) || !isIndexing404Day(collectedDate)
      || throughDate && collectedDate > throughDate) return [];
    const metric = run.evidence.find(item => item.label.startsWith(metricLabel));
    const fields = metric?.label.slice(metricLabel.length).split("；") ?? [];
    const parseCount = (value: string | undefined) => {
      const plain = value?.replaceAll(",", "");
      if (!plain || !/^[+-]?\d+$/.test(plain)) return null;
      const number = Number(plain);
      return Number.isSafeInteger(number) ? number : null;
    };
    const total = parseCount(fields[0]);
    return [{
      collectedDate,
      reportDate: run.sourceDates.gsc_report ?? null,
      observedAt: metric?.observedAt ?? run.startedAt,
      total: total !== null && total >= 0 ? total : null,
      change: parseCount(fields.find(value => value.startsWith("较上次："))?.slice("较上次：".length)),
      validation: fields.find(value => value.startsWith("验证："))?.slice("验证：".length) ?? null,
      decision: run.evidence.find(item => item.label.startsWith(decisionLabel))?.label.slice(decisionLabel.length) ?? null,
    }];
  }).sort((a, b) => b.collectedDate.localeCompare(a.collectedDate)).slice(0, indexing404HistoryLimit);
}

export type Indexing404Response = {
  observations: ReturnType<typeof indexing404History>;
  storage: "database" | "local_preview";
};

export function indexing404Trend(observations: Indexing404Response["observations"], throughDate?: string) {
  const end = throughDate ?? observations[0]?.collectedDate;
  if (!end || !isIndexing404Day(end)) return [];
  const counts = new Map(observations.map(row => [row.collectedDate, row.total]));
  const endTime = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: indexing404HistoryLimit }, (_, index) => {
    const label = new Date(endTime - (indexing404HistoryLimit - 1 - index) * dayMs).toISOString().slice(0, 10);
    return { label, value: counts.get(label) ?? null };
  });
}
