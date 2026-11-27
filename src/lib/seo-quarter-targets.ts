import { shiftDay } from "./seo-date-range";
import { isSeoWorkday } from "./seo-workday";

export const CLOSEOUT_START = "2026-11-27";
export const CLOSEOUT_END = "2027-02-05";
export const CLOSEOUT_MARKET_POLICY = "closeout-capacity-v1";
export const CLOSEOUT_TRAFFIC_TARGET = 1075;
export const ORDINARY_COVERAGE_GOAL = 90;

export const closeoutMarketShares = [
  { country: "BR", language: "pt-BR", label: "巴西 · 葡语", share: 35 },
  { country: "US", language: "en", label: "美国 · 英语", share: 25 },
  { country: "JP", language: "ja", label: "日本 · 日语", share: 18 },
  { country: "SG", language: "zh-CN", label: "新加坡 · 简中", share: 12 },
  { country: "ES", language: "es-ES", label: "西班牙 · 西语", share: 3.5 },
  { country: "DE", language: "de", label: "德国 · 德语", share: 2.5 },
  { country: "FR", language: "fr", label: "法国 · 法语", share: 2 },
  { country: "VN", language: "vi", label: "越南 · 越语", share: 1 },
  { country: "ID", language: "id", label: "印度尼西亚 · 印尼语", share: 1 },
] as const;

function apportion(total: number, weights: readonly number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const rows = weights.map((weight, index) => ({ index, count: Math.floor(total * weight / sum), remainder: total * weight % sum }));
  const unassigned = total - rows.reduce((n, row) => n + row.count, 0);
  const extras = new Set([...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index).slice(0, unassigned).map(row => row.index));
  return rows.map(row => row.count + Number(extras.has(row.index)));
}

export function closeoutMarketTargets(total: number) {
  const main = apportion(total, [35, 25, 18, 12, 10]);
  const other = apportion(main[4], [35, 25, 20, 10, 10]);
  const counts = [...main.slice(0, 4), ...other];
  return closeoutMarketShares.map((market, index) => ({ ...market, target: counts[index] }));
}

export function closeoutBusinessWeeks(start = CLOSEOUT_START, cutoff = CLOSEOUT_END) {
  const result = [];
  for (let day = start; shiftDay(day, 6) <= cutoff; day = shiftDay(day, 7)) {
    const dates = Array.from({ length: 7 }, (_, offset) => shiftDay(day, offset))
      .filter(date => isSeoWorkday(new Date(date + "T12:00:00+08:00")));
    const flatkeyLandings = dates.length ? 2 : 0, satelliteLandings = dates.length + Math.min(2, dates.length);
    const flatkeyBlogs = dates.length * 5, modelFitBlogs = flatkeyBlogs, refreshes = flatkeyBlogs;
    result.push({ start: day, end: shiftDay(day, 6), weekStart: shiftDay(day, 3), dates,
      flatkeyBlogs, modelFitBlogs, flatkeyLandings, satelliteLandings, refreshes,
      newKeywords: flatkeyBlogs + modelFitBlogs + flatkeyLandings + satelliteLandings });
  }
  return result;
}

export const closeoutTrafficMilestones = [275, 320, 375, 435, 505, 590, 685, 795, 925, CLOSEOUT_TRAFFIC_TARGET].map((target, index) => ({
  start: shiftDay("2026-11-26", index * 7), end: shiftDay("2026-11-26", index * 7 + 6), target,
}));

const pricing = "/blog/gemini-api-pricing";
export const closeoutCoreKeywords = [
  { keyword: "api gemini preço", country: "BR", language: "pt-BR", path: "/pt" + pricing, rankTarget: 5, clickFloor: 5, baseline: { impressions: 46, clicks: 1 } },
  { keyword: "aluguel gpu", country: "BR", language: "pt-BR", path: "/pt/compute", rankTarget: 20, clickFloor: 10 },
  { keyword: "gemini api pricing", country: "US", language: "en", path: pricing, rankTarget: 15, clickFloor: 10 },
  { keyword: "google gemini api free tier rate limits 2026", country: "US", language: "en", path: pricing, rankTarget: 10, clickFloor: 15 },
  { keyword: "gpu rental prices", country: "US", language: "en", path: "/blog/gpu-rental-prices-guide", rankTarget: 20, clickFloor: 10 },
  { keyword: "h100 rental", country: "US", language: "en", path: "/compute", rankTarget: 30, clickFloor: 5 },
  { keyword: "ai api gateway", country: "US", language: "en", path: "/blog/ai-api-gateway", rankTarget: 30, clickFloor: 5 },
  { keyword: "claude api pricing", country: "US", language: "en", path: "/blog/claude-api-pricing", rankTarget: 20, clickFloor: 10 },
  { keyword: "deepseek api pricing", country: "US", language: "en", path: "/blog/deepseek-api-pricing", rankTarget: 20, clickFloor: 10 },
  { keyword: "gemini api モデル 一覧 料金", country: "JP", language: "ja", path: "/ja" + pricing, rankTarget: 5, clickFloor: 10, baseline: { impressions: 49, clicks: 3 } },
  { keyword: "gemini模型价格", country: "SG", language: "zh-CN", path: "/zh" + pricing, rankTarget: 5, clickFloor: 5, baseline: { impressions: 21, clicks: 2 } },
] as const;
export const CLOSEOUT_CORE_BASELINE = { start: "2026-10-28", end: "2026-11-24" };

export function closeoutCoreKey(country: string | null, language: string | null, keyword: string) {
  return [country, language, keyword.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase()].join(":");
}

export function closeoutCoreGoals(word: typeof closeoutCoreKeywords[number], baseline = ("baseline" in word ? word.baseline : null) as { impressions: number; clicks: number } | null) {
  const ctr = baseline?.impressions ? 100 * baseline.clicks / baseline.impressions : null;
  return { impressions: baseline ? Math.ceil(1.5 * baseline.impressions) : null,
    clicks: Math.max(word.clickFloor, Math.ceil(1.5 * (baseline?.clicks ?? 0))),
    ctr: ctr === null ? null : ctr < 5 ? ctr + 1 : ctr };
}

export const closeoutGeminiWeeks = [
  { start: "2026-11-27", focus: "巴西定价需求，沿已确认原文补 AI Studio 配额和 429 排错" },
  { start: "2026-12-04", focus: "巴西葡语计费、免费额度和成本计算" },
  { start: "2026-12-11", focus: "美国接入、模型选择和费用测算，日本旧页价格表与免费配额" },
  { start: "2026-12-18", focus: "新加坡简中模型定价与配额，复查前三周效果" },
] as const;
