import keywordReview from "./data/keyword-review.json";

export type KeywordRelevance = {
  status: "relevant" | "unrelated" | "review";
  reason: string | null;
};

export function normalizeKeywordText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function reviewKey(siteDomain: string, text: string): string {
  return `${normalizeKeywordText(siteDomain)}\u0000${normalizeKeywordText(text)}`;
}

const excludedKeywords = new Map(keywordReview.excluded.map(row => [reviewKey(row.site, row.keyword), row.reason]));
const reviewKeywords = new Map(keywordReview.review.map(row => [reviewKey(row.site, row.keyword), row.reason]));
const genericNoise = new Set(keywordReview.genericNoise.map(normalizeKeywordText));

// These standalone numbers identify GPUs commonly used for local AI inference.
const numericGpuNames = new Set([
  "1080", "2080", "3060", "3070", "3080", "3090", "4060", "4070", "4080", "4090",
  "5060", "5070", "5080", "5090",
]);
const number = String.raw`[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:[.,]\d+)?`;
const currency = String.raw`(?:r\$|[$€£¥₹₩₽₿]|usd|eur|gbp|cny|rmb|jpy|krw|inr|rub|brl|aud|cad|chf|sgd|hkd|usdt|dollars?|euros?|yuan|美元|美金|人民币|人民幣|円|元)`;
const currencyOnly = new RegExp(`^(?:${currency}\\s*${number}(?:\\s*${currency})?|${number}\\s*${currency})$`, "u");
const countOnly = new RegExp(`^${number}(?:\\s*(?:枚|个|個|件|条|條|次|份|台|张|張|人|pcs?|items?|units?|counts?))?$`, "u");

/**
 * Classify business relevance independently of ranking evidence.
 * A review result preserves the original keyword for later review; callers may
 * hide it from a focused view without treating it as an exclusion.
 */
export function keywordRelevance(siteDomain: string, text: string): KeywordRelevance {
  const normalized = normalizeKeywordText(text);
  const key = reviewKey(siteDomain, normalized);
  const excludedReason = excludedKeywords.get(key);
  if (excludedReason) return { status: "unrelated", reason: excludedReason };
  const reviewReason = reviewKeywords.get(key);
  if (reviewReason) return { status: "review", reason: reviewReason };

  if (!normalized) return { status: "review", reason: "空关键词缺少可判断的业务对象" };
  if (genericNoise.has(normalized)) {
    return { status: "unrelated", reason: "单独确认词、测试词或空值标记，无业务语义" };
  }
  if (currencyOnly.test(normalized) || (countOnly.test(normalized) && !numericGpuNames.has(normalized))) {
    return { status: "unrelated", reason: "仅包含货币金额或数量，缺少 AI API、工具或 GPU 业务对象" };
  }

  // New model names, tool APIs and multilingual queries must not be dropped by
  // a broad keyword/locale heuristic. Only reviewed exclusions block imports.
  return { status: "relevant", reason: null };
}
