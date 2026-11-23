import saved from "./data/growth-diagnostic-word-language-evidence-20261123.json";
import { createHash } from "node:crypto";
import { APPROVED_KEYWORD_REVIEW_QUERIES } from "./approved-keyword-review";
import type { GrowthWordLanguageEvidence } from "./growth-workspace";

/** This historical fee proposal explicitly forbids production market changes.
 * Export only validated word-language spans, never its diagnostic query country. */
export function approvedDiagnosticWordLanguages(): GrowthWordLanguageEvidence[] {
  if (!saved.diagnosticOnly || saved.primaryMarketAssignmentApproved !== false || saved.sourceSha256 !== "539bd83987801e75350b47487dbd772349242c7b4e33dfa60719c326fa542259" || createHash("sha256").update(JSON.stringify(saved.rows)).digest("hex") !== "023ca59966ad1e5ad54cb566a477b63912b51b3120db32b139ed045f09f75532") throw new Error("DIAGNOSTIC_LANGUAGE_EVIDENCE_SCOPE_CHANGED");
  const original = new Map(APPROVED_KEYWORD_REVIEW_QUERIES.map(row => [row.keywordId, row]));
  return saved.rows.flatMap(row => {
    const query = original.get(row.keywordId);
    if (!query || row.site !== "flatkey.ai" || row.keyword !== query.keyword || row.language !== query.language) return [];
    const evidence = row.evidence.filter(item => item.span.length === 2 && item.span[0] >= 0 && item.span[1] > item.span[0] && item.span[1] <= row.keyword.length && row.keyword.slice(item.span[0], item.span[1]).normalize("NFKC").toLowerCase() === item.text.normalize("NFKC").toLowerCase() && (item.language === row.language || row.language.startsWith(`${item.language}-`)));
    return evidence.length ? [{ site: row.site, keywordId: row.keywordId, keyword: row.keyword, language: row.language, source: `${saved.sourceFile}#${saved.sourceSha256}`, evidence: evidence.map(item => ({ text: item.text, start: item.span[0], end: item.span[1] })) }] : [];
  });
}
