import type { SearchRegionCode } from "./seo";
import type { SerpTarget } from "./serp-targets";
import type { SerpTrendFrame, TrendPoint } from "./ranking-trends";

export const HISTORICAL_WORD_LANGUAGE_VERSION = "native-word-single-country-v1" as const;
export type HistoricalLanguageDecision = { status: "match" | "mismatch" | "unknown"; reason: string; queryLanguage: string };
export type HistoricalLanguageClassifier = (target: Pick<SerpTarget, "keywordId" | "keyword" | "siteDomain">, country: SearchRegionCode) => HistoricalLanguageDecision;
export type HistoricalWordObservation = {
  keyword: string; keywordId: string; site: string; country: SearchRegionCode; queryLanguage: string;
  languageStatus: HistoricalLanguageDecision["status"]; reason: string; status: string;
  rank: number | null; url: string | null; checkedAt: string | null; runId: string | null;
};
export type HistoricalWordAudit = {
  wordKey: string; keyword: string; disposition: "ranked" | "outside100" | "pending" | "unknown_language" | "owned_brand";
  selected: HistoricalWordObservation | null; observations: HistoricalWordObservation[];
};
export type HistoricalLanguagePeriodAudit = {
  periodKey: string; label: string; version: typeof HISTORICAL_WORD_LANGUAGE_VERSION; rawSnapshotsPreserved: true;
  rawRanked: number; rawTargetCount: number; uniqueWords: number; rankedWords: number; unknownLanguageWords: number;
  excludedBrandWords: number; mismatchedObservationRows: number; unknownObservationRows: number;
  countries: { country: SearchRegionCode; count: number; share: number | null }[];
  rawRuns: { runId: string; country: SearchRegionCode; observedTargetCount: number }[]; words: HistoricalWordAudit[];
};
const wordKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const stamp = (value: string | null) => value ? Date.parse(value) || 0 : 0;
const isRanked = (row: HistoricalWordObservation) => row.status === "RANKED" && Number.isInteger(row.rank) && row.rank! >= 1 && row.rank! <= 100;
const compare = (a: HistoricalWordObservation, b: HistoricalWordObservation) => (a.rank ?? 101) - (b.rank ?? 101)
  || stamp(b.checkedAt) - stamp(a.checkedAt) || a.country.localeCompare(b.country) || a.site.localeCompare(b.site) || a.keywordId.localeCompare(b.keywordId);

/** A read-only display projection: never move a captured rank to a different
 * country, mutate a cohort, or infer a neutral word's language from its locale. */
export function projectHistoricalWordLanguage(
  markets: { region: SearchRegionCode; frames: SerpTrendFrame[] }[], classify: HistoricalLanguageClassifier,
  ownedBrand: (keyword: string) => boolean,
) {
  const keys = [...new Set(markets.flatMap(market => market.frames.map(frame => frame.point.periodKey ?? frame.point.date)))].sort();
  const points: TrendPoint[] = [], periods: HistoricalLanguagePeriodAudit[] = [];
  const countryPoints = new Map<SearchRegionCode, TrendPoint[]>();
  for (const key of keys) {
    const frames = markets.flatMap(market => {
      const frame = market.frames.find(frame => (frame.point.periodKey ?? frame.point.date) === key);
      return frame ? [{ ...market, frame }] : [];
    });
    if (!frames.length) continue;
    const words = new Map<string, { keyword: string; members: SerpTarget[]; observations: HistoricalWordObservation[] }>();
    for (const { region, frame } of frames) {
      for (const target of frame.targets) {
        const key = wordKey(target.keyword), value = words.get(key) ?? { keyword: target.keyword, members: [], observations: [] };
        if (!value.members.some(member => member.keywordId === target.keywordId && member.siteDomain === target.siteDomain)) value.members.push(target);
        words.set(key, value);
      }
      for (const item of frame.items) {
        const value = words.get(wordKey(item.keyword));
        if (!value) continue;
        const language = classify(item, region);
        value.observations.push({ keyword: item.keyword, keywordId: item.keywordId, site: item.siteDomain, country: region,
          queryLanguage: language.queryLanguage, languageStatus: language.status, reason: language.reason, status: item.status,
          rank: item.rank, url: item.url, checkedAt: item.checkedAt, runId: item.runId });
      }
    }
    const audit: HistoricalWordAudit[] = [...words].sort(([a], [b]) => a.localeCompare(b)).map(([word, value]) => {
      const observations = [...value.observations].sort((a, b) => a.country.localeCompare(b.country) || a.site.localeCompare(b.site) || a.keywordId.localeCompare(b.keywordId));
      if (ownedBrand(value.keyword)) return { wordKey: word, keyword: value.keyword, disposition: "owned_brand", selected: null, observations };
      const native = observations.filter(row => row.languageStatus === "match"), ranked = native.filter(isRanked).sort(compare);
      if (ranked.length) return { wordKey: word, keyword: value.keyword, disposition: "ranked", selected: ranked[0], observations };
      const completeOutside = native.filter(row => row.status === "OUTSIDE_TOP100");
      // Country assignment is backed by an actual same-country observation;
      // an English hit in Japan cannot be relabelled as an American hit.
      if (completeOutside.length && completeOutside.length === native.length) return { wordKey: word, keyword: value.keyword, disposition: "outside100", selected: [...completeOutside].sort(compare)[0], observations };
      return { wordKey: word, keyword: value.keyword, disposition: native.length ? "pending" : observations.some(row => row.languageStatus === "unknown") ? "unknown_language" : "pending", selected: null, observations };
    });
    const eligible = audit.filter(word => word.disposition !== "owned_brand"), ranked = eligible.filter(word => word.disposition === "ranked");
    const counts = (rows: HistoricalWordAudit[]) => [1, 11, 31, 51].map((start, index) => rows.filter(row => row.selected?.rank != null && row.selected.rank >= start && row.selected.rank <= [10, 30, 50, 100][index]).length);
    const timestamps = frames.flatMap(({ frame }) => frame.point.dataDates ?? []).sort();
    const base = frames[0].frame.point;
    const checkedWords = eligible.filter(word => word.observations.some(row => row.languageStatus === "match" && ["RANKED", "OUTSIDE_TOP100", "NOT_FOUND_CAPTURE"].includes(row.status)));
    const projectedPoint: TrendPoint = { ...base, total: eligible.length, ranked: ranked.length, counts: counts(ranked),
      outside: eligible.filter(word => word.disposition === "outside100").length,
      pending: eligible.filter(word => !["ranked", "outside100"].includes(word.disposition)).length,
      checked: checkedWords.length, captured: checkedWords.length, failed: undefined, incomplete: undefined, queued: undefined,
      notFoundCaptured: undefined, queryChanged: undefined, partialRanked: undefined, movementSummary: undefined,
      sites: [...new Set(frames.flatMap(({ frame }) => frame.point.sites))].sort(), sources: ["dataforseo_serp"],
      cohortHash: null, comparable: false, scopeLabel: "原词语种匹配；同词跨国跨站只计一次",
      ...(timestamps.length ? { snapshotAt: timestamps.at(-1), captureStartAt: timestamps[0], captureEndAt: timestamps.at(-1), dataDates: [...new Set(timestamps)] } : {}),
      languageProjection: { version: HISTORICAL_WORD_LANGUAGE_VERSION, rawSnapshotsPreserved: true,
        rawTotal: words.size, rawRanked: [...words.values()].filter(word => word.observations.some(isRanked)).length,
        rawCaptured: [...words.values()].filter(word => word.observations.some(row => row.checkedAt && ["RANKED", "OUTSIDE_TOP100", "NOT_FOUND_CAPTURE"].includes(row.status))).length,
        unknownLanguageWords: eligible.filter(word => word.disposition === "unknown_language").length,
        mismatchedObservationRows: audit.flatMap(word => word.observations).filter(row => row.languageStatus === "mismatch").length,
        excludedBrandWords: audit.filter(word => word.disposition === "owned_brand").length,
        countryCounts: markets.map(market => ({ country: market.region, count: ranked.filter(word => word.selected?.country === market.region).length })) },
    };
    points.push(projectedPoint);
    for (const { region } of frames) {
      const nativeWords = eligible.filter(word => word.observations.some(row => row.country === region && row.languageStatus === "match"));
      const selected = ranked.filter(word => word.selected?.country === region);
      const outside = nativeWords.filter(word => word.disposition === "outside100" && word.selected?.country === region).length;
      const captured = nativeWords.filter(word => word.observations.some(row => row.country === region && row.languageStatus === "match" && ["RANKED", "OUTSIDE_TOP100", "NOT_FOUND_CAPTURE"].includes(row.status))).length;
      const country = { ...projectedPoint, total: nativeWords.length, ranked: selected.length, counts: counts(selected), outside,
        pending: nativeWords.length - selected.length - outside, captured, checked: captured,
        languageProjection: { ...projectedPoint.languageProjection!,
          rawCaptured: [...words.values()].filter(word => word.observations.some(row => row.country === region && row.checkedAt && ["RANKED", "OUTSIDE_TOP100", "NOT_FOUND_CAPTURE"].includes(row.status))).length,
          unknownLanguageWords: eligible.filter(word => word.observations.some(row => row.country === region && row.languageStatus === "unknown")).length,
          countryCounts: [{ country: region, count: selected.length }] } };
      countryPoints.set(region, [...(countryPoints.get(region) ?? []), country]);
    }
    periods.push({ periodKey: key, label: base.periodLabel ?? key, version: HISTORICAL_WORD_LANGUAGE_VERSION, rawSnapshotsPreserved: true,
      rawRanked: projectedPoint.languageProjection!.rawRanked, rawTargetCount: [...words.values()].reduce((sum, word) => sum + word.members.length, 0),
      uniqueWords: words.size, rankedWords: ranked.length, unknownLanguageWords: projectedPoint.languageProjection!.unknownLanguageWords,
      excludedBrandWords: projectedPoint.languageProjection!.excludedBrandWords,
      mismatchedObservationRows: projectedPoint.languageProjection!.mismatchedObservationRows,
      unknownObservationRows: audit.flatMap(word => word.observations).filter(row => row.languageStatus === "unknown").length,
      countries: markets.map(market => ({ country: market.region, count: ranked.filter(word => word.selected?.country === market.region).length,
        share: ranked.length ? ranked.filter(word => word.selected?.country === market.region).length / ranked.length : null })),
      rawRuns: frames.flatMap(({ region, frame }) => [...new Set(frame.items.flatMap(item => item.runId ? [item.runId] : []))].map(runId => ({ runId, country: region,
        observedTargetCount: new Set(frame.items.filter(item => item.runId === runId).map(item => `${item.siteDomain}:${item.keywordId}`)).size }))), words: audit });
  }
  return { points, markets: markets.map(market => ({ region: market.region, points: countryPoints.get(market.region) ?? [] })), periods };
}
