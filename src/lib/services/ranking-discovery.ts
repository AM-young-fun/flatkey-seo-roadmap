import { prisma } from "@/lib/prisma";
import { buildRankingDiscovery } from "@/lib/ranking-discovery";
import type { DataForSeoNormalized } from "@/lib/dataforseo-labs.cjs";
import type { SearchRegionCode } from "@/lib/seo";
import type { RankingDiscoveryResponse } from "@/lib/ranking-discovery-types";

export async function loadRankingDiscovery(site: string, region: SearchRegionCode): Promise<RankingDiscoveryResponse> {
  if ((site !== "all" && site !== "flatkey.ai") || region !== "US") return buildRankingDiscovery(null, [], site, region);
  // This endpoint deliberately reads only already completed paid results. It
  // cannot access credentials, request a provider update or mutate the library.
  const [run, memberships] = await Promise.all([
    prisma.dataForSeoRun.findFirst({ where: { siteDomain: "flatkey.ai", status: "COMPLETED", collectedAt: { not: null }, normalized: { path: ["region"], equals: "US" } },
      orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }], select: { normalized: true } }),
    prisma.siteKeyword.findMany({ where: { siteDomain: "flatkey.ai" },
      select: { keywordId: true, active: true, pool: true, excludedAt: true, reviewStatus: true, keyword: { select: { text: true, active: true } } } }),
  ]);
  return buildRankingDiscovery(run?.normalized as unknown as DataForSeoNormalized | null, memberships, site, region);
}
