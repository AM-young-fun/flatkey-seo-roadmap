import type { WorkflowRun } from "./seo-workflow";

export const indexing404RunPrefix = "gsc-indexing:flatkey.ai:all-known:";
export const indexing404Stage = "GSC_INDEXING_DAILY";
const metricLabel = "未找到 (404)：";
const decisionLabel = "404 处置：";
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

export function indexing404History(runs: readonly WorkflowRun[]) {
  return runs.flatMap(run => {
    const collectedDate = run.id.slice(indexing404RunPrefix.length);
    if (run.stage !== indexing404Stage || !run.id.startsWith(indexing404RunPrefix) || !isoDay.test(collectedDate)) return [];
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
  }).sort((a, b) => b.collectedDate.localeCompare(a.collectedDate)).slice(0, 30);
}

export type Indexing404Response = {
  observations: ReturnType<typeof indexing404History>;
  storage: "database" | "local_preview";
};
