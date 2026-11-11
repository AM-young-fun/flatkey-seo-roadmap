export type KeywordEvidenceView = "keywords" | "rankings" | "network";
export type KeywordWorkspaceQuery = Record<string, string | string[] | undefined>;

export function keywordWorkspaceHref(values: KeywordWorkspaceQuery, evidence: KeywordEvidenceView) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach(item => query.append(key, item));
    else if (value !== undefined) query.append(key, value);
  }
  query.set("details", evidence);
  return `/opportunities?${query.toString()}#keyword-evidence`;
}
