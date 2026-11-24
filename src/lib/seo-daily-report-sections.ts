import type { ReportDashboardEvidence } from "./seo-report-dashboard";

type Evidence = Pick<ReportDashboardEvidence, "sites" | "countries" | "modules">;
const labels: Record<string, string> = { home: "首页", blog: "博客", models: "模型页", gpu: "GPU", prompts: "提示词" };
const count = (value: number | null) => value === null ? "—" : value.toLocaleString("en-US");
const pair = (value: { previous: number | null; current: number | null }) => `${count(value.previous)} → ${count(value.current)}`;
/** Exact one-day values only. Missing GSC days remain absent, never a prior-day fallback. */
export function dailyTrafficSection(evidence: Evidence, sourceDay: string) {
  const lines = ["**各站与四国流量**", `以下为前一日 → ${sourceDay}；—表示该日没有有效来源，不借其他日期。`, "", "| 站点 | 自然会话 | Google点击 | Google曝光 |", "|---|---:|---:|---:|"];
  for (const row of evidence.sites) lines.push(`| ${row.name} | ${pair(row.sessions)} | ${pair(row.clicks)} | ${pair(row.impressions)} |`);
  lines.push("", "| Flatkey市场 | 自然会话 | Google点击 | Google曝光 |", "|---|---:|---:|---:|");
  for (const row of evidence.countries) lines.push(`| ${row.name} | ${pair(row.sessions)} | ${pair(row.clicks)} | ${pair(row.impressions)} |`);
  lines.push("", "**模块流量**", "| Flatkey模块 | 自然会话 | Google点击 | Google曝光 |", "|---|---:|---:|---:|");
  for (const row of evidence.modules ?? []) lines.push(`| ${labels[row.id]} | ${pair(row.sessions)} | ${pair(row.clicks)} | ${pair(row.impressions)} |`);
  const changes = (evidence.modules ?? []).filter(row => row.sessions.current !== null && row.sessions.previous !== null && row.sessions.current !== row.sessions.previous)
    .sort((a, b) => Math.abs(b.sessions.current! - b.sessions.previous!) - Math.abs(a.sessions.current! - a.sessions.previous!)).slice(0, 3);
  if (changes.length) lines.push(`模块变化贡献：${changes.map(row => `${labels[row.id]} ${pair(row.sessions)}（${row.sessions.current! > row.sessions.previous! ? "+" : ""}${row.sessions.current! - row.sessions.previous!}）`).join("；")}。各切片不相加。`);
  return lines;
}
export function replaceDailyTrafficSection(text: string, evidence: Evidence, sourceDay: string) {
  const pattern = /\*\*各站与四国流量\*\*[\s\S]*?(?=\*\*流量涨跌原因\*\*)/u;
  if (!pattern.test(text)) throw new Error("日报流量正文与原来源快照不一致，须按当前模板重新生成基础版本");
  return text.replace(pattern, dailyTrafficSection(evidence, sourceDay).join("\n") + "\n\n");
}
