import type { AnalyticsObservation } from "./seo-analytics";
import { analyticsSiteForProperty } from "./seo-analytics";
import { CLUSTER_SITES } from "./seo-cluster-sites";
import type { GrowthWorkspace } from "./growth-types";
import type { GrowthDriver, GrowthPublicationReference, GrowthReportSnapshot } from "./growth-strategy";

const shift = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const pageKey = (url: string) => { const value = new URL(url); return value.origin + value.pathname.replace(/\/$/, ""); };
/** Conservative contribution evidence only. Missing page rows are not converted
 * to zero and page/country/source slices are never added into a causal total. */
export function growthPageContributionDirections(workspace: GrowthWorkspace, publications: (GrowthPublicationReference & { title?: string })[], observations: AnalyticsObservation[], period: { start: string; end: string }, now = new Date()): GrowthReportSnapshot["directions"] {
  const start = shift(period.start, -7), dates = Array.from({ length: 14 }, (_, index) => shift(start, index));
  const groups = new Map<string, Map<string, AnalyticsObservation>>();
  for (const row of observations) {
    if (!["ga4-pages", "gsc-pages"].includes(row.kind) || !row.complete || row.date < start || row.date > period.end || Date.parse(row.observedAt) > now.getTime()) continue;
    const site = analyticsSiteForProperty(row.property);
    if (!site || !["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(site)) continue;
    if (row.kind === "ga4-pages" && (!row.sessionsComplete || site !== "flatkey.ai" && CLUSTER_SITES.find(s => s.domain === site)?.ga4TimeZone !== "America/Los_Angeles")) continue;
    const key = JSON.stringify([site, row.country ?? "ALL", row.kind]);
    const group = groups.get(key) ?? new Map<string, AnalyticsObservation>();
    const old = group.get(row.date);
    if (!old || old.observedAt < row.observedAt) group.set(row.date, row);
    groups.set(key, group);
  }
  const drivers: GrowthDriver[] = [];
  for (const [key, group] of groups) {
    if (dates.some(date => !group.has(date))) continue;
    const [site, country, kind] = JSON.parse(key) as string[];
    const dayPages = dates.map(day => {
      const row = group.get(day)!;
      return new Map((row.kind === "gsc-pages" ? row.rows.map(page => [pageKey(page.url), { url: page.url, value: page.clicks }] as const) : row.kind === "ga4-pages" ? row.rows.filter(page => page.sessions !== null && (!page.hostname || page.hostname === site || page.hostname === "www." + site)).map(page => { const url = `https://${page.hostname ?? site}${page.path}`; return [pageKey(url), { url, value: page.sessions! }] as const; }) : []));
    });
    for (const [urlKey, page] of dayPages[0]) {
      if (dayPages.some(day => !day.has(urlKey))) continue;
      const previous = dayPages.slice(0, 7).reduce((sum, day) => sum + day.get(urlKey)!.value, 0), current = dayPages.slice(7).reduce((sum, day) => sum + day.get(urlKey)!.value, 0);
      if (previous === current) continue;
      const targets = workspace.targets.filter(target => target.site === site && target.publishedUrls.some(url => pageKey(url) === urlKey));
      const topics = [...new Set(targets.map(target => target.topicId).filter((id): id is string => Boolean(id)))];
      const target = targets.find(target => target.country === country) ?? targets[0];
      const pages = publications.filter(publication => publication.status === "verified" && pageKey(publication.pageUrl) === urlKey);
      const actualChanges = pages.filter(publication => publication.publishedAt.slice(0, 10) >= period.start && publication.publishedAt.slice(0, 10) <= period.end);
      const taskIds = [...new Set([...targets.flatMap(target => target.taskIds), ...pages.map(page => page.taskId)])];
      const module = new URL(page.url).pathname.split("/").filter(Boolean).find(part => !["en", "zh", "ja", "pt", "es"].includes(part)) ?? "home";
      drivers.push({ title: pages.find(publication => publication.title)?.title ?? `页面 ${new URL(page.url).pathname}`, url: page.url, topicId: topics.length === 1 ? topics[0] : null, module, country, language: target?.language ?? "und", source: kind === "gsc-pages" ? "GSC" : "GA4", metric: kind === "gsc-pages" ? "clicks" : "sessions", previous, current, window: { ...period, previousStart: start, previousEnd: shift(period.start, -1), timezone: "America/Los_Angeles" }, publicationIds: actualChanges.map(page => page.id), taskIds,
        explanation: actualChanges.length ? `本期存在${actualChanges.some(page => page.kind === "optimization") ? "优化" : "上线"}回执，页面贡献${current - previous > 0 ? "增加" : "减少"}${Math.abs(current - previous)}；需结合原词原市场及外部需求核实动作作用。` : `既有页面的${kind === "gsc-pages" ? "Google点击" : "自然会话"}贡献${current > previous ? "增加" : "减少"}${Math.abs(current - previous)}，本期未找到该页新上线/优化回执。`,
        limitation: "这是同窗口相关贡献；查询需求、竞品变化及本站优势尚待补证，不据此证明因果。页面、国家、来源切片不相加。",
        nextAction: current > previous ? "复核本语言查询、需求持续性、竞争缺口与转化；有优势证据后提交加码方案，优先补原页和原任务" : "沿原页原任务核查曝光/排名/CTR、索引、竞争变化与页面改动，再确定刷新内容、修复问题或继续观察" });
    }
  }
  const sorted = (sign: 1 | -1) => drivers.filter(driver => Math.sign(driver.current - driver.previous) === sign).sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous)).slice(0, 3);
  const selected = [...sorted(1), ...sorted(-1)];
  return ([1, -1] as const).flatMap(sign => {
    const rows = selected.filter(driver => Math.sign(driver.current - driver.previous) === sign);
    if (!rows.length) return [];
    const topics = [...new Set(rows.map(row => row.topicId ? workspace.topics.find(topic => topic.topicId === row.topicId)?.name ?? row.topicId : row.module))];
    return [{ id: `contributions:${period.start}:${sign}`, title: `${sign > 0 ? "上升" : "下降"}方向：${topics.join("、")}`, experimentId: "evidence-review", recommendation: sign > 0 ? "先核验高贡献模块/话题的外部需求与本站优势，再提交有范围和指标的加码机会卡" : "优先查清下降页面的排名、需求、竞品及本站改动，沿原任务补证并给出修复方案", decision: "AI观察信号，未作新增方向或加码批准", taskIds: [...new Set(rows.flatMap(row => row.taskIds))], drivers: rows }];
  });
}
