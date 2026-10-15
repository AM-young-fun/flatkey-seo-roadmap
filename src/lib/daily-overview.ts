import type { DashboardKeyword, RankSummary } from "./types";
import type { DailySnapshot } from "./ranking-trends";
import { getRankBucket } from "./seo";

const wordKey = (site: string, word: string) => `${site}:${word.trim().toLowerCase()}`;

// Replace the day's ranks in full. Absence must never inherit a monthly rank.
export function dailyOverviewKeywords(inventory: DashboardKeyword[], snapshot: DailySnapshot): DashboardKeyword[] {
  const reports = new Map(snapshot.rankings.map(row => [wordKey(row.siteDomain, row.keyword), row]));
  const seen = new Set<string>();
  function summary(row: DailySnapshot["rankings"][number] | undefined): RankSummary | null {
    return row ? { rank: row.rank, bucket: getRankBucket(row.rank), source: row.source, rankStatus: "ranked", periodStart: snapshot.date, periodEnd: snapshot.date, checkedAt: row.collectedAt, dataUpdatedAt: snapshot.date, url: null, title: null, searchVolume: null, previousRank: null, rankDelta: null, changed: false } : null;
  }
  const keywords = inventory.map(keyword => {
    const key = wordKey(keyword.siteDomain ?? "flatkey.ai", keyword.text);
    const row = reports.get(key);
    seen.add(key);
    return {...keyword, latestRanks: {...keyword.latestRanks, [snapshot.region]: summary(row)}};
  });
  // Daily discovery can precede a vocabulary import. Keep those words visible
  // so the distribution and the curve count exactly the same report rows.
  for (const [key, row] of reports) {
    if (seen.has(key)) continue;
    keywords.push({ id:`daily:${key}`, text:row.keyword, type:"LONG_TAIL", topicId:null, topicText:"单日报告发现词", siteDomain:row.siteDomain, siteName:row.siteDomain, parentId:null, parentIds:[], active:true, lastSyncedAt:row.collectedAt, volume:0, marketVolumes:{US:null,JP:null,ES:null,BR:null}, latestRanks:{US:null,JP:null,ES:null,BR:null,[snapshot.region]:summary(row)} });
  }
  return keywords;
}
