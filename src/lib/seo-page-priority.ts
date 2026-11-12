import type { AnalyticsObservation } from "./seo-analytics";
import { completeGscReports, gscDate } from "./seo-page-effects";
import { shiftDay } from "./seo-date-range";
import type { SeoCountry } from "./seo";
import type { WorkflowSnapshot } from "./seo-workflow";

type Period = { clicks: number; impressions: number; position: number | null };
const band = (rank: number) => rank < 4 ? "1–3" : rank < 11 ? "4–10" : rank < 21 ? "11–20" : rank < 51 ? "21–50" : "51+";
const high = 40;
const activeStatuses = new Set(["planned", "researching", "ready", "drafting", "review_pending", "approved", "published"]);

export function pageOptimizationPriorities(
  observations: AnalyticsObservation[], workflow: Pick<WorkflowSnapshot, "tasks" | "publications">,
  site: string, country: SeoCountry, now: Date,
) {
  const end = shiftDay(gscDate(now), -1);
  const reports = completeGscReports(observations, site, country, { start: shiftDay(end, -34), end }, now);
  const property = [...new Set(reports.map(row => row.property))].sort((a, b) =>
    (reports.filter(row => row.property === b).at(-1)?.date ?? "").localeCompare(reports.filter(row => row.property === a).at(-1)?.date ?? "")
    || Number(b.startsWith("sc-domain:")) - Number(a.startsWith("sc-domain:")))[0];
  const byDate = new Map(reports.filter(row => row.property === property).map(row => [row.date, new Map(row.rows.map(page => [page.url, page]))]));
  const latestDay = [...byDate.keys()].at(-1);
  const pairs = latestDay ? Array.from({ length: 7 }, (_, i) => shiftDay(latestDay, -i))
    .filter(day => byDate.has(day) && byDate.has(shiftDay(day, -7))) : [];
  const tasks = workflow.tasks.filter(task => task.siteDomain === site && (task.country ?? "all") === country && task.kind === "optimization");
  const tasksByPage = new Map<string, typeof tasks>();
  for (const task of tasks) {
    if (!task.pageUrl) continue;
    const existing = tasksByPage.get(task.pageUrl) ?? [];
    existing.push(task);
    tasksByPage.set(task.pageUrl, existing);
  }
  const recentDates = latestDay ? Array.from({ length: 14 }, (_, i) => shiftDay(latestDay, -i)) : [];
  const pages = [...new Set([...tasksByPage.keys(), ...recentDates.flatMap(day => [...(byDate.get(day)?.keys() ?? [])])])];
  const changed = new Map<string, string>();
  for (const row of workflow.publications) {
    if (row.siteDomain !== site || (row.country ?? "all") !== country || row.status !== "verified" || Date.parse(row.publishedAt) > now.getTime()) continue;
    const day = gscDate(new Date(row.publishedAt));
    if (day > (changed.get(row.pageUrl) ?? "")) changed.set(row.pageUrl, day);
  }
  const aggregate = (url: string, days: string[]): Period => {
    const rows = days.map(day => byDate.get(day)!.get(url)!);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    return { clicks: rows.reduce((sum, row) => sum + row.clicks, 0), impressions,
      position: impressions && rows.every(row => !row.impressions || row.position !== null)
        ? rows.reduce((sum, row) => sum + row.impressions * (row.position ?? 0), 0) / impressions : null };
  };
  const observed = pages.map(url => {
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
  const rows = observed.map(row => {
    const { url, current, previous, comparable } = row;
    const matchingTasks = tasksByPage.get(url) ?? [];
    const task = matchingTasks.find(task => activeStatuses.has(task.status)) ?? matchingTasks[0];
    const business = matchingTasks.find(task => task.research?.businessValue != null)?.research?.businessValue ?? null;
    const intent = matchingTasks.find(task => task.changeScope === "search_intent" && task.evidence.length && activeStatuses.has(task.status));
    const recentlyChanged = (changed.get(url) ?? "") >= shiftDay(end, -7);
    const stale = !latestDay || latestDay < shiftDay(end, -4);
    const reasons: string[] = [];
    let score = 0;
    const enough = comparable >= 4 && current && previous && current.impressions >= 40 && previous.impressions >= 40;
    if (intent) { score += 45; reasons.push("已有搜索意图不符证据"); }
    if (business != null && business > 0) { score += business * 5; reasons.push("已登记业务价值 " + business + "/3"); }
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
    const priority = recentlyChanged ? "观察中" : stale || (!enough && !intent) ? "待核实" : score >= high ? "高" : score >= 20 ? "中" : "低";
    if (recentlyChanged) reasons.unshift("最近 7 个完整日内已有发布");
    if (stale) reasons.unshift("最新 GSC 完整数据偏旧");
    if (!enough) reasons.push("同星期完整数据或页面曝光样本不足");
    if (!reasons.length) reasons.push("未达到当前提升或下滑规则");
    return { url, current, previous, comparable, score, priority, reasons, taskId: task?.id ?? null, taskWeek: task?.weekStart ?? null, keyword: task?.keyword ?? null };
  });
  const order: Record<string, number> = { "高": 0, "中": 1, "低": 2, "观察中": 3, "待核实": 4 };
  rows.sort((a, b) => order[a.priority] - order[b.priority] || b.score - a.score || (b.current?.impressions ?? 0) - (a.current?.impressions ?? 0) || a.url.localeCompare(b.url));
  return { site, country, latestDay: latestDay ?? null, property: property ?? null, pairedDays: pairs.length, rows };
}
