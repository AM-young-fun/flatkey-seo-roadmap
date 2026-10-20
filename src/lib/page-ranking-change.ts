import type { OptimizedPageRank } from "./optimized-page-monitor";

export function pageRankingChange(current?: OptimizedPageRank, previous?: OptimizedPageRank): { label: string; direction: "up" | "down" | null; comparable: boolean } {
  const valid = (item?: OptimizedPageRank) => item && (item.status === "OUTSIDE_TOP100" || item.status === "RANKED" && Number.isInteger(item.rank) && Number(item.rank) >= 1 && Number(item.rank) <= 100);
  if (!valid(current)) return { label: "—", direction: null, comparable: false };
  if (!previous) return { label: "首次记录", direction: null, comparable: false };
  if (!valid(previous)) return { label: "—", direction: null, comparable: false };
  if (current?.rank != null && previous.rank != null) {
    const delta = previous.rank - current.rank;
    return { label: delta > 0 ? `↑ ${delta}` : delta < 0 ? `↓ ${-delta}` : "持平", direction: delta > 0 ? "up" : delta < 0 ? "down" : null, comparable: true };
  }
  if (current?.rank != null) return { label: "进入前100", direction: "up", comparable: true };
  if (previous.rank != null) return { label: "跌出前100", direction: "down", comparable: true };
  return { label: "持平", direction: null, comparable: true };
}
