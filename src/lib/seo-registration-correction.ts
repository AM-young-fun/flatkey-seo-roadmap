import { digestWindow, type SeoDigest } from "./seo-digest";
import { registrationPeriodComparison, registrationPeriodSelection, type RegistrationPeriod } from "./seo-registration-period";

/** Archive display correction; exact sent reportId snapshots remain immutable. */
export function registrationCorrection<T extends SeoDigest>(report: T, rows: RegistrationPeriod[]) {
  const { trafficStart: start, trafficEnd: end } = digestWindow(report.date, report.kind);
  const offset = report.kind === "weekly" ? 7 : 1;
  const shift = (d: string) => new Date(Date.parse(d + "T00:00:00Z") - offset * 86400000).toISOString().slice(0, 10);
  const selected = registrationPeriodSelection(rows, start, end, shift(start), shift(end));
  const periods = [selected.current, selected.previous].filter((row): row is RegistrationPeriod => row !== null);
  if (!periods.length) return report;
  const organicRegistrations = registrationPeriodComparison(periods, start, end, shift(start), shift(end));
  const n = (value: number | null) => value === null ? "待更新" : `${value} 人`;
  const comparison = `${n(organicRegistrations.previous)} → ${n(organicRegistrations.current)}`;
  const observedAt = periods.map(row => row.observedAt).sort().at(-1)!;
  const note = `注册数据补采：${selected.current?.start ?? start}—${selected.current?.end ?? end}（America/Los_Angeles）；报告期 ${start}—${end}；首次获客渠道 Organic Search；sign_up_success / totalUsers，整段去重；采集 ${observedAt}。原发送快照保留。`;
  const correct = (text: string) => text.replace(/GA4 自然搜索(?:会话归因)?去重注册[^\n]*/g, `GA4 首次自然搜索获客去重注册 ${comparison}`)
    .replace(/GA4 去重注册（首次来源为自然搜索）[^\n]*/g, `GA4 去重注册（首次来源为自然搜索） ${comparison}`) + "\n\n" + note;
  return { ...report, registrationCoverageNote: note, organicRegistrations, text: correct(report.text), detailText: correct(report.detailText),
    weeklyTraffic: report.weeklyTraffic?.map(row => row.label === "自然搜索去重注册用户" ? { ...row, previous: n(organicRegistrations.previous), current: n(organicRegistrations.current), dates: `${selected.previous?.start ?? shift(start)}—${selected.previous?.end ?? shift(end)} → ${selected.current?.start ?? start}—${selected.current?.end ?? end} · 洛杉矶 · 首次获客`, change: "—" } : row),
    registrationCorrection: { observedAt, start, end, channelDimension: "firstUserPrimaryChannelGroup", originalReportId: report.id },
  };
}
