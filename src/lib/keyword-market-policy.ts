import { z } from "zod";

/** Explicit research decisions, never a country inferred from a query's script. */
export const MARKET_ASSIGNMENT_SOURCE_ID = "SEO_MARKET_ASSIGNMENT";
export const PAID_QUERY_POLICY_VERSION = "primary-country-nonbrand-v1";
export const KEYWORD_MARKET_LANGUAGES = { US: "en", JP: "ja", ES: "es-ES", BR: "pt-BR" } as const;
export type KeywordMarket = keyof typeof KEYWORD_MARKET_LANGUAGES;
const country = z.enum(["US", "JP", "ES", "BR"]);
export const keywordMarketAssignmentSchema = z.object({
  primaryCountry: country,
  language: z.enum(["en", "ja", "es-ES", "pt-BR"]),
  secondaryMarkets: z.array(z.object({ country, reason: z.string().trim().min(12).max(2000) }).strict()).max(3).default([]),
  evidence: z.string().trim().min(12).max(4000),
  reviewedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (KEYWORD_MARKET_LANGUAGES[value.primaryCountry] !== value.language) context.addIssue({ code: "custom", path: ["language"], message: "目标国家与已研究的关键词语言不一致" });
  const seen = new Set<KeywordMarket>([value.primaryCountry]);
  for (const entry of value.secondaryMarkets) {
    if (seen.has(entry.country)) context.addIssue({ code: "custom", path: ["secondaryMarkets"], message: "主国家与额外国家不得重复" });
    seen.add(entry.country);
  }
  if (Date.parse(value.reviewedAt) > Date.now() + 300_000) context.addIssue({ code: "custom", path: ["reviewedAt"], message: "核对时间不能在未来" });
});
export type KeywordMarketAssignment = z.infer<typeof keywordMarketAssignmentSchema>;

export function readKeywordMarketAssignment(value: unknown): KeywordMarketAssignment | null {
  const result = keywordMarketAssignmentSchema.safeParse(value);
  return result.success ? result.data : null;
}

// Delimiters prevent an unrelated word merely containing a short brand token
// from being excluded. Third-party model/provider brands are not excluded.
const ownBrand = /(?:^|[^a-z0-9])(?:flat[\s._-]*key|rack[\s._-]*rate|model[\s._-]*fit|mochi[\s._-]*chat[\s._-]*bot|jev[\s._-]*llm)(?=$|[^a-z0-9])/iu;
export function isOwnedBrandKeyword(keyword: string): boolean {
  return ownBrand.test(keyword.normalize("NFKC"));
}

export function explicitKeywordMarkets(assignment: unknown): KeywordMarket[] {
  const value = readKeywordMarketAssignment(assignment);
  return value ? [value.primaryCountry, ...value.secondaryMarkets.map(entry => entry.country)] : [];
}

export function keywordLanguageIssue(keyword: string, assignment: KeywordMarketAssignment): string | null {
  if (assignment.language !== "ja" && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(keyword.normalize("NFKC"))) return "关键词文字与页面目标语言不一致，需使用该市场真实查询词重新核对";
  return null;
}

/** Preference is not a deletion rule; unknown KD is not KD=0. */
export function keywordSelectionPriority(input: { volume: number | null; kd: number | null; exceptionReason?: string | null }) {
  const valid = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0;
  if (!valid(input.volume) || !valid(input.kd) || Number(input.kd) > 100) return { status: "evidence_required" as const, eligible: false, reason: "补齐目标国家搜索量和 KD 的可核实证据" };
  if (Number(input.volume) >= 10 && Number(input.kd) < 30) return { status: "preferred" as const, eligible: true, reason: "目标国家月搜索量 ≥10、KD＜30" };
  if ((input.exceptionReason?.trim().length ?? 0) >= 12) return { status: "documented_exception" as const, eligible: true, reason: input.exceptionReason!.trim() };
  return { status: "exception_required" as const, eligible: false, reason: "低量高意图或战略词需逐词说明例外理由" };
}
