import type { DateRange } from "./seo-date-range";
import type { RegistrationPeriod } from "./seo-registration-period";

export type OrganicRegistrationArchive = { scope: string; records: RegistrationPeriod[] };
export function overviewRegistration(range: DateRange, archive: OrganicRegistrationArchive | null, country = "all") {
  const days = Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86400000) + 1;
  const record = country === "all" && archive?.scope === "first-user-organic-search"
    ? archive.records.filter(row => row.start === range.start && row.end === range.end
      && row.siteDomain === "flatkey.ai" && row.propertyId === "541304395"
      && row.channelDimension === "firstUserPrimaryChannelGroup" && row.channelName === "Organic Search"
      && row.event === "sign_up_success" && row.metric === "totalUsers" && row.distinctOverWholePeriod
      && row.timezone === "America/Los_Angeles")
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0] : undefined;
  return { total: record?.users ?? null, measured: record ? days : 0, days, record };
}

export function overviewRegistrationChange(current: ReturnType<typeof overviewRegistration>, previous: ReturnType<typeof overviewRegistration> | null, compare: boolean) {
  if (!compare) return "";
  if (current.total === null) return "区间去重数据待采集";
  if (!previous || previous.total === null) return "对比期数据未齐";
  if (current.days !== previous.days) return "区间长度不同，暂不比较";
  if (current.total === previous.total) return "与对比期持平";
  const direction = current.total > previous.total ? "多" : "少";
  return previous.total === 0 ? `比对比期${direction} ${Math.abs(current.total - previous.total)} 人`
    : `比对比期${direction} ${Math.abs((current.total / previous.total - 1) * 100).toFixed(1)}%`;
}
