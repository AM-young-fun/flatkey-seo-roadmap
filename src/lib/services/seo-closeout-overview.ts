import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { isCurrentNativeRanking } from "../current-ranking-summary";
import type { GrowthWorkspace } from "../growth-types";
import { latestClosedLa7DayRange, seoToday, shiftDay, workWeekDateRange } from "../seo-date-range";
import { isSeoExtraCapacity } from "../seo-extra-capacity";
import { coreKeywordArchiveKind, coreKeywordArchiveSchema } from "../seo-core-keyword-evidence";
import { CLOSEOUT_CORE_BASELINE, closeoutBusinessWeeks, closeoutCoreGoals, closeoutCoreKey, closeoutCoreKeywords, closeoutMarketTargets } from "../seo-quarter-targets";
import { isExecutableWorkflowPlan, type WorkflowPlan, type WorkflowTask } from "../seo-workflow";
import { loadGrowthDashboardHistory } from "./growth-workspace";

type QueryMetric = { impressions: number; clicks: number; ctr: number | null; start: string; end: string; position?: number | null };
type AlternatePage = { url: string; clicks: number; impressions: number; position: number | null };
type QueryRow = { keyword: string; country: string; path: string; days: number; impressions: number | null; clicks: number | null };
type RepoData = Awaited<ReturnType<typeof loadGrowthDashboardHistory>>;

const pathKey = (value: string | null) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.pathname.replace(/\/$/, "") || "/";
  } catch { return null; }
};
const coreKeys = new Set<string>(closeoutCoreKeywords.map(word => closeoutCoreKey(word.country, word.language, word.keyword)));

export async function loadCloseoutOverview(localPreview: boolean, now = new Date()) {
  const baselines = new Map<string, QueryMetric>();
  const otherPages = new Map<string, AlternatePage[]>();
  if (localPreview) return { plans: [], tasks: [], publications: [], metrics: new Map<string, QueryMetric>(), baselines, otherPages, queryCheckedThrough: null };
  const end = latestClosedLa7DayRange(now).end, start = shiftDay(end, -27);
  const countries = [...new Set(closeoutCoreKeywords.map(word => word.country))];
  const [history, planRows, queryRows, receipts] = await Promise.all([
    loadGrowthDashboardHistory(),
    prisma.seoWorkflowRecord.findMany({ where: { kind: "plan", status: { in: ["scheduled", "reviewed"] } },
      select: { payload: true } }),
    prisma.$queryRaw<QueryRow[]>(Prisma.sql`
      WITH wanted(keyword, country, path) AS (
        VALUES ${Prisma.join(closeoutCoreKeywords.map(word => Prisma.sql`(${word.keyword}, ${word.country}, ${word.path})`))}
      ), reports AS (
        SELECT DISTINCT ON (date, payload->>'country') date, payload, payload->>'country' AS country
        FROM "SeoAnalyticsDay"
        WHERE date BETWEEN ${start} AND ${end}
          AND (kind = 'gsc-page-queries' OR kind LIKE 'gsc-page-queries:%')
          AND payload->>'kind' = 'gsc-page-queries' AND payload->>'property' = 'sc-domain:flatkey.ai'
          AND payload->>'country' IN (${Prisma.join(countries)})
        ORDER BY date, payload->>'country', payload->>'observedAt' DESC
      ), complete AS (
        SELECT country, COUNT(*)::int AS days FROM reports
        WHERE payload->>'complete' = 'true' GROUP BY country
      ), totals AS (
        SELECT wanted.keyword, wanted.country, wanted.path,
          SUM((item->>'impressions')::int)::int AS impressions, SUM((item->>'clicks')::int)::int AS clicks
        FROM reports
        CROSS JOIN LATERAL jsonb_array_elements(reports.payload->'rows') AS item
        JOIN wanted ON wanted.country = reports.country AND item->>'query' = wanted.keyword
          AND regexp_replace(split_part(split_part(item->>'url', '#', 1), '?', 1),
            '^https?://(www\\.)?flatkey\\.ai|/$', '', 'g') = wanted.path
        GROUP BY wanted.keyword, wanted.country, wanted.path
      )
      SELECT wanted.*, COALESCE(complete.days, 0) AS days, totals.impressions, totals.clicks
      FROM wanted LEFT JOIN complete USING (country)
      LEFT JOIN totals ON totals.keyword = wanted.keyword AND totals.country = wanted.country AND totals.path = wanted.path
    `).catch((): QueryRow[] => []),
    prisma.seoAnalyticsDay.findMany({ where: { kind: coreKeywordArchiveKind, date: { lte: end } },
      orderBy: { date: "desc" }, take: 1, select: { payload: true, date: true } }),
  ]);
  const metrics = new Map<string, QueryMetric>();
  for (const row of queryRows) {
    if (row.days === 28 && row.impressions !== null && row.clicks !== null) {
      metrics.set(`${row.country}:${row.keyword}`, { start, end, impressions: row.impressions, clicks: row.clicks,
        ctr: row.impressions ? 100 * row.clicks / row.impressions : null });
    }
  }
  const baselineReceipt = await prisma.seoAnalyticsDay.findUnique({ where: { kind_date: { kind: coreKeywordArchiveKind, date: CLOSEOUT_CORE_BASELINE.end } }, select: { payload: true } });
  const latestReceipt = coreKeywordArchiveSchema.safeParse(receipts[0]?.payload);
  if (latestReceipt.success) for (const row of latestReceipt.data.rows) {
    if (row.otherPages?.length) otherPages.set(`${row.country}:${row.keyword}`, row.otherPages);
  }
  for (const [target, receipt] of [[metrics, receipts[0]], [baselines, baselineReceipt]] as const) {
    const parsed = coreKeywordArchiveSchema.safeParse(receipt?.payload);
    if (!parsed.success) continue;
    for (const row of parsed.data.rows) {
      const key = `${row.country}:${row.keyword}`;
      if (target.has(key) || row.impressions === null || row.clicks === null) continue;
      const { start, end } = parsed.data;
      target.set(key, { start, end, impressions: row.impressions, clicks: row.clicks,
        ctr: row.impressions ? 100 * row.clicks / row.impressions : null, position: row.position });
    }
  }
  return { ...history, plans: planRows.map(row => row.payload as unknown as WorkflowPlan), metrics, baselines, otherPages, queryCheckedThrough: receipts[0]?.date ?? null };
}

export function closeoutCoreRead(data: GrowthWorkspace, metrics: ReadonlyMap<string, QueryMetric>, baselines: ReadonlyMap<string, QueryMetric>, otherPages: ReadonlyMap<string, AlternatePage[]>, queryCheckedThrough: string | null) {
  return closeoutCoreKeywords.map(word => {
    const candidates = data.targets.filter(target => target.site === "flatkey.ai" && target.keyword === word.keyword
      && target.country === word.country && target.language === word.language && pathKey(target.rankUrl) === word.path
      && isCurrentNativeRanking(target, data.generatedAt));
    const sample = candidates.sort((a, b) => (b.checkedAt ?? "").localeCompare(a.checkedAt ?? "") || a.rank! - b.rank!)[0];
    const key = `${word.country}:${word.keyword}`;
    const baseline = baselines.get(key) ?? ("baseline" in word ? word.baseline : null);
    return { keyword: word.keyword, country: word.country, language: word.language, url: "https://flatkey.ai" + word.path,
      rank: sample?.rank ?? null, rankObservedAt: sample?.checkedAt ?? null, rankTarget: word.rankTarget,
      baseline, goal: closeoutCoreGoals(word, baseline), metrics: metrics.get(key) ?? null, otherPages: otherPages.get(key) ?? [], queryCheckedThrough };
  });
}

function verified(task: RepoData["tasks"][number], publications: RepoData["publications"]) {
  return publications.some(row => row.taskId === task.id && row.status === "verified" && row.siteDomain === task.siteDomain
    && row.language === task.language && row.country === task.country && row.contentVersion === task.contentVersion
    && row.pageUrl === task.pageUrl);
}

export function ordinaryKeywordCoverage(plans: WorkflowPlan[], tasks: RepoData["tasks"], publications: RepoData["publications"], now: Date) {
  const today = seoToday(now), weekEnd = workWeekDateRange(today).end;
  const weeks = closeoutBusinessWeeks(), quarterStart = weeks[0].start, quarterEnd = weeks.at(-1)!.end;
  const through = weekEnd < quarterEnd ? weekEnd : quarterEnd;
  const planOwners = new Set(plans.filter(plan => isExecutableWorkflowPlan(plan.status)).flatMap(plan => plan.taskIds));
  const cohort = tasks.filter(task => planOwners.has(task.id) && ["blog", "landing", "cluster"].includes(task.kind)
    && task.workClass !== "content_refresh" && !isSeoExtraCapacity((task as WorkflowTask).capacityClass) && task.keyword
    && (task.siteDomain !== "flatkey.ai" || !coreKeys.has(closeoutCoreKey(task.country, task.language, task.keyword)))
    && seoToday(new Date(task.dueAt)) >= quarterStart && seoToday(new Date(task.dueAt)) <= through);
  const keys = new Map<string, boolean>();
  for (const task of cohort) {
    const key = [task.siteDomain, task.country, closeoutCoreKey(task.country, task.language, task.keyword!)].join("|");
    keys.set(key, Boolean(keys.get(key) || verified(task, publications)));
  }
  const groups = new Map<string, { site: string; country: string; due: number; covered: number }>();
  for (const [key, covered] of keys) {
    const [site, country] = key.split("|");
    const group = groups.get(`${site}:${country}`) ?? { site, country, due: 0, covered: 0 };
    group.due++;
    group.covered += Number(covered);
    groups.set(`${site}:${country}`, group);
  }
  const flatkeyCapacity = weeks.reduce((total, week) => total + week.flatkeyBlogs + week.flatkeyLandings, 0);
  const committed = tasks.filter(task => planOwners.has(task.id) && task.siteDomain === "flatkey.ai" && ["blog", "landing"].includes(task.kind)
    && task.workClass !== "content_refresh" && !isSeoExtraCapacity((task as WorkflowTask).capacityClass) && seoToday(new Date(task.dueAt)) >= quarterStart && seoToday(new Date(task.dueAt)) <= quarterEnd);
  const markets = closeoutMarketTargets(flatkeyCapacity).map(market => {
    const assigned = committed.filter(task => task.country === market.country && task.language === market.language).length;
    return { ...market, assigned, open: Math.max(0, market.target - assigned) };
  });
  return { through, due: keys.size, covered: [...keys.values()].filter(Boolean).length, groups: [...groups.values()], markets,
    totalCapacity: weeks.reduce((total, week) => total + week.newKeywords, 0) };
}
