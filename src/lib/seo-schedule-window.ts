export function seoScheduleOpensAt(now: Date): number {
  const shanghaiDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  return Date.parse(`${shanghaiDay}T10:10:00+08:00`);
}
