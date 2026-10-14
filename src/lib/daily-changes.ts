export type CaptureRank = { keywordId: string; rank: number | null; rankStatus: string };

export function compareCaptures(current: CaptureRank[], previous: CaptureRank[] | null, eligible: Set<string>) {
  const now = new Map(current.map((row) => [row.keywordId, row]));
  const ranked = (row: CaptureRank) => row.rankStatus === "ranked" && row.rank !== null && row.rank <= 100;
  const currentIds = new Set(current.filter((row) => eligible.has(row.keywordId) && ranked(row)).map((row) => row.keywordId));
  if (!previous) return { count: currentIds.size, baseline: true, entered: [], lost: [], missing: [], detectedReduction: null, net: null };
  const previousIds = new Set(previous.filter((row) => eligible.has(row.keywordId) && ranked(row)).map((row) => row.keywordId));
  const entered = [...currentIds].filter((id) => !previousIds.has(id));
  const removed = [...previousIds].filter((id) => !currentIds.has(id));
  const lost = removed.filter((id) => now.get(id)?.rankStatus === "outside_top100");
  const missing = removed.filter((id) => now.get(id)?.rankStatus !== "outside_top100");
  return { count: currentIds.size, baseline: false, entered, lost, missing, detectedReduction: removed.length, net: currentIds.size - previousIds.size };
}
