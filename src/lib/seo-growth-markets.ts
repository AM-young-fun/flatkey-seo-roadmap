/** Approved planning markets. This does not enable or authorize paid queries. */
export const GROWTH_MARKET_LANGUAGES = {
  US: "en", JP: "ja", BR: "pt-BR", SG: "zh-CN", ES: "es-ES",
  FR: "fr", DE: "de", RU: "ru", VN: "vi", ID: "id",
} as const;
export const GROWTH_LANGUAGES = ["en", "ja", "pt-BR", "zh-CN", "es-ES", "fr", "de", "ru", "vi", "id"] as const;
export const GROWTH_COUNTRIES = ["US", "JP", "BR", "SG", "ES", "FR", "DE", "RU", "VN", "ID"] as const;
export const GROWTH_EXECUTION_SITES = ["flatkey.ai", "rackrate.org", "modelfit.cc"] as const;
export const GROWTH_BLOG_SITES = ["flatkey.ai", "modelfit.cc"] as const;
export const GROWTH_TARGET_ALLOCATION = { US: 35, JP: 25, BR: 20, SG: 15, other: 5 } as const;
export type GrowthCountry = typeof GROWTH_COUNTRIES[number];
export const GROWTH_COUNTRY_LABELS: Record<GrowthCountry, string> = { US: "美国", JP: "日本", BR: "巴西", SG: "新加坡", ES: "西班牙", FR: "法国", DE: "德国", RU: "俄罗斯", VN: "越南", ID: "印度尼西亚" };
export type GrowthAnalysisCountry = "all" | GrowthCountry;

export const isGrowthTopicPlaceholder = (value: string) => /^(?:自然搜索发现(?:词|关键词)?|搜索发现(?:词|关键词)?|待(?:归类|分类|核实|分配)|未分类|其他|unknown|uncategorized)$/iu.test(value.trim());
