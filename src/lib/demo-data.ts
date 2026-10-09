import type { DashboardKeyword, DashboardResponse, DashboardTopic } from "@/lib/types";
import {
  demoRankFor,
  demoVolumeFor,
  getRankBucket,
  REGION_CODES,
  type SearchRegionCode
} from "@/lib/seo";

const DEMO_TOPICS: DashboardTopic[] = [
  {
    id: "topic-main-seo-tools",
    text: "seo tools",
    type: "MAIN",
    parentId: null,
    parentIds: [],
    active: true,
    volume: 0,
    marketVolumes: emptyMarketVolumes()
  },
  {
    id: "topic-sub-rank-tracking",
    text: "rank tracking",
    type: "SUB_TOPIC",
    parentId: "topic-main-seo-tools",
    parentIds: ["topic-main-seo-tools"],
    active: true,
    volume: 0,
    marketVolumes: emptyMarketVolumes()
  },
  {
    id: "topic-main-backlinks",
    text: "backlink research",
    type: "MAIN",
    parentId: null,
    parentIds: [],
    active: true,
    volume: 0,
    marketVolumes: emptyMarketVolumes()
  }
];

const DEMO_KEYWORDS: Array<
  Pick<DashboardKeyword, "id" | "text" | "type" | "topicId" | "topicText" | "parentId">
> = [
  {
    id: "kw-main-seo-tools",
    text: "seo rank tracker",
    type: "MAIN",
    topicId: "topic-sub-rank-tracking",
    topicText: "rank tracking",
    parentId: null
  },
  {
    id: "kw-long-rank-tracker",
    text: "google rank tracker for agencies",
    type: "LONG_TAIL",
    topicId: "topic-sub-rank-tracking",
    topicText: "rank tracking",
    parentId: "kw-main-seo-tools"
  },
  {
    id: "kw-long-keyword-monitor",
    text: "daily keyword ranking monitor",
    type: "LONG_TAIL",
    topicId: "topic-sub-rank-tracking",
    topicText: "rank tracking",
    parentId: "kw-main-seo-tools"
  },
  {
    id: "kw-main-backlinks",
    text: "backlink checker",
    type: "MAIN",
    topicId: "topic-main-backlinks",
    topicText: "backlink research",
    parentId: null
  },
  {
    id: "kw-long-ahrefs",
    text: "ahrefs keyword volume api",
    type: "LONG_TAIL",
    topicId: "topic-main-backlinks",
    topicText: "backlink research",
    parentId: "kw-main-backlinks"
  },
  {
    id: "kw-main-local",
    text: "local seo reporting",
    type: "MAIN",
    topicId: "topic-main-seo-tools",
    topicText: "seo tools",
    parentId: null
  },
  {
    id: "kw-long-japan",
    text: "japan google seo rank tracking",
    type: "LONG_TAIL",
    topicId: "topic-sub-rank-tracking",
    topicText: "rank tracking",
    parentId: "kw-main-local"
  }
];

function emptyMarketVolumes(): DashboardKeyword["marketVolumes"] {
  return REGION_CODES.reduce(
    (accumulator, region) => {
      accumulator[region] = null;
      return accumulator;
    },
    {} as DashboardKeyword["marketVolumes"]
  );
}

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
    const marketVolumes = REGION_CODES.reduce(
      (accumulator, region: SearchRegionCode) => {
        accumulator[region] = latestRanks[region]?.searchVolume ?? null;
        return accumulator;
      },
      {} as DashboardKeyword["marketVolumes"]
    );
    const volumes = REGION_CODES.map((region: SearchRegionCode) => marketVolumes[region] ?? 0);

    return {
      ...keyword,
      parentIds: keyword.parentId ? [keyword.parentId] : [],
      active: true,
      lastSyncedAt: new Date().toISOString(),
      volume: Math.max(...volumes),
      marketVolumes,
      latestRanks
    };
  });
  const topics = DEMO_TOPICS.map((topic) => {
    const marketVolumes = emptyMarketVolumes();

    for (const region of REGION_CODES) {
      marketVolumes[region] = keywords
        .filter((keyword) => keyword.topicId === topic.id)
        .reduce((sum, keyword) => sum + (keyword.marketVolumes[region] ?? 0), 0);
    }

    return {
      ...topic,
      volume: Math.max(...REGION_CODES.map((region) => marketVolumes[region] ?? 0)),
      marketVolumes
    };
  });

  return {
    usingDemoData: true,
    targetDomain: process.env.SEO_TARGET_DOMAIN || "example.com",
    regions: REGION_CODES,
    topics,
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
