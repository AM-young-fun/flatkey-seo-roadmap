import { reportPeriods, weeklyPeriods } from "./weekly-traffic";

export const SOURCE_IDS = ["api_main", "cloud_main", "optimization"] as const;
export const jobLabels: Record<string, string> = {
  QUEUED: "已排队", RUNNING: "执行中", WAITING_DATA: "等待完整周数据", WAITING_KEYWORDS: "等待关键词完成",
  BLOCKED: "待连接", RETRY: "等待重试", FAILED: "执行失败", COMPLETED: "已完成", SUPERSEDED: "已跳过过期检查",
};
export const beijingDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
const at = (day: string, clock: string) => new Date(`${day}T${clock}:00+08:00`);
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function projectDueJobs(now: Date) {
  const today = beijingDay(now), daily = at(today, "10:30"), periods = weeklyPeriods(now);
  const publication = shift(periods.current.end, 1), weekly = at(publication, "10:30");
  return [
    ...(now >= daily ? SOURCE_IDS.map(sourceId => ({ id: `sheets:${sourceId}:${today}`, kind: "SHEETS", sourceId, periodStart: today, dueAt: daily, nextAttemptAt: daily })) : []),
    ...(now >= weekly && publication >= "2026-10-20" ? [{ id: `traffic:${periods.current.start}`, kind: "TRAFFIC", periodStart: periods.current.start, dueAt: weekly, nextAttemptAt: weekly }] : []),
  ];
}
export function trafficReadyAt(periodStart: string) {
  // 18:30 Beijing is after Monday ends in Los Angeles in both PST and PDT.
  return at(shift(reportPeriods(periodStart).current.end, 1), "18:30");
}
export function nextDailyAt(now: Date) {
  const today = beijingDay(now), due = at(today, "10:30");
  return (now < due ? due : at(shift(today, 1), "10:30")).toISOString();
}
export function nextWeeklyAt(now: Date) {
  const current = weeklyPeriods(now).current, publication = shift(current.end, 1), due = at(publication, "10:30");
  return (now < due ? due : at(shift(publication, 7), "10:30")).toISOString();
}
export const retryAt = (attempt: number, now: Date) => new Date(now.getTime() + Math.min(60, 5 * 2 ** Math.max(0, attempt - 1)) * 60000);
