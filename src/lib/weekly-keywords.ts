import { compareCaptures } from "@/lib/daily-changes";
import { REGION_CODES } from "@/lib/seo";
import { weeklyKeywordComparison, type WeeklyPageRank } from "./weekly-keyword-comparison";

type Report = { siteDomain: string; region: string; source: string; date: Date; rankings: unknown };
const domains = ["flatkey.ai", "rackrate.org", "modelfit.cc"];
export function compareWeeklyRankings(reports: Report[], eligible: Set<string>, start: string, end: string, pages: WeeklyPageRank[] = []) {
  const pairedReports: Report[] = [];
  const results: ReturnType<typeof compareCaptures>[] = [];
  const keywords = new Map<string, string>();
  const siteCaptures: { site: string; source: string; date: string; previousDate: string; baseline: boolean }[] = [];
  const pendingMarkets: string[] = [];
  for (const site of domains) for (const region of REGION_CODES) {
    const pair = ["gsc", "ahrefs"].map(source => ({ source,
      first: reports.find(row=>row.siteDomain===site && row.region===region && row.source===source && row.date.toISOString().slice(0,10)===start),
      last: reports.find(row=>row.siteDomain===site && row.region===region && row.source===source && row.date.toISOString().slice(0,10)===end),
    })).find(pair=>pair.first && pair.last);
    if (!pair) { pendingMarkets.push(`${site} · ${region}`); continue; }
    pairedReports.push(pair.first!, pair.last!);
    const ranks = (report: Report) => (report.rankings as { keyword: string; rank: number }[]).map(row=>{
      const id = `${site}:${region}:${row.keyword.toLowerCase()}`;
      keywords.set(id, `${row.keyword} · ${site} · ${region}`);
      return { keywordId: id, rank: row.rank, rankStatus: row.rank<=100 ? "ranked" : "outside_top100" };
    });
    results.push(compareCaptures(ranks(pair.last!), ranks(pair.first!), eligible));
    siteCaptures.push({ site: `${site} · ${region}`, source: pair.source, date: end, previousDate: start, baseline: false });
  }
  const joined = (field: "entered"|"lost"|"missing") => results.flatMap(result=>result[field]);
  return { comparison: pairedReports.length ? weeklyKeywordComparison(pairedReports, eligible, start, end, pages) : null, daily: results.length ? {
    count: results.reduce((sum,result)=>sum+result.count,0), baseline:false,
    entered: joined("entered"), lost: joined("lost"), missing: joined("missing"),
    detectedReduction: results.reduce((sum,result)=>sum+(result.detectedReduction??0),0),
    net: results.reduce((sum,result)=>sum+(result.net??0),0),
    date:end, previousDate:start, unknownVolume:0, siteCaptures, pendingMarkets,
    pendingSites:domains.filter(domain=>!siteCaptures.some(row=>row.site.startsWith(`${domain} ·`))),
  } : null, keywords:[...keywords].map(([id,text])=>({id,text})) };
}
