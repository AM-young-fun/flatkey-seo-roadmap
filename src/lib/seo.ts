export const REGIONS = {
  US: {
    code: "US",
    label: "美国",
    googleLabel: "United States",
    gl: "us",
    hl: "en",
    ahrefsCountry: "us"
  },
  JP: {
    code: "JP",
    label: "日本",
    googleLabel: "Japan",
    gl: "jp",
    hl: "ja",
    ahrefsCountry: "jp"
  },
  ES: {
    code: "ES",
    label: "西班牙",
    googleLabel: "Spain",
    gl: "es",
    hl: "es",
    ahrefsCountry: "es"
  },
  BR: {
    code: "BR",
    label: "巴西",
    googleLabel: "Brazil",
    gl: "br",
    hl: "pt-BR",
    ahrefsCountry: "br"
  }
} as const;

export type SearchRegionCode = keyof typeof REGIONS;

export const REGION_CODES = Object.keys(REGIONS) as SearchRegionCode[];

export type RankBucket = "TOP_5" | "TOP_10" | "TOP_50" | "NOT_FOUND";

export const RANK_BUCKET_META: Record<
  RankBucket,
  { label: string; color: string; order: number }
> = {
  TOP_5: {
    label: "前 5",
    color: "#1a9850",
    order: 1
  },
  TOP_10: {
    label: "前 10",
    color: "#f2c94c",
    order: 2
  },
  TOP_50: {
    label: "前 50",
    color: "#d64545",
    order: 3
  },
  NOT_FOUND: {
    label: "未排名",
    color: "#151515",
    order: 4
  }
};

export function getRankBucket(rank: number | null | undefined): RankBucket {
  if (!rank || rank < 1) {
    return "NOT_FOUND";
  }

  if (rank <= 5) {
    return "TOP_5";
  }

  if (rank <= 10) {
    return "TOP_10";
  }

  if (rank <= 50) {
    return "TOP_50";
  }

  return "NOT_FOUND";
}

export function rankLabel(rank: number | null | undefined): string {
  return rank ? `#${rank}` : "未进入前 50";
}

export function rankDeltaLabel(delta: number | null | undefined): string {
  if (delta === null || delta === undefined) {
    return "-";
  }

  if (delta > 0) {
    return `+${delta}`;
  }

  return String(delta);
}

export function normalizeDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

export function urlMatchesDomain(url: string | null | undefined, domain: string): boolean {
  if (!url || !domain) {
    return false;
  }

  try {
    const host = normalizeDomain(new URL(url).hostname);
    const normalizedDomain = normalizeDomain(domain);
    return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
  } catch {
    return normalizeDomain(url).includes(normalizeDomain(domain));
  }
}

export function hashString(value: string): number {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return hash >>> 0;
}

export function demoRankFor(keyword: string, region: SearchRegionCode): number | null {
  const value = hashString(`${keyword}:${region}`);
  const roll = value % 72;

  if (roll > 50) {
    return null;
  }

  return Math.max(1, roll);
}

export function demoVolumeFor(keyword: string, region: SearchRegionCode): number {
  const value = hashString(`volume:${keyword}:${region}`);
  return 120 + (value % 48000);
}
