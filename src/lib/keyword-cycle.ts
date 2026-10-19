import { serpPeriod } from "./serp-periods";
import { REGION_CODES } from "./seo";
import { SERP_TARGET_SITES } from "./serp-targets";
import { quoteForLimit, buildRankedKeywordsTask } from "./dataforseo-labs.cjs";
import { keywordRelevance, normalizeKeywordText } from "./keyword-relevance";

export function keywordCyclePlan(now = new Date()) {
  const period = serpPeriod(now), limit = 1000;
  const jobs = SERP_TARGET_SITES.flatMap(targetDomain => REGION_CODES.map(region => {
    const requestId = `discovery-${period.key}-${targetDomain.replace(/\./g, "-")}-${region}`;
    return { requestId, targetDomain, region, limit, task: buildRankedKeywordsTask(limit, requestId, { targetDomain, region }) };
  }));
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  return { period, jobs, maxDiscoveryCostMicros: quoteForLimit(limit).maxCostMicros * jobs.length,
    mayStart: day >= "2026-10-20" && day === period.start && now.getTime() >= Date.parse(period.dueAt) };
}

// A historical matching URL alone cannot establish current intent. Only a
// high-confidence phrase in today's title/H1 can promote a new discovery.
export function discoveryPageMatches(site: string, keyword: string, title: string, h1: string) {
  if (keywordRelevance(site, keyword).status !== "relevant") return false;
  const word = normalizeKeywordText(keyword), content = normalizeKeywordText(`${title} ${h1}`);
  const tokens = word.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length < 2 && !/^(flatkey|rackrate|modelfit)$/u.test(word)) return false;
  return content.includes(word);
}
