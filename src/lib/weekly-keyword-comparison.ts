import { normalizeKeywordText } from "./keyword-relevance";

export type WeeklyRankingReport = { siteDomain: string; region: string; source: string; date: Date; rankings: unknown };
export type WeeklyPageRank = { siteDomain: string; region: string; source: string; date: string; keyword: string; url: string; rank: number | null };
export type WeeklyKeywordComparison = {
  current: number; previous: number; entered: number; removed: number; net: number;
  buckets: { label: string; current: number; previous: number; delta: number; color: string }[];
  pageLosses: { url: string; siteDomain: string; lost: number; declined: number; keywords: string[]; regions: string[]; reasons: string[] }[];
  pageGains: { url: string; gained: number; improved: number; keywords: string[] }[];
  unattributed: number; comparedMarkets: number;
};
const key = (site: string, region: string, word: string) => `${site}:${region}:${normalizeKeywordText(word)}`;
const ranked = (value: number | undefined | null): value is number => value != null && Number.isFinite(value) && value >= 1 && value <= 100;
const buckets = [
  { label: "前10名", min: 1, max: 10, color: "#10b981" },
  { label: "11–30名", min: 10, max: 30, color: "#4385ff" },
  { label: "31–50名", min: 30, max: 50, color: "#f5a000" },
  { label: "51–100名", min: 50, max: 100, color: "#ff791b" },
];
function pageUrl(value: string, site: string) {
  try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || !(url.hostname === site || url.hostname.endsWith(`.${site}`))) return null;
    url.hash = ""; url.pathname = url.pathname.replace(/\/$/, "") || "/"; return url.href;
  } catch { return null; }
}

// Only exact endpoint reports paired by the caller enter this comparison.
// Missing reports never become zero rankings; historical absence stays distinct
// from an explicit outside-top100 record and from a missing page breakdown.
export function weeklyKeywordComparison(reports: WeeklyRankingReport[], eligible: Set<string>, start: string, end: string, pages: WeeklyPageRank[] = []): WeeklyKeywordComparison {
  const allowed = new Set([...eligible].map(value => {
    const [site, region, ...word] = value.split(":"); return key(site, region, word.join(":"));
  }));
  const scopes = new Set(reports.map(row => `${row.siteDomain}:${row.region}:${row.source}`));
  const scopeRanks = (day: string) => {
    const result = new Map<string, number>();
    for (const report of reports.filter(row => row.date.toISOString().slice(0, 10) === day)) {
      for (const row of report.rankings as { keyword: string; rank: number }[]) {
        const id = key(report.siteDomain, report.region, row.keyword);
        if (allowed.has(id) && Number.isFinite(row.rank) && row.rank >= 1) result.set(id, Math.min(result.get(id) ?? Infinity, row.rank));
      }
    }
    return result;
  };
  const priorScope = scopeRanks(start), currentScope = scopeRanks(end);
  const aggregate = (values: Map<string, number>) => {
    const result = new Map<string, number>();
    for (const [id, rank] of values) if (ranked(rank)) { const word = id.split(":").slice(2).join(":"); result.set(word, Math.min(result.get(word) ?? Infinity, rank)); }
    return result;
  };
  const before = aggregate(priorScope), after = aggregate(currentScope);
  const pageMap = (day: string) => {
    const result = new Map<string, WeeklyPageRank & { canonical: string }>();
    const seen = new Set<string>();
    // Database rows arrive newest first; never replace a newer receipt with an older one.
    for (const page of pages) {
      const id = key(page.siteDomain, page.region, page.keyword), canonical = pageUrl(page.url, page.siteDomain);
      if (page.date !== day || !canonical || !allowed.has(id) || !scopes.has(`${page.siteDomain}:${page.region}:${page.source}`) ) continue;
      const identity = `${id}\n${canonical}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (page.rank != null && Number.isFinite(page.rank) && page.rank >= 1) result.set(identity, { ...page, canonical });
    }
    return result;
  };
  const previousPages = pageMap(start), currentPages = pageMap(end);
  const currentPageWords = new Set([...currentPages.values()].filter(page => ranked(page.rank)).map(page => key(page.siteDomain, page.region, page.keyword)));
  const losses = new Map<string, { url: string; siteDomain: string; lostWords: Set<string>; declinedWords: Set<string>; keywords: Set<string>; regions: Set<string>; reasons: Set<string> }>();
  const attributed = new Set<string>();
  for (const [identity, previousPage] of previousPages) {
    const id = key(previousPage.siteDomain, previousPage.region, previousPage.keyword);
    if (!ranked(priorScope.get(id)) || !ranked(previousPage.rank)) continue;
    const currentPage = currentPages.get(identity), currentQuery = currentScope.get(id);
    const reason = currentPage ? currentPage.rank! > 100 ? "跌出前100" : currentPage.rank! > previousPage.rank! ? "名次下降" : null
      : currentQuery != null && currentQuery > 100 ? "跌出前100"
      : !currentScope.has(id) ? "本期报告未检出"
      : currentPageWords.has(id) ? "排名页面更换" : null;
    if (!reason) continue;
    const loss = losses.get(previousPage.canonical) ?? { url: previousPage.canonical, siteDomain: previousPage.siteDomain,
      lostWords: new Set<string>(), declinedWords: new Set<string>(), keywords: new Set<string>(), regions: new Set<string>(), reasons: new Set<string>() };
    (currentPage && ranked(currentPage.rank) ? loss.declinedWords : loss.lostWords).add(normalizeKeywordText(previousPage.keyword));
    loss.keywords.add(previousPage.keyword); loss.regions.add(previousPage.region); loss.reasons.add(reason);
    losses.set(previousPage.canonical, loss); attributed.add(id);
  }
  const gains = new Map<string, { url: string; gained: Set<string>; improved: Set<string>; keywords: Set<string> }>();
  for (const [identity, currentPage] of currentPages) {
    if (!ranked(currentPage.rank)) continue;
    const previousPage = previousPages.get(identity), word = normalizeKeywordText(currentPage.keyword);
    if (!previousPage && ranked(priorScope.get(key(currentPage.siteDomain, currentPage.region, currentPage.keyword)))) continue;
    if (ranked(previousPage?.rank) && currentPage.rank >= previousPage.rank) continue;
    const gain = gains.get(currentPage.canonical) ?? { url: currentPage.canonical, gained: new Set<string>(), improved: new Set<string>(), keywords: new Set<string>() };
    (ranked(previousPage?.rank) ? gain.improved : gain.gained).add(word); gain.keywords.add(currentPage.keyword);
    gains.set(currentPage.canonical, gain);
  }
  const removedScope = [...priorScope].filter(([id, value]) => ranked(value) && !ranked(currentScope.get(id))).map(([id]) => id);
  return {
    current: after.size, previous: before.size,
    entered: [...after.keys()].filter(word => !before.has(word)).length,
    removed: [...before.keys()].filter(word => !after.has(word)).length, net: after.size - before.size,
    buckets: buckets.map((bucket, index) => {
      const count = (values: Map<string, number>) => [...values.values()].filter(value => (index === 0 ? value >= bucket.min : value > bucket.min) && value <= bucket.max).length;
      const current = count(after), previous = count(before); return { label: bucket.label, current, previous, delta: current - previous, color: bucket.color };
    }),
    pageLosses: [...losses.values()].map(row => ({ url: row.url, siteDomain: row.siteDomain, lost: row.lostWords.size, declined: [...row.declinedWords].filter(word => !row.lostWords.has(word)).length,
      keywords: [...row.keywords].sort(), regions: [...row.regions].sort(), reasons: [...row.reasons].sort() }))
      .sort((a, b) => b.lost - a.lost || b.declined - a.declined || a.url.localeCompare(b.url)),
    pageGains: [...gains.values()].map(row => ({ url: row.url, gained: row.gained.size, improved: [...row.improved].filter(word => !row.gained.has(word)).length, keywords: [...row.keywords].sort() })).sort((a, b) => b.gained + b.improved - a.gained - a.improved || a.url.localeCompare(b.url)),
    unattributed: removedScope.filter(id => !attributed.has(id)).length, comparedMarkets: scopes.size,
  };
}
