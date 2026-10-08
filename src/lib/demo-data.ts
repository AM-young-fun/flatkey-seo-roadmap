import type { DashboardKeyword, DashboardResponse } from "@/lib/types";
import {
  demoRankFor,
  demoVolumeFor,
  getRankBucket,
  REGION_CODES,
  type SearchRegionCode
} from "@/lib/seo";

const DEMO_KEYWORDS: Array<Pick<DashboardKeyword, "id" | "text" | "type" | "parentId">> = [
  {
    id: "kw-main-seo-tools",
    text: "seo tools",
    type: "MAIN",
    parentId: null
  },
  {
    id: "kw-long-rank-tracker",
    text: "google rank tracker for agencies",
    type: "LONG_TAIL",
    parentId: "kw-main-seo-tools"
  },
  {
    id: "kw-long-keyword-monitor",
    text: "daily keyword ranking monitor",
    type: "LONG_TAIL",
    parentId: "kw-main-seo-tools"
  },
  {
    id: "kw-main-backlinks",
    text: "backlink checker",
    type: "MAIN",
    parentId: null
  },
  {
    id: "kw-long-ahrefs",
    text: "ahrefs keyword volume api",
    type: "LONG_TAIL",
    parentId: "kw-main-backlinks"
  },
  {
    id: "kw-main-local",
    text: "local seo reporting",
    type: "MAIN",
    parentId: null
  },
  {
    id: "kw-long-japan",
    text: "japan google seo rank tracking",
    type: "LONG_TAIL",
    parentId: "kw-main-local"
  }
];

function latestRanksFor(keyword: string) {
  return REGION_CODES.reduce(
    (accumulator, region) => {
      const rank = demoRankFor(keyword, region);
      const previousRank = demoRankFor(`${keyword}:yesterday`, region);
      const rankDelta = rank && previousRank ? previousRank - rank : null;

      accumulator[region] = {
        rank,
        bucket: getRankBucket(rank),
        url: rank ? `https://example.com/search/${encodeURIComponent(keyword)}` : null,
        title: rank ? `${keyword} - Example` : null,
        searchVolume: demoVolumeFor(keyword, region),
        checkedAt: new Date().toISOString(),
        previousRank,
        rankDelta,
        changed: rank !== previousRank
      };

      return accumulator;
    },
    {} as DashboardKeyword["latestRanks"]
  );
}

export function getDemoDashboard(): DashboardResponse {
  const keywords = DEMO_KEYWORDS.map((keyword) => {
    const latestRanks = latestRanksFor(keyword.text);
    const volumes = REGION_CODES.map(
      (region: SearchRegionCode) => latestRanks[region]?.searchVolume ?? 0
    );

    return {
      ...keyword,
      active: true,
      volume: Math.max(...volumes),
      latestRanks
    };
  });

  return {
    usingDemoData: true,
    targetDomain: process.env.SEO_TARGET_DOMAIN || "example.com",
    regions: REGION_CODES,
    keywords,
    latestRun: {
      id: "demo-run",
      status: "SUCCESS",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      provider: "demo",
      summary: {
        keywords: keywords.length,
        regions: REGION_CODES.length
      },
      errorMessage: null
    }
  };
}
