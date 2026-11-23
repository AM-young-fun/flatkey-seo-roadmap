/** Collection receipts use the same Los Angeles clock as the reporting data. */
export function keywordCaptureTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "待核对";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}
