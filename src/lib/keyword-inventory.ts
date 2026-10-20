import { normalizeKeywordText } from "./keyword-relevance";

/** Candidate membership is exclusive: a formal keyword wins across sites. */
export function candidateKeywordCount(formalWords: readonly string[], candidateWords: readonly string[]) {
  const formal = new Set(formalWords.map(normalizeKeywordText));
  return new Set(candidateWords.map(normalizeKeywordText).filter(word => word && !formal.has(word))).size;
}
