const bands = [[1, 3], [4, 10], [11, 20], [21, 50], [51, 100]] as const;

type RankingCountry = { country: string; target: number; ranked: number };
type RankedWord = { rank: number };

export type WeeklyRankingSummary = {
  total: number;
  ranked: number;
  verifiedOutside: number;
  unresolved: number;
  countries: RankingCountry[];
  bands: { from: number; to: number; count: number }[];
};

export function summarizeWeeklyRankings(
  countries: RankingCountry[], ranked: RankedWord[], verifiedOutside: number,
): WeeklyRankingSummary {
  const total = countries.reduce((sum, row) => sum + row.target, 0);
  return {
    total,
    ranked: ranked.length,
    verifiedOutside,
    unresolved: total - ranked.length - verifiedOutside,
    countries,
    bands: bands.map(([from, to]) => ({
      from, to, count: ranked.filter(row => row.rank >= from && row.rank <= to).length,
    })),
  };
}
