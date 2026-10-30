import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeKeywordText } from "./keyword-relevance";
import type { SerpTarget } from "./serp-targets";
import type { SerpMonitorRunDto, SerpRegion } from "./serp-monitor-types";

export const OPTIMIZED_PAGE_SCOPE = "OPTIMIZED_PAGE";
export const OPTIMIZED_PAGE_MAX_QUERIES = 100;
export const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

// Anchors and tracking parameters identify the same page and share its daily allowance.
export function optimizedPageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["flatkey.ai", "www.flatkey.ai"].includes(url.hostname) || url.port || url.username || url.password) return null;
    url.hostname = "flatkey.ai";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href;
  } catch { return null; }
}
export const optimizedPageId = (url: string) => createHash("sha256").update(url).digest("hex");
export const monitorDay = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const optimizedPagePeriod = (pageId: string, day: string) => `${day}:page:${pageId}`;
export const optimizedPageMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), pageId: z.string().regex(/^[a-f0-9]{64}$/), expectedHash: z.string().regex(/^[a-f0-9]{64}$/), day: z.iso.date() }).strict(),
  z.object({ action: z.literal("retry"), runId: z.string().regex(/^optimized-\d{4}-\d{2}-\d{2}-[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("poll"), runId: z.string().regex(/^optimized-\d{4}-\d{2}-\d{2}-[a-f0-9]{64}$/) }).strict(),
]);
export type OptimizedPageMutation = z.infer<typeof optimizedPageMutationSchema>;
export type OptimizedPageTarget = { id: string; url: string; title: string; optimizedAt: string | null; optimizationNote: string | null; sourceRows: string[]; keywords: string[]; targets: SerpTarget[]; sourceKeywordCount: number; hash: string };
export type OptimizedPageRank = { keyword: string; region: SerpRegion; rank: number | null; status: string; checkedAt: string | null; googleUrl: string | null; otherPages: Array<{ url: string; rank: number }> };
export type OptimizedPageMonitorResponse = {
  day: string; connectionConfigured: boolean; externalEnabled: boolean; activeRunId: string | null;
  pages: Array<OptimizedPageTarget & { queryCount: number; maxCostMicros: number; usedToday: boolean; retryableTaskCount: number; run: SerpMonitorRunDto | null; results: OptimizedPageRank[]; previousResults: OptimizedPageRank[]; attemptResults?: OptimizedPageRank[]; siteResults?: OptimizedPageRank[]; previousSiteResults?: OptimizedPageRank[] }>;
};

export function buildOptimizedPages(rows: Array<{ rowKey: string; snapshot: unknown }>, targets: SerpTarget[]): OptimizedPageTarget[] {
  const groups = new Map<string, { url: string; title: string; optimizedAt: string | null; optimizationNote: string | null; rowKeys: Set<string>; words: Set<string>; eligible: Map<string, SerpTarget> }>();
  const byWord = new Map(targets.map(target => [normalizeKeywordText(target.keyword), target]));
  for (const row of rows) {
    const snapshot = record(row.snapshot);
    // Source publication/intent flags describe that sync, not later audits.
    // Display completed pages even when an older sync omitted verification.
    if (snapshot.completion !== "COMPLETED") continue;
    const url = typeof snapshot.pageUrl === "string" ? optimizedPageUrl(snapshot.pageUrl) : null;
    if (!url) continue;
    const group = groups.get(url) ?? { url, title: typeof snapshot.title === "string" ? snapshot.title : url, optimizedAt: null, optimizationNote: null, rowKeys: new Set<string>(), words: new Set<string>(), eligible: new Map<string, SerpTarget>() };
    const optimizedAt = typeof snapshot.optimizedAt === "string" &&
      (z.iso.date().safeParse(snapshot.optimizedAt).success || z.iso.datetime({ offset: true }).safeParse(snapshot.optimizedAt).success) ? snapshot.optimizedAt : null;
    if (optimizedAt && (!group.optimizedAt || Date.parse(optimizedAt) > Date.parse(group.optimizedAt))) {
      group.optimizedAt = optimizedAt;
      group.optimizationNote = typeof snapshot.optimizationNote === "string" ? snapshot.optimizationNote : null;
    }
    group.rowKeys.add(row.rowKey);
    for (const raw of Array.isArray(snapshot.keywords) ? snapshot.keywords : []) {
      const word = record(raw);
      if (typeof word.keyword !== "string") continue;
      const key = normalizeKeywordText(word.keyword); group.words.add(key);
      const target = byWord.get(key);
      // The monitoring cohort already requires a formal keyword and verified
      // page evidence. Legacy REVIEW flags must not veto that independent
      // approval; keep explicit exclusions and exact page matching in force.
      if (!target || word.relevance === "UNRELATED" ||
        !target.targetUrls.some(page => optimizedPageUrl(page) === url)) continue;
      group.eligible.set(target.keywordId, { ...target, targetUrls: [url] });
    }
    groups.set(url, group);
  }
  return [...groups.values()].map(group => {
    const selected = [...group.eligible.values()].sort((a, b) => a.keywordId.localeCompare(b.keywordId));
    const id = optimizedPageId(group.url);
    return { id, url: group.url, title: group.title, optimizedAt: group.optimizedAt, optimizationNote: group.optimizationNote, sourceRows: [...group.rowKeys].sort(), keywords: [...group.words], targets: selected, sourceKeywordCount: group.words.size,
      hash: createHash("sha256").update(JSON.stringify({ id, targets: selected })).digest("hex") };
  }).sort((a, b) => a.url.localeCompare(b.url));
}

export function optimizedPageRank(pageUrl: string, task: { keyword: string; region: string; state: string; normalizedJson: unknown; checkedAt: Date | null }): OptimizedPageRank {
  const result = record(task.normalizedJson);
  const checkedAt = task.checkedAt?.toISOString() ?? null;
  const base: OptimizedPageRank = { keyword: task.keyword, region: task.region as SerpRegion, rank: null, status: task.state, checkedAt, googleUrl: typeof result.googleUrl === "string" ? result.googleUrl : null, otherPages: [] };
  if (!["COMPLETE", "INCOMPLETE"].includes(task.state)) return base;
  if (result.queryStatus === "AUTOCORRECTED") return { ...base, status: "QUERY_CHANGED" };
  if (!checkedAt || result.queryStatus !== "EXACT" || result.rankingVerified !== true) return { ...base, status: "INCOMPLETE" };
  const pages = (Array.isArray(result.organicResults) ? result.organicResults : []).flatMap(raw => {
    const row = record(raw);
    return typeof row.url === "string" && optimizedPageUrl(row.url) && Number.isInteger(row.rankGroup) && Number(row.rankGroup) > 0 && Number(row.rankGroup) <= 100 ? [{ url: row.url, rank: Number(row.rankGroup) }] : [];
  }).sort((a, b) => a.rank - b.rank);
  const match = pages.find(page => optimizedPageUrl(page.url) === optimizedPageUrl(pageUrl));
  return { ...base, rank: match?.rank ?? null, otherPages: pages.filter(page => optimizedPageUrl(page.url) !== optimizedPageUrl(pageUrl)),
    status: match ? "RANKED" : result.completeDepth === true && result.captureComplete === true ? "OUTSIDE_TOP100" : "NOT_FOUND_CAPTURE" };
}

export type SavedPageRankingTask = { id?: string; pageUrl?: string; keyword: string; region: string; state: string; normalizedJson: unknown; checkedAt: Date | null };
export function savedPageRankingComparison(pageUrl: string, keywords: string[], saved: SavedPageRankingTask[], latest?: { startedAt: Date; tasks: SavedPageRankingTask[] }, previous?: { tasks: SavedPageRankingTask[] }, siteBest = false) {
  const results: OptimizedPageRank[] = [], previousResults: OptimizedPageRank[] = [];
  const tasks = [...saved.filter(task => !task.pageUrl || task.pageUrl === pageUrl), ...(latest?.tasks ?? []), ...(previous?.tasks ?? [])];
  for (const keyword of keywords) for (const region of ["US", "JP", "ES", "BR"]) {
    const sameQuery = (task: SavedPageRankingTask) => normalizeKeywordText(task.keyword) === normalizeKeywordText(keyword) && task.region === region;
    // Rank evidence is shared across manual and scheduled captures. Pending or
    // invalid attempts must not hide the most recent valid rank for this page.
    const history = tasks.filter(sameQuery).map(task => optimizedPageRank(pageUrl, task))
      .filter(rank => rank.status === "RANKED" || rank.status === "OUTSIDE_TOP100" || siteBest && rank.status === "NOT_FOUND_CAPTURE" && rank.otherPages.length > 0)
      .sort((a, b) => Date.parse(b.checkedAt!) - Date.parse(a.checkedAt!));
    const fallback = latest?.tasks.find(sameQuery);
    const current = history[0] ?? (fallback ? optimizedPageRank(pageUrl, fallback) : undefined);
    if (!current) continue;
    results.push(current);
    // A task may appear in both the shared history and the manual ledger.
    // Only an earlier capture can supply the comparison, never that same task.
    const prior = history.find(rank => Date.parse(rank.checkedAt!) < Date.parse(current.checkedAt ?? ""));
    if (prior) previousResults.push(prior);
  }
  return { results, previousResults };
}
