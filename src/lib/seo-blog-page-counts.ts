export type BlogPageCountSource = {
  originals: number;
  translations?: number;
  backfillTranslations?: number;
};

/** Counts are mutually exclusive kinds from the digest's URL-deduplicated publications. */
export function blogPageCounts(counts: BlogPageCountSource) {
  const originals = counts.originals;
  const translations = counts.translations ?? 0;
  const backfillTranslations = counts.backfillTranslations ?? 0;
  return { originals, translations, backfillTranslations, total: originals + translations + backfillTranslations };
}

export type BlogPageCounts = ReturnType<typeof blogPageCounts>;
