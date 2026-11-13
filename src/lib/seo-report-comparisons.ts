export type ReportMetric = {
  label: string;
  previous: number | null;
  current: number | null;
  delta: string;
  period: string;
  note: string;
};

export function parseReportComparisons(lines: string[]) {
  const groups: { name: string; metrics: ReportMetric[] }[] = [];
  let current: (typeof groups)[number] | undefined;
  for (const line of lines) {
    const group = /^•\s+([A-Z]{2}|[a-z\d.-]+)[：:]\s*(.*)$/.exec(line);
    if (group) {
      current = { name: group[1], metrics: [] };
      groups.push(current);
    }
    const parts = (group?.[2] ?? line.trim()).split(/(?:^|；)\s*(自然会话|Google 点击|曝光|可归属注册|注册)\s+/);
    if (!current || parts[0] || parts.length < 3) return null;
    for (let index = 1; index < parts.length; index += 2) {
      const [label, detail] = [parts[index], parts[index + 1]];
      const result = /^(\d[\d,.]*)\s*→\s*(\d[\d,.]*)(?:（(.+)）)?$/.exec(detail);
      if (!result) {
        current.metrics.push({ label, previous: null, current: null, delta: "", period: "", note: detail });
        continue;
      }
      const previous = Number(result[1].replaceAll(",", "")), next = Number(result[2].replaceAll(",", ""));
      if (!Number.isFinite(previous) || !Number.isFinite(next)) return null;
      const annotations = (result[3] ?? "").split("；");
      const period = annotations.find(value => value.includes(" → ")) ?? "";
      const delta = annotations.find(value => /^(?:[+-]\d+(?:\.\d+)?%|持平)$/.test(value)) ?? "";
      const note = annotations.filter(value => value && value !== period && value !== delta).join("；");
      current.metrics.push({ label, previous, current: next, delta, period, note });
    }
  }
  return groups.length ? groups : null;
}

export type ReportComparisonGroups = NonNullable<ReturnType<typeof parseReportComparisons>>;
export const REPORT_MARKETS = [
  { code: "US", label: "美国", color: "#2e64d6" },
  { code: "JP", label: "日本", color: "#12a17c" },
  { code: "BR", label: "巴西", color: "#b9671b" },
  { code: "ES", label: "西班牙", color: "#8a5dd1" },
] as const;

export function reportCountryShares(groups: ReportComparisonGroups, metric: string) {
  const values = REPORT_MARKETS.map(country => groups.find(group => group.name === country.code)?.metrics.find(row => row.label === metric));
  if (values.some(row => row?.current == null || !row.period || row.period !== values[0]?.period)) return null;
  const total = values.reduce((sum, row) => sum + row!.current!, 0);
  if (total <= 0) return null;
  return REPORT_MARKETS.map((country, index) => ({ ...country, value: values[index]!.current!, share: values[index]!.current! / total }));
}
