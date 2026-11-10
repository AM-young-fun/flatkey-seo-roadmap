import { shiftDay, validRange } from "./seo-date-range";
export type OpportunityMarket = "US" | "JP" | "ES" | "BR";
export type KeywordInput = { text: string; siteDomain?: string; marketVolumes?: Partial<Record<OpportunityMarket, number | null>>; latestRanks?: Partial<Record<OpportunityMarket, { rank: number | null; rankStatus?: string; source?: string } | null>> };
export type KeywordMapping = { keyword: string; targetUrls?: string[] };
export type KeywordOpportunity = { key: string; keyword: string; volume: number | null; rank: number | null; rankState: string; urls: string[]; bestMarkets?: OpportunityMarket[] };
export type KeywordPlan = { role: "primary" | "supporting"; targetRank: "" | "10" | "5" | "3"; ctr: string; notes: string; updatedAt: string; optimizedAt?: string; changes?: string; baseline?: { siteRank: number | null; pageRank: null; rankUrl: null; volume: number | null; snapshotGeneratedAt: string | null; savedAt: string } };
const normalized = (term: string) => term.trim().replace(/\s+/g, " ").toLowerCase();
export function flatkeyPage(value: string): string | null {
  try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || !["flatkey.ai", "www.flatkey.ai"].includes(url.hostname) || url.username || url.password) return null; url.hash = ""; return url.toString(); } catch { return null; }
}
export function buildKeywordOpportunities(keywords: KeywordInput[], mappings: KeywordMapping[], country: OpportunityMarket): KeywordOpportunity[] {
  const rows = new Map<string, KeywordOpportunity>(), volumes = new Map<string, Set<number>>();
  const rowFor = (text: string) => { const key = normalized(text); let row = rows.get(key); if (!row) { row = { key, keyword: text.trim(), volume: null, rank: null, rankState: "missing", urls: [] }; rows.set(key, row); } return row; };
  for (const keyword of keywords) {
    if (keyword.siteDomain !== "flatkey.ai" || !normalized(keyword.text)) continue;
    const row = rowFor(keyword.text), volume = keyword.marketVolumes?.[country], rank = keyword.latestRanks?.[country];
    if (typeof volume === "number" && Number.isFinite(volume) && volume >= 0) { const known = volumes.get(row.key) ?? new Set<number>(); known.add(volume); volumes.set(row.key, known); }
    if (rank?.source === "dataforseo_serp") {
      if (rank.rankStatus === "ranked" && rank.rank != null && rank.rank >= 1 && rank.rank <= 100) { row.rank = row.rank == null ? rank.rank : Math.min(row.rank, rank.rank); row.rankState = "ranked"; }
      else if (row.rank == null) row.rankState = rank.rankStatus ?? "missing";
    }
  }
  for (const mapping of mappings) {
    if (!normalized(mapping.keyword)) continue;
    const urls = (mapping.targetUrls ?? []).map(flatkeyPage).filter((url): url is string => Boolean(url));
    if (!urls.length && !rows.has(normalized(mapping.keyword))) continue;
    const row = rowFor(mapping.keyword); row.urls = [...new Set([...row.urls, ...urls])];
  }
  for (const row of rows.values()) { const known = volumes.get(row.key); row.volume = known?.size === 1 ? [...known][0] : null; }
  return [...rows.values()];
}

export function combineKeywordMarkets(markets: ReadonlyMap<OpportunityMarket, KeywordOpportunity[]>): KeywordOpportunity[] {
  const combined = new Map<string, KeywordOpportunity>();
  for (const [market, rows] of markets) {
    for (const row of rows) {
      const entry = combined.get(row.key) ?? { ...row, volume: null, rank: null, rankState: "missing", bestMarkets: [] };
      if (row.volume !== null) entry.volume = (entry.volume ?? 0) + row.volume;
      if (row.rank !== null && (entry.rank === null || row.rank < entry.rank)) {
        entry.rank = row.rank;
        entry.rankState = "ranked";
        entry.bestMarkets = [market];
      } else if (row.rank !== null && row.rank === entry.rank) {
        entry.bestMarkets?.push(market);
      }
      combined.set(row.key, entry);
    }
  }
  return [...combined.values()];
}
export function estimateMonthlyClicks(volume: number | null, ctr: string): number | null {
  if (volume == null || !Number.isFinite(volume) || volume < 0 || !ctr.trim()) return null;
  const value = Number(ctr); return Number.isFinite(value) && value >= 0 && value <= 100 ? volume * value / 100 : null;
}
export function opportunityReason(row: KeywordOpportunity): string {
  if (row.rank == null) return "排名待核查；先确认搜索意图和目标页面。";
  if (row.rank >= 11 && row.rank <= 20) return "接近首页，需核查意图与竞争。";
  if (row.rank <= 10) return "已有首页排名，可核查标题点击率与内容完整度。";
  return "排名距首页较远，需先核查内容匹配、竞争与内链。";
}
export function planKey(country: OpportunityMarket, keyword: string, page: string) { return JSON.stringify([country, normalized(keyword), page]); }
export function rankText(row: KeywordOpportunity): string { return row.rank != null ? `第 ${row.rank} 名` : row.rankState === "outside_top100" ? "100 名外" : row.rankState === "not_found_capture" ? "本次未命中" : row.rankState === "query_changed" ? "查询被改写" : "待采集"; }

export function optimizationWindow(optimizedAt: string, days: 7 | 14 | 28 | 56, today: string) {
  if (!validRange({ start: optimizedAt, end: optimizedAt }) || !validRange({ start: today, end: today })) return null;
  const start = shiftDay(optimizedAt, 1), end = [shiftDay(start, days - 1), shiftDay(today, -1)].sort()[0];
  if (start > end) return null;
  const count = (Date.parse(end) - Date.parse(start)) / 86400000 + 1, compareEnd = shiftDay(optimizedAt, -1);
  return { start, end, compareStart: shiftDay(compareEnd, 1 - count), compareEnd, days: count };
}

export type OpportunitySort = "opportunity" | "volume" | "volume-asc" | "rank-asc" | "rank-desc";

export function sortKeywordOpportunities(rows: KeywordOpportunity[], mode: OpportunitySort = "opportunity"): KeywordOpportunity[] {
  const band = (row: KeywordOpportunity) => {
    if (!row.urls.length || row.rank == null) return 3;
    if (row.rank >= 4 && row.rank <= 20) return 0;
    if (row.rank >= 21 && row.rank <= 50) return 1;
    if (row.rank >= 1 && row.rank <= 3) return 2;
    return 3;
  };
  const metric = mode === "rank-asc" || mode === "rank-desc" ? "rank" : "volume";
  const direction = mode === "volume-asc" || mode === "rank-asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (mode === "opportunity" && band(a) !== band(b)) return band(a) - band(b);
    const first = a[metric], second = b[metric];
    if (first === null && second !== null) return 1;
    if (second === null && first !== null) return -1;
    return (first !== null && second !== null ? direction * (first - second) : 0)
      || a.keyword.localeCompare(b.keyword);
  });
}
