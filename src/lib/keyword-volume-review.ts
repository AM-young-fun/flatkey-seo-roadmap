import { REGION_CODES, type SearchRegionCode } from "./seo";
import type { KeywordVolumeReview, RankingEvidence, RegionalVolumeReview } from "./types";

const DAY_MS = 86_400_000;
// Internal conservative archive threshold, not a search-volume industry
// standard. Model/new-term and real-demand protection still take priority.
export const ZERO_VOLUME_MIN_DAYS = 60;
export const ZERO_VOLUME_MAX_GAP_DAYS = 45;
export const ZERO_VOLUME_MIN_SAMPLES = 3;

export type VolumeReviewSample = {
  volume: number | null;
  // Upstream data date, never a late import/collection date for Ahrefs exports.
  dataDate: string | null;
};
export type KeywordVolumeReviewInput = {
  text: string;
  siteDomain: string;
  topicTexts?: string[];
  targetUrls?: string[];
  firstTrackedAt?: string | null;
  restoredAt?: string | null;
  marketVolumes?: Partial<Record<SearchRegionCode, number | null>>;
  histories?: Partial<Record<SearchRegionCode, VolumeReviewSample[]>>;
  rankingEvidence?: Partial<Record<SearchRegionCode, RankingEvidence[]>>;
  hasSearchActivity?: boolean;
  hasObservedPage?: boolean;
  now?: Date;
};

function dateDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.floor(time / DAY_MS) : null;
}
const dateLabel = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export function reviewRegionalVolume(samples: VolumeReviewSample[], now = new Date()): RegionalVolumeReview {
  const today = Math.floor(now.getTime() / DAY_MS);
  const byDay = new Map<number, number>();
  let hasPositiveVolume = false;
  let undated = 0;
  for (const sample of samples) {
    if (sample.volume == null || !Number.isFinite(sample.volume) || sample.volume < 0) continue;
    // Even undated demand is evidence against removal, but undated zeros prove no duration.
    if (sample.volume > 0) hasPositiveVolume = true;
    const day = dateDay(sample.dataDate);
    if (day == null || day > today) { undated++; continue; }
    byDay.set(day, Math.max(sample.volume, byDay.get(day) ?? 0));
  }
  const ordered = [...byDay].sort(([a], [b]) => a - b);
  const latest = ordered.at(-1);
  const positives = ordered.filter(([, volume]) => volume > 0);
  const lastPositive = positives.at(-1)?.[0] ?? null;
  const zeroDays = ordered.filter(([day, volume]) => volume === 0 && (lastPositive == null || day > lastPositive)).map(([day]) => day);
  const zeroSpanDays = zeroDays.length ? zeroDays[zeroDays.length - 1] - zeroDays[0] : 0;
  const largestGapDays = zeroDays.length >= 2 ? Math.max(...zeroDays.slice(1).map((day, index) => day - zeroDays[index])) : null;
  const recent = latest != null && today - latest[0] <= ZERO_VOLUME_MAX_GAP_DAYS;
  const isSustainedZero = !hasPositiveVolume && recent && zeroDays.length >= ZERO_VOLUME_MIN_SAMPLES &&
    zeroSpanDays >= ZERO_VOLUME_MIN_DAYS && largestGapDays != null && largestGapDays <= ZERO_VOLUME_MAX_GAP_DAYS;
  let status: RegionalVolumeReview["status"] = "incomplete";
  let reason = "零声量历史不足，保留观察";
  if (hasPositiveVolume) { status = "positive"; reason = "曾有正搜索量，保留需求记录"; }
  else if (!latest) { status = "unknown"; reason = undated ? "缺少来源数据日期，不能判断持续时长" : "搜索量未知，不能按零声量处理"; }
  else if (!recent) { status = "stale"; reason = "最新来源数据已超过 45 天，需补采"; }
  else if (isSustainedZero) { status = "sustained_zero"; reason = "至少 3 次零值覆盖 60 天，采样间隔及新鲜度均合格"; }
  else if (largestGapDays != null && largestGapDays > ZERO_VOLUME_MAX_GAP_DAYS) reason = "采样间隔超过 45 天，不能证明持续为零";
  else if (zeroDays.length < ZERO_VOLUME_MIN_SAMPLES) reason = "不足 3 个有来源日期的零值采样日";
  else reason = "零值采样尚未覆盖 60 天";
  return {
    status, latestVolume: latest?.[1] ?? null, latestDataDate: latest ? dateLabel(latest[0]) : null,
    sampleCount: ordered.length, zeroSamples: zeroDays.length, zeroSpanDays, largestGapDays,
    lastPositiveDate: lastPositive == null ? null : dateLabel(lastPositive), hasPositiveVolume, isSustainedZero, reason,
  };
}

export function validSitePage(value: string | null | undefined, domain: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

function modelContext(input: KeywordVolumeReviewInput) {
  if ((input.targetUrls ?? []).some(value => {
    try { return validSitePage(value, input.siteDomain) && /^\/models?(?:\/|$)/i.test(new URL(value).pathname); }
    catch { return false; }
  })) return true;
  const text = [input.text, ...(input.topicTexts ?? [])].join(" ").normalize("NFKC").toLowerCase();
  return /\b(?:models?|llms?|gpt|claude|gemini|qwen|deepseek|llama|mistral|grok|seedance|seedream|flux|sora|veo|kling|hunyuan|glm|minimax|new release|newly released|latest release)\b|模型|新词|新發布|新发布|新上线|新上線/.test(text);
}

export function assessKeywordVolume(input: KeywordVolumeReviewInput): KeywordVolumeReview {
  const now = input.now ?? new Date();
  const today = Math.floor(now.getTime() / DAY_MS);
  const firstDay = dateDay(input.firstTrackedAt);
  const trackedDays = firstDay == null || firstDay > today ? null : today - firstDay;
  const restoredDay = dateDay(input.restoredAt);
  const restoredDays = restoredDay == null || restoredDay > today ? null : today - restoredDay;
  const regions = Object.fromEntries(REGION_CODES.map(region => [region,
    reviewRegionalVolume(input.histories?.[region] ?? [], now),
  ])) as Record<SearchRegionCode, RegionalVolumeReview>;
  const evidence = REGION_CODES.flatMap(region => input.rankingEvidence?.[region] ?? []);
  const hasActivity = input.hasSearchActivity || evidence.some(report => (report.clicks ?? 0) > 0 || (report.impressions ?? 0) > 0 ||
    report.pages.some(page => (page.clicks ?? 0) > 0 || (page.impressions ?? 0) > 0));
  const hasPage = input.hasObservedPage || evidence.some(report =>
    (report.rank != null && validSitePage(report.url, input.siteDomain)) ||
    report.pages.some(page => page.rank != null && page.rank >= 1 && validSitePage(page.url, input.siteDomain)));
  const positive = REGION_CODES.some(region => regions[region].hasPositiveVolume || (input.marketVolumes?.[region] ?? 0) > 0);
  const reasons: string[] = [];
  if (positive) reasons.push("任一跟踪国家存在正搜索量，保留");
  if (hasActivity) reasons.push("已有真实搜索曝光或点击，保留");
  if (hasPage) reasons.push("已有实际展示或检测页面，保留");
  if (modelContext(input)) reasons.push("模型、新模型或新发布相关词，保留");
  let status: KeywordVolumeReview["status"];
  let label: string;
  if (reasons.length) { status = "protected"; label = "有价值信号，保留"; }
  else if (restoredDays != null && restoredDays < ZERO_VOLUME_MIN_DAYS) {
    status = "new_term"; label = "人工恢复观察，保留"; reasons.push("人工恢复后不足 60 天，保留观察；首次跟踪日期保持原值");
  } else if (trackedDays != null && trackedDays < ZERO_VOLUME_MIN_DAYS) {
    status = "new_term"; label = "新词观察，保留"; reasons.push("纳入本站跟踪不足 60 天，不凭零声量删除");
  } else if (trackedDays == null) {
    status = "insufficient_evidence"; label = "历史不足，保留"; reasons.push("缺少首次跟踪日期，无法确认已观察两个月");
  } else if (REGION_CODES.every(region => regions[region].isSustainedZero)) {
    status = "candidate"; label = "持续零声量，待复核"; reasons.push("已跟踪至少 60 天，四个国家均有连续零值证据，且未发现需求或页面保护信号");
  } else {
    status = "insufficient_evidence"; label = "历史不足，保留";
    reasons.push("四个跟踪国家尚未全部满足连续 60 天零声量证据，不能据此删除");
  }
  return { status, isCandidate: status === "candidate", label, reasons,
    firstTrackedAt: input.firstTrackedAt ?? null, trackedDays, regions };
}
