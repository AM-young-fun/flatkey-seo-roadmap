import { normalizeKeywordText } from "./keyword-relevance";

export const KEYWORD_BUSINESSES = [
  { value: "FLATKEY_API", label: "Flatkey API" },
  { value: "CLOUD_GPU", label: "Cloud GPU" },
] as const;
export type KeywordBusiness = typeof KEYWORD_BUSINESSES[number]["value"];

// Domains identify ranking evidence; business categories identify the library.
// Keep existing Flatkey words in API unless the Cloud GPU source says otherwise.
export function keywordBusiness(keyword: { siteDomain?: string; text: string; businessCategory?: KeywordBusiness }, cloudKeywords: ReadonlySet<string> = new Set()): KeywordBusiness {
  if (["rackrate.org", "modelfit.cc"].includes(keyword.siteDomain ?? "")) return "CLOUD_GPU";
  if (cloudKeywords.has(normalizeKeywordText(keyword.text))) return "CLOUD_GPU";
  return keyword.businessCategory ?? "FLATKEY_API";
}
