import { buildSerpKeywordResults, type SerpKeywordResult, type SerpTaskRead } from "./serp-results";
import { isOwnedBrandKeyword } from "./keyword-market-policy";
import type { SerpTarget } from "./serp-targets";

/** Uses saved, language/device/depth-filtered provider receipts; never starts a paid query. */
export function digestRankingNotes(tasks: SerpTaskRead[], start: string, end: string): string[] {
  const from = Date.parse(start), until = Date.parse(end);
  const fresh = tasks.filter(task => task.runScope !== "SAMPLE" && task.checkedAt &&
    Date.parse(String(task.checkedAt instanceof Date ? task.checkedAt.toISOString() : task.checkedAt)) >= from &&
    Date.parse(String(task.checkedAt instanceof Date ? task.checkedAt.toISOString() : task.checkedAt)) < until);
  if (!fresh.length) return [];
  const rows: (SerpKeywordResult & { region: string })[] = [];
  for (const region of ["US", "JP", "BR", "ES"] as const) {
    const latest = fresh.filter(task => task.region === region).sort((a, b) => +new Date(b.runCreatedAt) - +new Date(a.runCreatedAt))[0];
    if (!latest) continue;
    const history = tasks.filter(task => task.region === region && +new Date(task.runCreatedAt) <= +new Date(latest.runCreatedAt));
    const targets = new Map<string, SerpTarget>();
    for (const task of history.filter(task => task.runId === latest.runId)) {
      if (isOwnedBrandKeyword(task.keyword)) continue;
      for (const value of Array.isArray(task.targetsJson) ? task.targetsJson : []) {
        if (!value || typeof value !== "object") continue;
        const target = value as Record<string, unknown>;
        if (typeof target.keywordId !== "string" || typeof target.siteDomain !== "string") continue;
        targets.set(`${target.siteDomain}:${target.keywordId}`, { keywordId: target.keywordId, keyword: task.keyword, siteDomain: target.siteDomain, targetUrls: [] });
      }
    }
    rows.push(...buildSerpKeywordResults([...targets.values()], history, { currentRunId: latest.runId }).map(row => ({ ...row, region })));
  }
  if (!rows.length) return [];
  const checked = rows.filter(row => row.status === "RANKED" || row.status === "OUTSIDE_TOP100");
  const ranked = checked.filter(row => row.rank !== null);
  const uniqueWords = new Set(ranked.map(row => row.keyword.normalize("NFKC").trim().toLocaleLowerCase("en-US")));
  const comparable = checked.filter(row => row.previousRankStatus !== null);
  const labels = (rank: number | null) => rank === null ? ">100" : String(rank);
  const result = [`本窗口有新回执；四国前100去重词 ${uniqueWords.size}，有效词×站×国家结果 ${checked.length}/${rows.length}，待核验 ${rows.length - checked.length}。自有品牌词已排除；未完成查询不算掉榜。`];
  for (const region of ["US", "JP", "BR", "ES"]) {
    const group = rows.filter(row => row.region === region);
    if (!group.length) continue;
    const ranks = group.filter(row => row.status === "RANKED");
    result.push(`${region} · 1–3: ${ranks.filter(row => row.rank! <= 3).length}，4–10: ${ranks.filter(row => row.rank! >= 4 && row.rank! <= 10).length}，11–20: ${ranks.filter(row => row.rank! >= 11 && row.rank! <= 20).length}，21–100: ${ranks.filter(row => row.rank! >= 21).length}；采集期 ${[...new Set(group.map(row => row.periodLabel ?? "未知"))].join("、")}。`);
  }
  if (comparable.length) result.push(`同词、同站、同国家可比子集 ${comparable.length} 项：前100 ${comparable.filter(row => row.previousRankStatus === "ranked").length}→${comparable.filter(row => row.status === "RANKED").length}；不把监控池增减算作排名增长。`);
  else result.push("尚无可比历史期，本期建立基线。");
  const boundary = (row: SerpKeywordResult) => (row.rank !== null && row.rank <= 10) !== (row.previousRank !== null && row.previousRank <= 10);
  for (const row of comparable.filter(row => row.movement !== "UNCHANGED").sort((a, b) => Number(boundary(b)) - Number(boundary(a)) || Math.abs((b.previousRank ?? 101) - (b.rank ?? 101)) - Math.abs((a.previousRank ?? 101) - (a.rank ?? 101))).slice(0, 6)) {
    const top10 = boundary(row) ? row.rank !== null && row.rank <= 10 ? " · 新进前10" : " · 掉出前10" : "";
    result.push(`${row.keyword} · ${row.region} · ${row.previousPeriodLabel}→${row.periodLabel} · ${labels(row.previousRank)}→${labels(row.rank)}${top10} · ${row.url ?? row.siteDomain + "（本期未进前100）"}`);
  }
  return result;
}
