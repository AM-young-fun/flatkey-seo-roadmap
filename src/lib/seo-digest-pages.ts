import { analyticsObservationSchema, analyticsSiteForProperty, safeAnalyticsUrl, type AnalyticsObservation } from "./seo-analytics";
import { CLUSTER_SITES } from "./seo-cluster-sites";
import { OVERVIEW_PAGE_MODULES, overviewPageModule } from "./seo-overview-scope";

type PageObservation = Extract<AnalyticsObservation, { kind: "gsc-pages" | "ga4-pages" }>;
const sites = ["flatkey.ai", ...CLUSTER_SITES.map(site => site.domain)];
const shift = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const localDay = (date: Date, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
const timezoneFor = (row: PageObservation) => row.kind === "gsc-pages" ? "America/Los_Angeles" : CLUSTER_SITES.find(site => site.domain === analyticsSiteForProperty(row.property))?.ga4TimeZone ?? "America/Los_Angeles";
const propertyPriority = (row: PageObservation) => row.property.startsWith("sc-domain:") ? 2 : row.property === "https://flatkey.ai/" ? 1 : 0;
function completeness(row: PageObservation): string | null {
  if (row.rows.length >= 50000) return "页面行数达到上限，覆盖未核实";
  if (row.kind === "gsc-pages") {
    if (row.rows.some(page => !safeAnalyticsUrl(page.url))) return "含无法核实的公开页面地址";
    return row.complete ? null : "页面数据未完成、受限或尚未对齐总量";
  }
  if (row.rows.some(page => !page.hostname)) return "缺少 hostname，无法归属页面";
  if (!(row.sessionsComplete || row.complete) || row.rows.some(page => page.sessions === null)) return "自然会话页面覆盖不完整或受限";
  if (row.rows.some(page => page.path.startsWith("//") || !safeAnalyticsUrl(`https://${page.hostname}${page.path}`))) return "含无法核实的页面地址";
  return null;
}
function pageValues(row: PageObservation) {
  const values = new Map<string, number>();
  for (const page of row.rows) {
    const url = "url" in page ? page.url : `https://${page.hostname}${page.path}`;
    if (!safeAnalyticsUrl(url)) continue;
    // Search Console section URLs are evidence about one document, not extra
    // ranking pages. Use only the document row; never add fragment clicks.
    if ("url" in page && new URL(url).hash) continue;
    const value = "clicks" in page ? page.clicks : page.sessions;
    if (value !== null) values.set(url, value);
  }
  return values;
}
export const DIGEST_FLATKEY_MODULES = [
  ["home", "首页"], ["blog", "博客"], ["models", "模型页"], ["gpu", "GPU"], ["prompts", "提示词"],
] as const;

function flatkeyReportModule(value: string) {
  const url = new URL(value);
  if (!["flatkey.ai", "www.flatkey.ai"].includes(url.hostname)) return null;
  if (/^\/(?:en|zh|es|fr|pt|ru|ja|vi|de|id)?\/?$/.test(url.pathname)) return "home";
  const module = overviewPageModule(value);
  return module === "other" ? null : module;
}

export type DigestPageRanking = {
  source: "GSC" | "GA4"; metric: "clicks" | "sessions"; date: string | null;
  coveredSites: string[]; gaps: string[]; selectionReason: string;
  modules: { id: string; label: string; pages: DigestPageRanking["pages"] }[];
  flatkey?: {
    date: string | null;
    previousDate: string | null;
    periodDays?: number;
    modules: { id: string; label: string; current: number | null; previous: number | null; pages: DigestPageRanking["pages"] }[];
  };
  pages: { site: string; url: string; value: number; timezone: string; previousDate: string | null; previous: number | null; difference: number | null; percentage: number | null; comparisonReason: string | null }[];
};

/** One source-day per ranking. Only fully collected, ended days can enter; never promote an absent page to zero from an old export. */
export function digestTopPages(input: unknown[], reportDate: string, now: Date, period?: { start: string; end: string }): DigestPageRanking[] {
  const eligible: PageObservation[] = input.flatMap(value => {
    const parsed = analyticsObservationSchema.safeParse(value);
    if (!parsed.success || !["gsc-pages", "ga4-pages"].includes(parsed.data.kind) || parsed.data.country) return [];
    const row = parsed.data as PageObservation, timezone = timezoneFor(row), observedAt = new Date(row.observedAt);
    if (row.date >= reportDate || row.date >= localDay(now, timezone) || row.date >= localDay(observedAt, timezone) || observedAt > now) return [];
    return [row];
  });
  // A newer partial revision is not hidden behind an older complete revision of the same property/day.
  const byPropertyDay = new Map<string, PageObservation>();
  for (const row of eligible) {
    const key = JSON.stringify([row.kind, row.property, row.date]), prior = byPropertyDay.get(key);
    if (!prior || row.observedAt > prior.observedAt) byPropertyDay.set(key, row);
  }
  return (["GSC", "GA4"] as const).map(source => {
    const kind = source === "GSC" ? "gsc-pages" : "ga4-pages";
    const rows = [...byPropertyDay.values()].filter(row => row.kind === kind);
    const oldest = shift(reportDate, -14);
    const ready = rows.filter(row => row.date >= oldest && !completeness(row));
    const latestSourceDate = rows.map(row => row.date).sort().at(-1) ?? null;
    const coverage = new Map<string, Set<string>>();
    for (const row of ready) {
      const covered = coverage.get(row.date) ?? new Set<string>();
      covered.add(analyticsSiteForProperty(row.property)!); coverage.set(row.date, covered);
    }
    // At 10:30 Beijing, LA and Shanghai properties have different latest ended days.
    // Prefer their latest common date instead of repeatedly hiding the three LA sites.
    const commonDate = [...coverage].filter(([, covered]) => covered.size === sites.length).map(([day]) => day).sort().at(-1);
    const recentStart = latestSourceDate ? [shift(latestSourceDate, -7), oldest].sort().at(-1)! : oldest;
    const fallback = [...coverage].filter(([day]) => day >= recentStart)
      .sort((a, b) => b[1].size - a[1].size || b[0].localeCompare(a[0]))[0]?.[0];
    const date = commonDate ?? fallback ?? null;
    const selectionReason = commonDate ? `最近五站共同完整日${latestSourceDate && latestSourceDate > commonDate ? `；部分站点已有 ${latestSourceDate} 数据，未跨日期混排` : ""}`
      : date ? `无五站共同完整日；在最新来源日 ${latestSourceDate} 及向前7天内优先完整站覆盖，再选最新日期`
        : "最近14天内缺少可用完整日期，未回退到更旧数据";
    const currentBySite = new Map<string, PageObservation>();
    for (const row of ready.filter(row => row.date === date)) {
      const site = analyticsSiteForProperty(row.property)!;
      const prior = currentBySite.get(site);
      if (!prior || propertyPriority(row) > propertyPriority(prior) || propertyPriority(row) === propertyPriority(prior) && row.observedAt > prior.observedAt) currentBySite.set(site, row);
    }
    const gaps = sites.flatMap(site => {
      if (currentBySite.has(site)) return [];
      const latest = rows.filter(row => analyticsSiteForProperty(row.property) === site).sort((a, b) => b.date.localeCompare(a.date) || b.observedAt.localeCompare(a.observedAt))[0];
      return [`${site}：${latest ? `${latest.date}，${completeness(latest) ?? "与榜单日期不同"}` : "缺少已结束日的逐页数据"}`];
    });
    const pages: DigestPageRanking["pages"] = [];
    for (const [site, row] of currentBySite) {
      const prior = byPropertyDay.get(JSON.stringify([kind, row.property, shift(row.date, -1)]));
      const comparable = prior && !completeness(prior) && prior.source === row.source
        && (row.kind !== "ga4-pages" || prior.kind === "ga4-pages" && prior.hostnameDimension === row.hostnameDimension);
      const baseline = comparable ? pageValues(prior) : null;
      // The API collector paginates/reconciles complete reports. Legacy/browser exports do not prove that an absent URL was zero.
      const absentIsZero = comparable && prior.source === "google-api" && (prior.kind === "gsc-pages" || prior.hostnameDimension === "hostName");
      for (const [url, value] of pageValues(row)) {
        if (value === 0) continue;
        const previous = baseline?.get(url) ?? (absentIsZero ? 0 : null);
        pages.push({ site, url, value, timezone: timezoneFor(row), previousDate: previous === null ? null : prior!.date, previous,
          difference: previous === null ? null : value - previous, percentage: previous === null || previous === 0 ? null : (value - previous) / previous * 100,
          comparisonReason: previous !== null ? null : !prior ? "缺少前一日基线" : !comparable ? "前一日来源或页面覆盖不可比" : "前一日未返回此页面，不能按0处理" });
      }
    }
    pages.sort((a, b) => b.value - a.value || a.site.localeCompare(b.site) || a.url.localeCompare(b.url));
    // Select from the full eligible page population BEFORE taking the global
    // top five. Otherwise lower-traffic GPU/Prompt pages disappear entirely.
    const modules = OVERVIEW_PAGE_MODULES.filter(([id]) => id !== "all").map(([id, label]) => ({ id, label,
      pages: pages.filter(page => (overviewPageModule(page.url) ?? "unknown") === id).slice(0, 3) }));
    const flatkeyRows = ready.filter(row => analyticsSiteForProperty(row.property) === "flatkey.ai")
      .sort((a, b) => b.date.localeCompare(a.date) || propertyPriority(b) - propertyPriority(a) || b.observedAt.localeCompare(a.observedAt));
    const flatkeyRow = period ? flatkeyRows.find(row => row.date === period.end)
      ?? flatkeyRows.find(row => row.date <= period.end) : flatkeyRows[0];
    const comparable = (row: PageObservation, base: PageObservation) => !completeness(row) && row.source === base.source
      && (base.kind !== "ga4-pages" || row.kind === "ga4-pages" && row.hostnameDimension === base.hostnameDimension);
    const days = period ? (Date.parse(period.end) - Date.parse(period.start)) / 86400000 + 1 : 1;
    const aggregate = (end: string) => {
      if (!flatkeyRow) return null;
      const values = new Map<string, number>();
      let absentIsZero = true;
      for (let index = 0; index < days; index++) {
        const row = byPropertyDay.get(JSON.stringify([kind, flatkeyRow.property, shift(end, -index)]));
        if (!row || !comparable(row, flatkeyRow)) return null;
        absentIsZero &&= row.source === "google-api" && (row.kind === "gsc-pages" || row.hostnameDimension === "hostName");
        for (const [url, value] of pageValues(row)) values.set(url, (values.get(url) ?? 0) + value);
      }
      return { values, absentIsZero };
    };
    const currentEnd = period?.end ?? flatkeyRow?.date;
    const previousEnd = currentEnd ? shift(currentEnd, -days) : null;
    const currentData = currentEnd ? aggregate(currentEnd) : null;
    const previousData = previousEnd ? aggregate(previousEnd) : null;
    const currentValues = [...(currentData?.values ?? [])];
    const previousValues = [...(previousData?.values ?? [])];
    const flatkey = {
      date: currentData ? currentEnd! : null, previousDate: previousData ? previousEnd : null, periodDays: days,
      modules: DIGEST_FLATKEY_MODULES.map(([id, label]) => {
        const current = currentValues.filter(([url]) => flatkeyReportModule(url) === id);
        const previous = previousValues.filter(([url]) => flatkeyReportModule(url) === id);
        const ranked = flatkeyRow ? current.filter(([, value]) => value > 0)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
          .map(([url, value]) => {
            const baseline = previousData?.values.get(url) ?? (previousData?.absentIsZero ? 0 : null);
            return { site: "flatkey.ai", url, value, timezone: timezoneFor(flatkeyRow),
              previousDate: baseline === null ? null : previousEnd, previous: baseline,
              difference: baseline === null ? null : value - baseline,
              percentage: baseline ? (value - baseline) / baseline * 100 : null,
              comparisonReason: baseline === null ? "缺少可比的前一日页面记录" : null };
          }) : [];
        return { id, label, current: current.length || currentData?.absentIsZero ? current.reduce((n, [, value]) => n + value, 0) : null,
          previous: previous.length || previousData?.absentIsZero ? previous.reduce((n, [, value]) => n + value, 0) : null, pages: ranked };
      }),
    };
    return { source, metric: source === "GSC" ? "clicks" : "sessions", date, selectionReason, coveredSites: [...currentBySite.keys()].sort(), gaps, pages: pages.slice(0, 5), modules, flatkey };
  });
}
