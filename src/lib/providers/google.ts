import type { GoogleRankResult } from "@/lib/types";
import {
  demoRankFor,
  REGIONS,
  type SearchRegionCode,
  urlMatchesDomain
} from "@/lib/seo";
import { envBool, envInt, envString } from "@/lib/env";

type SerpApiOrganicResult = {
  position?: number;
  link?: string;
  url?: string;
  title?: string;
};

type SerpApiResponse = {
  organic_results?: SerpApiOrganicResult[];
};

function timeoutSignal(milliseconds: number): AbortSignal {
  return AbortSignal.timeout(milliseconds);
}

function demoGoogleResult(keyword: string, region: SearchRegionCode): GoogleRankResult {
  const rank = demoRankFor(keyword, region);

  return {
    rank,
    url: rank ? `https://example.com/${encodeURIComponent(keyword)}` : null,
    title: rank ? `${keyword} - Example` : null,
    rawCount: rank ? 50 : 0,
    provider: "mock"
  };
}

export async function fetchGoogleRanking(
  keyword: string,
  region: SearchRegionCode,
  targetDomain: string
): Promise<GoogleRankResult> {
  const provider = envString("GOOGLE_SEARCH_PROVIDER", "serpapi");
  const apiKey = envString("SERPAPI_API_KEY");
  const disabled = envBool("DISABLE_EXTERNAL_FETCH", false);

  if (disabled || provider === "mock" || !apiKey || !targetDomain) {
    return demoGoogleResult(keyword, region);
  }

  if (provider !== "serpapi") {
    throw new Error(`Unsupported GOOGLE_SEARCH_PROVIDER: ${provider}`);
  }

  const regionConfig = REGIONS[region];
  const endpoint = envString("SERPAPI_ENDPOINT", "https://serpapi.com/search.json");
  const depth = envInt("GOOGLE_RESULTS_DEPTH", 50);
  const url = new URL(endpoint);

  url.searchParams.set("engine", "google");
  url.searchParams.set("q", keyword);
  url.searchParams.set("gl", regionConfig.gl);
  url.searchParams.set("hl", regionConfig.hl);
  url.searchParams.set("num", String(depth));
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url, {
    signal: timeoutSignal(envInt("GOOGLE_TIMEOUT_MS", 15000)),
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Google provider failed with ${response.status}`);
  }

  const payload = (await response.json()) as SerpApiResponse;
  const organicResults = payload.organic_results ?? [];
  const matched = organicResults.find((result) =>
    urlMatchesDomain(result.link ?? result.url, targetDomain)
  );

  return {
    rank: matched?.position ?? null,
    url: matched?.link ?? matched?.url ?? null,
    title: matched?.title ?? null,
    rawCount: organicResults.length,
    provider
  };
}
