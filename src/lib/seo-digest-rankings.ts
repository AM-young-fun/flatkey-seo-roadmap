import { buildSerpKeywordResults, type SerpKeywordResult, type SerpTaskRead } from "./serp-results";
import { isOwnedBrandKeyword } from "./keyword-market-policy";
import type { SerpTarget } from "./serp-targets";
import { serpCaptureBelongsToWeek } from "./serp-periods";
import type { GrowthTarget, GrowthWorkspace } from "./growth-types";

/** Uses saved, language/device/depth-filtered provider receipts; never starts a paid query. */
export function digestRankingNotes(tasks: SerpTaskRead[], start: string, end: string, asOf?: Date): string[] {
  const from = Date.parse(start), until = Date.parse(end);
  const laDate = (value: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(value));
  const fresh = tasks.filter(task => task.runScope !== "SAMPLE" && task.checkedAt &&
    Date.parse(String(task.checkedAt instanceof Date ? task.checkedAt.toISOString() : task.checkedAt)) >= from &&
    (!asOf || +new Date(task.checkedAt) <= asOf.getTime()) &&
    (asOf && task.runScope === "SCHEDULED"
      ? !!task.periodKey && serpCaptureBelongsToWeek(task.periodKey, laDate(from), laDate(until - 1))
      : +new Date(task.checkedAt) < until));
  if (!fresh.length) return [];
  const receiptKey = (row: { runId: string | null; providerTaskId: string | null; checkedAt: Date | string | null }) =>
    JSON.stringify([row.runId, row.providerTaskId, row.checkedAt ? +new Date(row.checkedAt) : null]);
  const received = new Set(fresh.filter(task => {
    const normalized = task.normalizedJson && typeof task.normalizedJson === "object"
      ? task.normalizedJson as Record<string, unknown> : null;
    return typeof task.providerTaskId === "string" && /^[a-zA-Z0-9-]{5,100}$/.test(task.providerTaskId)
      && Array.isArray(normalized?.organicResults);
  }).map(receiptKey));
  const rows: (SerpKeywordResult & { region: string })[] = [];
  for (const region of ["US", "JP", "BR", "ES"] as const) {
    const latest = fresh.filter(task => task.region === region).sort((a, b) => +new Date(b.runCreatedAt) - +new Date(a.runCreatedAt))[0];
    if (!latest) continue;
    const history = tasks.filter(task => task.region === region && +new Date(task.runCreatedAt) <= +new Date(latest.runCreatedAt)
      && (!asOf || !task.checkedAt || +new Date(task.checkedAt) <= asOf.getTime()));
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
  // An attempted/submitted query is not a received search result. Reuse the
  // result normalizer's modern/legacy capture guard, bound to this window's
  // actual provider receipt; pending/failed diagnostics alone stay internal.
  if (!rows.some(row => row.captureComplete && received.has(receiptKey(row)))) return [];
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
  if (comparable.length) {
    const previousTop10 = comparable.filter(row => row.previousRank !== null && row.previousRank <= 10).length;
    const currentTop10 = comparable.filter(row => row.rank !== null && row.rank <= 10).length;
    result.push(`同词、同站、同国家可比子集 ${comparable.length} 项：前100 ${comparable.filter(row => row.previousRankStatus === "ranked").length}→${comparable.filter(row => row.status === "RANKED").length}，前10 ${previousTop10}→${currentTop10}；不把监控池增减算作排名增长。`);
  }
  else result.push("尚无可比历史期，本期建立基线。");
  const boundary = (row: SerpKeywordResult) => (row.rank !== null && row.rank <= 10) !== (row.previousRank !== null && row.previousRank <= 10);
  for (const row of comparable.filter(row => row.movement !== "UNCHANGED").sort((a, b) => Number(boundary(b)) - Number(boundary(a)) || Math.abs((b.previousRank ?? 101) - (b.rank ?? 101)) - Math.abs((a.previousRank ?? 101) - (a.rank ?? 101))).slice(0, 6)) {
    const top10 = boundary(row) ? row.rank !== null && row.rank <= 10 ? " · 新进前10" : " · 掉出前10" : "";
    result.push(`${row.keyword} · ${row.region} · ${row.previousPeriodLabel}→${row.periodLabel} · ${labels(row.previousRank)}→${labels(row.rank)}${top10} · ${row.url ?? row.siteDomain + "（本期未进前100）"}`);
  }
  return result;
}

const marketNames = { US: "美国", JP: "日本", ES: "西班牙", BR: "巴西" } as const;

/** Daily capture facts use the same all-membership saved-evidence projection as
 * growth reports. This includes diagnostic receipts and never queries a provider. */
export function digestDailyNativeRankingNotes(workspace: GrowthWorkspace, day: string): string[] {
  const asOf = Date.parse(workspace.generatedAt), format = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(asOf)) return [];
  const urlFor = (target: GrowthTarget) => {
    if (!target.rankUrl) return null;
    try { const url = new URL(target.rankUrl); return url.protocol === "https:" && !url.username && !url.password && !url.port && [target.site, "www." + target.site].includes(url.hostname) ? url.href : null; } catch { return null; }
  };
  const keyWord = (word: string) => word.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const rows = new Map<string, GrowthTarget>();
  for (const target of workspace.targets) {
    const checkedAt = target.checkedAt ? Date.parse(target.checkedAt) : NaN;
    if (!["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(target.site) || target.rankSource !== "serp" || target.languageStatus !== "match" || !target.country || !target.language || isOwnedBrandKeyword(target.keyword)
      || !Number.isFinite(checkedAt) || checkedAt > asOf || asOf - checkedAt > 14 * 86400000 || format.format(new Date(checkedAt)) !== day) continue;
    const ranked = target.rankEligible && target.observationEligible && target.captureState === "ranked" && target.rank !== null && target.rank >= 1 && target.rank <= 100 && urlFor(target);
    const outside = target.observationEligible && target.captureState === "outside100" && target.rank === null;
    if (!ranked && !outside) continue;
    const key = JSON.stringify([target.site, keyWord(target.keyword), target.country, target.language.toLowerCase()]);
    const previous = rows.get(key);
    if (!previous || checkedAt > Date.parse(previous.checkedAt!) || checkedAt === Date.parse(previous.checkedAt!) && (target.rank ?? 101) < (previous.rank ?? 101)) rows.set(key, target);
  }
  if (!rows.size) return [];
  const checked = [...rows.values()], ranked = checked.filter(row => row.rank !== null), top50 = ranked.filter(row => row.rank! <= 50);
  const words = new Set(ranked.map(row => keyWord(row.keyword)));
  const formal = ranked.filter(row => row.membership === "formal").length;
  const notes = [`洛杉矶 ${day} 新采集回执：前100有排名 ${ranked.length} 个组合（关键词×站点×国家×语言），去重原词 ${words.size} 个；前50 ${top50.length} 个组合。完整核验 ${checked.length} 个组合，确认前100外 ${checked.length - ranked.length} 个。`];
  notes.push(`覆盖全部已存合格SERP：正式规划有排名 ${formal} 个组合，机会及待归类 ${ranked.length - formal} 个组合；仅统计本日原词原国家、语种合格的 Google 桌面实测，不混入旧日、数据库或GSC平均位置。`);
  const names: Record<string, string> = { ...marketNames, SG: "新加坡", CN: "中国", FR: "法国", DE: "德国", RU: "俄罗斯", VN: "越南", ID: "印度尼西亚" };
  for (const country of [...new Set(checked.map(row => row.country!))].sort()) {
    const group = ranked.filter(row => row.country === country), all = checked.filter(row => row.country === country);
    notes.push(`${names[country] ?? country} ${country} · ${[...new Set(all.map(row => row.language))].sort().join("/")}：前100 ${group.length}，前50 ${group.filter(row => row.rank! <= 50).length}，前10 ${group.filter(row => row.rank! <= 10).length}，确认前100外 ${all.length - group.length} 个组合。`);
  }
  const examples = [...ranked].sort((a, b) => a.rank! - b.rank! || a.keyword.localeCompare(b.keyword) || a.site.localeCompare(b.site));
  const selected: GrowthTarget[] = [], countries = new Set<string>();
  for (const row of examples) if (!countries.has(row.country!)) { selected.push(row); countries.add(row.country!); if (selected.length === 5) break; }
  for (const row of examples) { if (selected.length >= Math.min(5, examples.length)) break; if (!selected.includes(row)) selected.push(row); }
  for (const row of selected) notes.push(`[${row.keyword.replace(/[\r\n[\]`*_<>]/g, " ")}](${urlFor(row)!.replace(/\(/g, "%28").replace(/\)/g, "%29")}) · ${row.country}/${row.language} · 第 ${row.rank} 名 · LA ${day}`);
  return notes;
}

export function digestDailyRankingNotes(tasks: SerpTaskRead[], now: Date, day?: string): string[] {
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: day ? "America/Los_Angeles" : "Asia/Shanghai" });
  const rows: string[] = [];
  for (const region of ["US", "JP", "ES", "BR"] as const) {
    const history = tasks.filter(task => task.region === region && task.checkedAt && +new Date(task.checkedAt) <= +now);
    const visits = [...new Map(history.filter(task => !day || localDate.format(new Date(task.checkedAt!)) === day).map(task => [task.runId, task])).values()].sort((a, b) =>
      Number(a.runScope === "SAMPLE") - Number(b.runScope === "SAMPLE") || +new Date(b.runCreatedAt) - +new Date(a.runCreatedAt));
    for (const run of visits) {
      const targets = new Map<string, SerpTarget>();
      for (const task of history.filter(row => row.runId === run.runId)) {
        if (isOwnedBrandKeyword(task.keyword)) continue;
        for (const value of Array.isArray(task.targetsJson) ? task.targetsJson : []) {
          if (value?.siteDomain === "flatkey.ai" && typeof value.keywordId === "string") {
            targets.set(value.keywordId, { keywordId: value.keywordId, keyword: task.keyword, siteDomain: value.siteDomain, targetUrls: [] });
          }
        }
      }
      const results = buildSerpKeywordResults([...targets.values()], history, { currentRunId: run.runId })
        .filter(row => row.runId === run.runId && row.checkedAt && row.captureComplete && (!day || localDate.format(new Date(row.checkedAt)) === day));
      const ranked = results.filter(row => row.status === "RANKED" && row.rank !== null && row.url);
      const outside = results.filter(row => row.status === "OUTSIDE_TOP100").length;
      if (!ranked.length && !outside) continue;
      const inTop10 = ranked.filter(row => row.rank! <= 10).length;
      const uncertain = results.length - ranked.length - outside;
      const examples = ranked.sort((a, b) => a.rank! - b.rank! || a.keyword.localeCompare(b.keyword)).slice(0, 1);
      const dates = [...new Set(results.map(row => localDate.format(new Date(row.checkedAt!))))].sort();
      const range = dates.length === 1 ? dates[0] : `${dates[0]}—${dates.at(-1)}`;
      rows.push(`${marketNames[region]} · Google 桌面端 ${range} · ${run.runScope === "SAMPLE" ? "抽样返回" : "返回"} ${results.length}/${targets.size} 词 · 查到排名 ${ranked.length}（前十 ${inTop10}） · 确认前100外 ${outside} · 无法确认 ${uncertain}`);
      for (const row of examples) {
        const movement = row.previousRank !== null && row.previousRank !== row.rank ? `（此前第 ${row.previousRank} 名）` : "";
        const page = new URL(row.url!).pathname;
        rows.push(`  ${row.keyword} · 第 ${row.rank} 名${movement} · ${page} · ${localDate.format(new Date(row.checkedAt!))}`);
      }
      break;
    }
  }
  return rows;
}
