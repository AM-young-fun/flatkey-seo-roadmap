import { keywordRelevance, normalizeKeywordText } from "./keyword-relevance";
import type { SerpTarget } from "./serp-targets";

export type SerpSampleCategory = "BRAND" | "MODEL_PRICE";

type SelectionRule = {
  keyword: string;
  category: SerpSampleCategory;
  pageKind: "HOME" | "BRAND_GUIDE" | "MODEL_DETAIL" | "MODEL_PRICE_ARTICLE";
  reason: string;
};

const brandKeywords = [
  "flatkey", "flatkey ai", "flat key", "flatkey api integration", "flatkey api quickstart",
  "flatkey integration starter", "flatkey quickstart", "flatkey sdk setup",
] as const;
const modelDetailPriceKeywords = [
  "claude-haiku-4-5-20251001 pricing", "deepseek pricing", "gemini 3 pro image price",
  "glm 5.3 pricing", "glm api price", "glm prime pricing", "glm-5.3 api pricing",
  "gpt 6 astra price", "gpt image 2 pricing", "minimax h3 price",
  "seedance 2.0 api pricing", "seedance 2.5 api pricing",
] as const;
const modelPriceArticleKeywords = [
  "claude api pricing", "claude sonnet api pricing", "anthropic api pricing",
  "deepseek api pricing", "deepseek v4 pro api pricing", "deepseek v4 flash pricing",
  "gemini api pricing", "grok api pricing", "kimi k3 api pricing", "qwen api pricing",
  "veo 3.1 api pricing", "imagen api pricing", "mistral api pricing", "gpt-5.6 pricing",
  "seedance api pricing", "openai image api pricing", "llama api pricing", "glm pricing",
] as const;

// This is a small, reviewed one-off sample, not a keyword discovery rule. A term
// absent from the live formal cohort is skipped rather than created or replaced.
const rules: SelectionRule[] = [
  ...brandKeywords.map((keyword, index): SelectionRule => ({ keyword, category: "BRAND",
    pageKind: index < 3 ? "HOME" : "BRAND_GUIDE",
    reason: index < 3 ? "品牌主词，核验官网实际排名" : "品牌接入词，核验已有接入文章的实际排名" })),
  ...modelDetailPriceKeywords.map((keyword): SelectionRule => ({ keyword, category: "MODEL_PRICE",
    pageKind: "MODEL_DETAIL", reason: "模型价格词，已有对应模型详情页" })),
  ...modelPriceArticleKeywords.map((keyword): SelectionRule => ({ keyword, category: "MODEL_PRICE",
    pageKind: "MODEL_PRICE_ARTICLE", reason: "模型定价词，已有对应价格文章" })),
];

export const SERP_SAMPLE_MAX_QUERIES = rules.length;

function matchesPageKind(raw: string, kind: SelectionRule["pageKind"]): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !["flatkey.ai", "www.flatkey.ai"].includes(url.hostname) || url.username || url.password) return false;
    const path = url.pathname.replace(/^\/(?:zh|ja|es|pt|fr|de|ru|id|vi)(?=\/|$)/u, "") || "/";
    if (kind === "HOME") return path === "/";
    if (kind === "MODEL_DETAIL") return /^\/models\/[^/]+\/?$/u.test(path);
    return /^\/blog\/[^/]+\/?$/u.test(path);
  } catch {
    return false;
  }
}

/** Input must come from loadSerpTargetCohort, which enforces formal membership. */
export function selectSerpSampleTargets(cohortTargets: SerpTarget[]): {
  targets: SerpTarget[];
  categories: Record<string, SerpSampleCategory>;
  reasons: Record<string, string>;
} {
  const candidates = new Map<string, SerpTarget[]>();
  for (const target of cohortTargets) {
    if (target.siteDomain !== "flatkey.ai" || keywordRelevance(target.siteDomain, target.keyword).status !== "relevant") continue;
    const text = normalizeKeywordText(target.keyword);
    candidates.set(text, [...(candidates.get(text) ?? []), target]);
  }
  const targets: SerpTarget[] = [];
  const categories: Record<string, SerpSampleCategory> = {};
  const reasons: Record<string, string> = {};
  for (const rule of rules) {
    const target = candidates.get(rule.keyword)?.filter(candidate =>
      candidate.targetUrls.some(url => matchesPageKind(url, rule.pageKind)),
    ).sort((a, b) => a.keywordId.localeCompare(b.keywordId))[0];
    if (!target) continue;
    const key = `${target.siteDomain}:${target.keywordId}`;
    if (categories[key]) continue;
    targets.push({ ...target, targetUrls: [...target.targetUrls] });
    categories[key] = rule.category;
    reasons[key] = rule.reason;
  }
  return { targets, categories, reasons };
}
