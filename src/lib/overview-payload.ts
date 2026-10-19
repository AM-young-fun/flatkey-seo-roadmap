import type { DashboardKeyword, DashboardResponse, RankSummary } from "./types";
import { REGION_CODES, getRankBucket, type SearchRegionCode } from "./seo";
type GraphRank = [number | null, string | null];
export type OverviewPayload = Omit<DashboardResponse,"keywords"> & {format:"overview-v1"; keywords:Array<Omit<DashboardKeyword,"latestRanks"> & {latestRanks:Record<SearchRegionCode,GraphRank | null>}>};
/** Graphs need colours and names, not full query receipts repeated 6,516 times. */
export function overviewPayload(data: DashboardResponse): OverviewPayload {
  return {...data,format:"overview-v1",topics:[],keywords:data.keywords.map(keyword=>({
    id:keyword.id,text:keyword.text,type:keyword.type,topicId:keyword.topicId,topicText:keyword.topicText,siteDomain:keyword.siteDomain,siteName:keyword.siteName,
    parentId:keyword.parentId,parentIds:keyword.parentIds,active:keyword.active,lastSyncedAt:null,volume:keyword.volume,marketVolumes:keyword.marketVolumes,monitoringEligible:keyword.monitoringEligible,
    latestRanks:Object.fromEntries(REGION_CODES.map(region=>{
      const rank=keyword.latestRanks[region];
      return [region,rank ? [rank.rank,rank.rankStatus ?? null] : null];
    })) as Record<SearchRegionCode,GraphRank | null>,
  }))};
}
// Expand only in the overview client. Detail pages retain the complete persisted
// receipts, countries and page URLs and request only their ten visible words.
const isOverview = (data: DashboardResponse | OverviewPayload): data is OverviewPayload => "format" in data && data.format === "overview-v1";
export function hydrateOverviewPayload(data: DashboardResponse | OverviewPayload): DashboardResponse {
  if (!isOverview(data)) return data;
  return {...data,keywords:data.keywords.map(keyword=>({...keyword,latestRanks:Object.fromEntries(REGION_CODES.map(region=>{
    const value=keyword.latestRanks[region];
    const rank:RankSummary | null=value ? {rank:value[0],rankStatus:value[1] ?? undefined,source:"dataforseo_serp",bucket:getRankBucket(value[0]),url:null,title:null,searchVolume:null,checkedAt:null,previousRank:null,rankDelta:null,changed:false}:null;
    return [region,rank];
  })) as DashboardKeyword["latestRanks"]}))};
}
