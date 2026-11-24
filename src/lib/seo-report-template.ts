/** Template versions belong to immutable report snapshots. Older saved bodies
 * retain their original six sections; v9 removes the independent GitHub block. */
export const SEO_REPORT_TEMPLATE_VERSION = 9;
export function weeklyReportSections(version?: number) {
  return version !== undefined && version >= SEO_REPORT_TEMPLATE_VERSION
    ? ["一", "二", "三", "四", "五"] : ["一", "二", "三", "四", "五", "六"];
}
export function hasWeeklyReportSections(text: string, version?: number) {
  const sections = weeklyReportSections(version);
  if (!sections.every(section => new RegExp(`(?:^|\\n)(?:\\*\\*|#{1,3}\\s*)${section}、`, "u").test(text))) return false;
  if (version === undefined || version < SEO_REPORT_TEMPLATE_VERSION) return true;
  const headings = [...text.matchAll(/(?:^|\n)(?:\*\*|#{1,3}\s*)([一二三四五六]、[^\n]+)/gu)].map(match => match[1].replace(/\*\*\s*$/u, "").trim());
  return JSON.stringify(headings) === JSON.stringify(["一、业务与搜索表现", "二、各站与主要市场", "三、本周交付与页面效果", "四、关键词、收录与技术观察", "五、下周安排与复盘"]);
}
export function weeklyTechnicalText(text: string, version?: number) {
  const [current, next] = version !== undefined && version >= SEO_REPORT_TEMPLATE_VERSION ? ["四", "五"] : ["五", "六"];
  return new RegExp(`(?:^|\\n)(?:\\*\\*|#{1,3}\\s*)${current}、[^\\n]+(?:\\*\\*)?\\s*\\n([\\s\\S]*?)(?=\\n(?:\\*\\*|#{1,3}\\s*)${next}、)`, "u").exec(text)?.[1].trim();
}
