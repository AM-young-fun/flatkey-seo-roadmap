import type { AnalyticsObservation } from "./seo-analytics";
import { analyticsSiteForProperty } from "./seo-analytics";
import { CLUSTER_SITES } from "./seo-cluster-sites";
import type { GrowthWorkspace } from "./growth-types";
import type { GrowthDriver, GrowthPublicationReference, GrowthReportSnapshot } from "./growth-strategy";
import type { WorkflowTask } from "./seo-workflow";

const shift = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const pageKey = (url: string) => { const value = new URL(url); return value.origin + value.pathname.replace(/\/$/, ""); };
const routeLanguages: Record<string, string> = { en: "en", zh: "zh-CN", es: "es-ES", fr: "fr", pt: "pt-BR", ru: "ru", ja: "ja", vi: "vi", de: "de", id: "id" };
const reportDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });
const publishedReportDay = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : reportDate.format(date); };
const contributionMetrics = ["sessions", "clicks", "impressions"] as const;
const metricNames = { sessions: "自然会话", clicks: "Google点击", impressions: "Google曝光" };
type PageObservation = Extract<AnalyticsObservation, { kind: "ga4-pages" | "gsc-pages" }>;

function comparablePageDay(row: PageObservation, anchor: PageObservation) {
  if (row.kind !== anchor.kind || row.property !== anchor.property || row.source !== anchor.source) return false;
  if (row.kind === "gsc-pages") return row.complete;
  // A page record can contain complete landing sessions and unavailable
  // registration attribution. Only the session quality controls this series.
  return anchor.kind === "ga4-pages" && (row.sessionsComplete ?? row.complete)
    && row.scope === anchor.scope && row.hostScope === anchor.hostScope && row.hostnameDimension === anchor.hostnameDimension
    && row.rows.every(page => Boolean(page.hostname) && page.sessions !== null);
}

function pagesForDay(row: PageObservation, site: string) {
  const entries: { url: string; values: Partial<Record<GrowthDriver["metric"], number>> }[] = row.kind === "gsc-pages"
    ? row.rows.filter(page => !new URL(page.url).hash).map(page => ({ url: page.url, values: { clicks: page.clicks, impressions: page.impressions } }))
    : row.rows.flatMap(page => page.hostname && !page.path.startsWith("//") && page.sessions !== null
      ? [{ url: `https://${page.hostname}${page.path}`, values: { sessions: page.sessions } }] : []);
  const pages = new Map<string, (typeof entries)[number]>(), ambiguous = new Set<string>();
  for (const entry of entries) {
    const url = new URL(entry.url);
    if (url.protocol !== "https:" || (url.hostname !== site && url.hostname !== `www.${site}`)) continue;
    const key = pageKey(entry.url);
    if (pages.has(key)) ambiguous.add(key);
    pages.set(key, entry);
  }
  for (const key of ambiguous) pages.delete(key);
  return pages;
}

/** A localized page describes its own language, not the keyword's target market. */
function pageRoute(url: string, site: string) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const localized = site === "flatkey.ai" && Object.hasOwn(routeLanguages, parts[0] ?? "");
  const language = site === "flatkey.ai" ? localized ? routeLanguages[parts[0]] : "en" : null;
  return { module: parts[localized ? 1 : 0] ?? "home", language };
}
/** Conservative contribution evidence only. Missing page rows are not converted
 * to zero and page/country/source slices are never added into a causal total. */
export function growthPageContributionDirections(workspace: GrowthWorkspace, publications: (GrowthPublicationReference & { title?: string })[], observations: AnalyticsObservation[], period: { start: string; end: string }, now = new Date(), tasks: WorkflowTask[] = []): GrowthReportSnapshot["directions"] {
  const start = shift(period.start, -7), dates = Array.from({ length: 14 }, (_, index) => shift(start, index));
  const groups = new Map<string, Map<string, PageObservation>>();
  for (const row of observations) {
    if ((row.kind !== "ga4-pages" && row.kind !== "gsc-pages") || row.date < start || row.date > period.end || Date.parse(row.observedAt) > now.getTime()) continue;
    const site = analyticsSiteForProperty(row.property);
    if (!site || !["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(site)) continue;
    if (row.kind === "ga4-pages" && site !== "flatkey.ai" && CLUSTER_SITES.find(s => s.domain === site)?.ga4TimeZone !== "America/Los_Angeles") continue;
    const key = JSON.stringify([site, row.country ?? "ALL", row.kind]);
    const group = groups.get(key) ?? new Map<string, PageObservation>();
    const old = group.get(row.date);
    if (!old || old.observedAt < row.observedAt) group.set(row.date, row);
    groups.set(key, group);
  }
  const drivers: GrowthDriver[] = [];
  for (const [key, group] of groups) {
    if (dates.some(date => !group.has(date))) continue;
    // Select the latest saved revision first. A newer incomplete source must
    // not silently fall back to an older complete value of that same day.
    const sourceDays = dates.map(date => group.get(date)!);
    if (sourceDays.some(row => !comparablePageDay(row, sourceDays[0]))) continue;
    const [site, country, kind] = JSON.parse(key) as string[];
    const dayPages = sourceDays.map(day => pagesForDay(day, site));
    for (const [urlKey, page] of dayPages[0]) {
      if (dayPages.some(day => !day.has(urlKey))) continue;
      const comparisons = contributionMetrics.flatMap(metric => {
        if (page.values[metric] === undefined) return [];
        const values = dayPages.map(day => day.get(urlKey)!.values[metric]);
        if (!values.every(value => value !== undefined)) return [];
        const sum = (days: number[]) => days.reduce((total, value) => total + value, 0);
        const previous = sum(values.slice(0, 7)), current = sum(values.slice(7));
        return previous === current ? [] : [{ metric, previous, current }];
      });
      if (!comparisons.length) continue;
      const targets = workspace.targets.filter(target => target.site === site && target.publishedUrls.some(url => pageKey(url) === urlKey));
      const topics = [...new Set(targets.map(target => target.topicId).filter((id): id is string => Boolean(id)))];
      const target = targets.find(target => target.country === country) ?? targets[0];
      const pages = publications.filter(publication => publication.status === "verified" && pageKey(publication.pageUrl) === urlKey);
      const actualChanges = pages.filter(publication => { const day = publishedReportDay(publication.publishedAt); return day !== null && day >= period.start && day <= period.end; });
      const actions = actualChanges.map(publication => {
        const task = tasks.find(task => task.id === publication.taskId && task.contentVersion === publication.contentVersion);
        const label = task?.workClass === "content_refresh" ? "旧文翻新" : task?.workClass === "internal_linking" ? "内链调整" : publication.kind === "optimization" ? "页面优化" : "内容发布";
        const completed = task?.progress?.filter(row => row.observedAt >= publication.publishedAt && Date.parse(row.observedAt) <= now.getTime()).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0]?.summary;
        // A proposed plan is not evidence that its specific edits shipped.
        return `${publishedReportDay(publication.publishedAt)} ${label}；版本${publication.contentVersion}；原任务${publication.taskId}${completed ? `；完成回执：${completed}` : "；具体改动见原任务该版本发布回执"}`;
      });
      const taskIds = [...new Set([...targets.flatMap(target => target.taskIds), ...pages.map(page => page.taskId)])];
      const route = pageRoute(page.url, site), pageLanguages = [...new Set(pages.map(page => page.language).filter((language): language is string => Boolean(language)))];
      const language = route.language ?? (pageLanguages.length === 1 ? pageLanguages[0] : target?.language ?? "und");
      for (const { metric, previous, current } of comparisons) drivers.push({ title: pages.find(publication => publication.title)?.title ?? `页面 ${new URL(page.url).pathname}`, url: page.url, topicId: topics.length === 1 ? topics[0] : null, module: route.module, country, language, source: kind === "gsc-pages" ? "GSC" : "GA4", metric, previous, current, window: { ...period, previousStart: start, previousEnd: shift(period.start, -1), timezone: "America/Los_Angeles" }, publicationIds: actualChanges.map(page => page.id), taskIds,
        explanation: actualChanges.length ? `${actions.join("；")}。${metricNames[metric]}${current > previous ? "增加" : "减少"}${Math.abs(current - previous)}。` : `自然变化。${metricNames[metric]}${current > previous ? "增加" : "减少"}${Math.abs(current - previous)}；本期未找到该页新发布或优化回执。`,
        limitation: actualChanges.length ? "改动与流量属于同窗口相关贡献，尚不能证明因果。页面、国家、来源切片不相加。" : "保留实际页面、话题、国家及来源供用户查看；不推断为内容过时、缺失或意图错误。",
        nextAction: !actualChanges.length ? "由用户查看自然变化原因；不据此自动创建整改任务" : current > previous ? "结合原词需求持续性和商业承接供用户判断加码；新词挂回原话题，原季度1600成员和已排任务保留" : "沿原任务检查实际改动；有证据时明确内容过时、覆盖不足、意图不符、CTR、竞争需求或技术原因，再给修复与验证指标" });
    }
  }
  return ([1, -1] as const).flatMap(sign => {
    const rows = contributionMetrics.flatMap(metric => drivers.filter(driver => driver.metric === metric && Math.sign(driver.current - driver.previous) === sign)
      .sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous)).slice(0, 3));
    if (!rows.length) return [];
    const topics = [...new Set(rows.map(row => row.topicId ? workspace.topics.find(topic => topic.topicId === row.topicId)?.name ?? row.topicId : row.module))];
    return [{ id: `contributions:${period.start}:${sign}`, title: `${sign > 0 ? "上升" : "下降"}方向：${topics.join("、")}`, experimentId: "evidence-review", recommendation: rows.every(row => !row.publicationIds.length) ? "自然变化，保留具体贡献供用户查看原因，不自动建整改任务" : sign > 0 ? "结合真实改动、需求持续性和商业承接供用户判断加码，新增词挂回原话题" : "结合该版本实际改动和问题证据，沿原任务提出修复与验证指标", decision: "AI观察信号，未作新增方向或加码批准", taskIds: [...new Set(rows.flatMap(row => row.taskIds))], drivers: rows }];
  });
}
