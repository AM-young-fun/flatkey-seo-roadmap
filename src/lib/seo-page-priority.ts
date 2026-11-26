import type { AnalyticsObservation } from "./seo-analytics";
import { publishedKeywordRank, publishedPageKey } from "./growth-keyword-inventory";
import { growthWebsitePageUrl } from "./growth-live-page";
import type { PublishedKeywordRank } from "./published-keyword-rank";
import type { GrowthTarget } from "./growth-types";
import { growthWordKey } from "./growth-workspace";
import { completeGscReports, gscDate } from "./seo-page-effects";
import { shiftDay } from "./seo-date-range";
import type { GrowthAnalysisCountry } from "./seo-growth-markets";
import { seoTablePage } from "./seo-table-page";
import type { WorkflowSnapshot } from "./seo-workflow";

type Period = { clicks: number; impressions: number; position: number | null };
const band = (rank: number) => rank < 4 ? "1–3" : rank < 11 ? "4–10" : rank < 21 ? "11–20" : rank < 51 ? "21–50" : "51+";
const high = 40;
const activeStatuses = new Set(["planned", "researching", "ready", "drafting", "review_pending", "approved", "published"]);
export const pagePrioritySignals = ["高", "中", "低", "观察中", "待核实"] as const;
type PagePrioritySignal = typeof pagePrioritySignals[number];
const rankOrder: Record<PublishedKeywordRank, number> = { outside100: 0, ranked: 1, pending: 2 };

export type PagePriorityFilters = { rank: PublishedKeywordRank | "all"; signal: PagePrioritySignal | "all"; page: number };

export function pageOptimizationPriorityRows(
  observations: AnalyticsObservation[], workflow: Pick<WorkflowSnapshot, "tasks" | "publications">, targets: GrowthTarget[],
  site: string, country: GrowthAnalysisCountry, now: Date, filters: Omit<PagePriorityFilters, "page"> = { rank: "all", signal: "all" },
) {
  const asOf = now.toISOString();
  const candidates = targets.filter(target => target.site === site && target.country === country && target.sourceActive !== false).flatMap(target => {
    const pages = new Map<string, string>();
    for (const url of target.maintenancePublishedUrls ?? []) {
      if (!growthWebsitePageUrl(url, site)) continue;
      const key = publishedPageKey(url, site);
      if (key && !pages.has(key)) pages.set(key, url);
    }
    return [...pages].flatMap(([pageKey, url]) => {
      const rankStatus = publishedKeywordRank(target, asOf, url);
      return rankStatus ? [{ target, url, rankStatus, pageKey }] : [];
    });
  });
  const candidatePages = new Set(candidates.map(candidate => candidate.url));
  const end = shiftDay(gscDate(now), -1);
  const reports = completeGscReports(observations, site, country, { start: shiftDay(end, -34), end }, now);
  const property = [...new Set(reports.map(row => row.property))].sort((a, b) =>
    (reports.filter(row => row.property === b).at(-1)?.date ?? "").localeCompare(reports.filter(row => row.property === a).at(-1)?.date ?? "")
    || Number(b.startsWith("sc-domain:")) - Number(a.startsWith("sc-domain:")))[0];
  const byDate = new Map(reports.filter(row => row.property === property).map(row => [row.date, new Map(row.rows.map(page => [page.url, page]))]));
  const latestDay = [...byDate.keys()].at(-1);
  const pairs = latestDay ? Array.from({ length: 7 }, (_, i) => shiftDay(latestDay, -i))
    .filter(day => byDate.has(day) && byDate.has(shiftDay(day, -7))) : [];
  const tasks = workflow.tasks.filter(task => task.siteDomain === site && (task.country ?? "all") === country && task.kind === "optimization"
    && !task.deletedAt && task.channel !== "github" && task.channel !== "product");
  const tasksByPage = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const key = task.pageUrl ? publishedPageKey(task.pageUrl, site) : null;
    if (!key) continue;
    const existing = tasksByPage.get(key) ?? [];
    existing.push(task);
    tasksByPage.set(key, existing);
  }
  const recentDates = latestDay ? Array.from({ length: 14 }, (_, i) => shiftDay(latestDay, -i)) : [];
  const pages = new Set([...candidatePages, ...recentDates.flatMap(day => [...(byDate.get(day)?.keys() ?? [])])]);
  const changed = new Map<string, string>();
  for (const row of workflow.publications) {
    const publicationTime = Date.parse(row.publishedAt);
    if (row.siteDomain !== site || (row.country ?? "all") !== country || row.status !== "verified" || !Number.isFinite(publicationTime) || publicationTime > now.getTime()) continue;
    const key = publishedPageKey(row.pageUrl, site);
    const day = gscDate(new Date(publicationTime));
    if (key && day > (changed.get(key) ?? "")) changed.set(key, day);
  }
  const aggregate = (url: string, days: string[]): Period => {
    const rows = days.map(day => byDate.get(day)!.get(url)!);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    return { clicks: rows.reduce((sum, row) => sum + row.clicks, 0), impressions,
      position: impressions && rows.every(row => !row.impressions || row.position !== null)
        ? rows.reduce((sum, row) => sum + row.impressions * (row.position ?? 0), 0) / impressions : null };
  };
  const observed = [...pages].map(url => {
    const comparable = pairs.filter(day => {
      const current = byDate.get(day)!.get(url), previous = byDate.get(shiftDay(day, -7))!.get(url);
      return current && previous && current.clicks <= current.impressions && previous.clicks <= previous.impressions;
    });
    const current = comparable.length ? aggregate(url, comparable) : null;
    const previous = comparable.length ? aggregate(url, comparable.map(day => shiftDay(day, -7))) : null;
    return { url, current, previous, comparable: comparable.length, signature: comparable.join(",") };
  });
  const peerGroups = new Map<string, { url: string; ctr: number }[]>();
  for (const row of observed) {
    if (!row.current || row.comparable < 4 || row.current.impressions < 40 || row.current.position == null) continue;
    const key = band(row.current.position) + ":" + row.signature;
    const peers = peerGroups.get(key) ?? [];
    peers.push({ url: row.url, ctr: row.current.clicks / row.current.impressions });
    peerGroups.set(key, peers);
  }
  for (const group of peerGroups.values()) group.sort((a, b) => a.ctr - b.ctr || a.url.localeCompare(b.url));
  const pageMetrics = new Map(observed.filter(row => candidatePages.has(row.url)).map(row => {
    const { url, current, previous, comparable } = row;
    const reasons: string[] = [];
    let score = 0;
    const enough = comparable >= 4 && current && previous && current.impressions >= 40 && previous.impressions >= 40;
    if (enough && current && previous) {
      const ctr = current.clicks / current.impressions;
      const priorCtr = previous.clicks / previous.impressions;
      if (previous.clicks - current.clicks >= 5 && current.clicks <= previous.clicks * 0.8) {
        score += 20; reasons.push("同星期点击下降 ≥20%，至少减少 5 次");
      }
      if (current.impressions <= previous.impressions * 0.75) { score += 10; reasons.push("同星期曝光下降 ≥25%"); }
      if (current.position != null && previous.position != null && current.position - previous.position >= 3) {
        score += 15; reasons.push("平均排名后退至少 3 位");
      }
      const peers = current.position == null ? [] : peerGroups.get(band(current.position) + ":" + row.signature) ?? [];
      const middle = Math.floor((peers.length - 1) / 2);
      const index = peers.findIndex(peer => peer.url === url);
      const peerCtr = peers.length >= 4 && index >= 0 ? peers[index <= middle ? middle + 1 : middle].ctr : null;
      if (current.position != null && current.position <= 20 && current.impressions >= 80
        && peerCtr != null && peerCtr - ctr >= 0.01) {
        score += 30; reasons.push("曝光充足且排名前 20，CTR 低于同市场同排名段至少 1 个百分点");
      } else if (priorCtr - ctr >= 0.01 && current.impressions >= 80) {
        score += 15; reasons.push("同星期 CTR 下降至少 1 个百分点");
      }
    }
    return [url, { current, previous, comparable, score, reasons, enough }] as const;
  }));
  const observationStart = shiftDay(end, -7);
  const stale = !latestDay || latestDay < shiftDay(end, -4);
  const counts = { outside100: 0, ranked: 0, pending: 0 };
  const recommendations = candidates.flatMap(({ target, url, rankStatus, pageKey }) => {
    const { current, previous, comparable, score: pageScore, reasons: pageReasons, enough } = pageMetrics.get(url)!;
    const matching = (tasksByPage.get(pageKey) ?? []).filter(task => task.language === target.language
      && (task.keywordId === target.keywordId || !task.keywordId || !target.keywordId)
      && task.keyword && growthWordKey(task.keyword) === growthWordKey(target.keyword));
    const task = matching.find(task => activeStatuses.has(task.status)) ?? matching[0];
    const business = matching.find(task => task.research?.businessValue != null)?.research?.businessValue ?? 0;
    const intent = matching.some(task => task.changeScope === "search_intent" && task.evidence.length && activeStatuses.has(task.status));
    const recentlyChanged = (changed.get(pageKey) ?? "") >= observationStart;
    const score = pageScore + (intent ? 45 : 0) + Math.max(0, business) * 5;
    const priority: PagePrioritySignal = recentlyChanged ? "观察中" : stale || (!enough && !intent) ? "待核实" : score >= high ? "高" : score >= 20 ? "中" : "低";
    if (filters.signal !== "all" && priority !== filters.signal) return [];
    counts[rankStatus]++;
    if (filters.rank !== "all" && rankStatus !== filters.rank) return [];
    const reasons = [
      ...(stale ? ["最新 GSC 完整数据偏旧"] : []),
      ...(recentlyChanged ? ["最近 7 个完整日内已有发布"] : []),
      ...(intent ? ["已有搜索意图不符证据"] : []),
      ...(business > 0 ? [`已登记业务价值 ${business}/3`] : []),
      ...pageReasons,
      ...(!enough ? ["同星期完整数据或页面曝光样本不足"] : []),
    ];
    return [{ url, current, previous, comparable, score, priority, reasons: reasons.length ? reasons : ["未达到当前提升或下滑规则"],
      keyword: target.keyword, targetId: target.id, rankStatus,
      rank: rankStatus === "ranked" ? target.rank : null, checkedAt: rankStatus === "pending" ? null : target.checkedAt,
      taskId: task?.id ?? null, taskWeek: task?.weekStart ?? null }];
  });
  recommendations.sort((a, b) => rankOrder[a.rankStatus] - rankOrder[b.rankStatus]
    || pagePrioritySignals.indexOf(a.priority) - pagePrioritySignals.indexOf(b.priority)
    || b.score - a.score || (b.current?.impressions ?? 0) - (a.current?.impressions ?? 0)
    || a.url.localeCompare(b.url) || a.targetId.localeCompare(b.targetId));
  return { site, country, latestDay: latestDay ?? null, property: property ?? null, pairedDays: pairs.length, recommendations, counts };
}

export function pageOptimizationPriorities(
  observations: AnalyticsObservation[], workflow: Pick<WorkflowSnapshot, "tasks" | "publications">, targets: GrowthTarget[],
  site: string, country: GrowthAnalysisCountry, now: Date, filters: PagePriorityFilters = { rank: "all", signal: "all", page: 1 },
) {
  const { recommendations, ...view } = pageOptimizationPriorityRows(observations, workflow, targets, site, country, now, filters);
  const { rows, ...pagination } = seoTablePage(recommendations, filters.page);
  return { ...view, rows, pagination };
}
