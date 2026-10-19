export function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shift(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return dateString(date);
}

// Reports use completed days in the GA4 property's reporting timezone.
export function weeklyPeriods(now = new Date(), timezone = "Asia/Shanghai") {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  // Monday is still in progress: only include it starting on Tuesday.
  const end = shift(today, -((weekday + 6) % 7 || 7));
  return {
    current: { start: shift(end, -6), end },
    previous: { start: shift(end, -13), end: shift(end, -7) },
  };
}

export function reportPeriods(start: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start)) || dateString(new Date(start)) !== start || !isWeeklyPeriod(start, shift(start, 6))) throw new Error("周报日期无效");
  return { current: { start, end: shift(start, 6) }, previous: { start: shift(start, -7), end: shift(start, -1) } };
}

// On Monday show the report being prepared for Tuesday, without calling the
// still-open GA4 week complete. Imports continue to use weeklyPeriods().
export function activeReportPeriods(now = new Date()) {
  const closed = weeklyPeriods(now);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  return new Date(`${today}T00:00:00Z`).getUTCDay() === 1 ? reportPeriods(shift(closed.current.start, 7)) : closed;
}

export function isWeeklyPeriod(start: string, end: string): boolean {
  return new Date(`${start}T00:00:00Z`).getUTCDay() === 2 && shift(start, 6) === end;
}

export function registrationRate(users: number, registrations: number): number | null {
  return users > 0 ? registrations / users : null;
}

export function relativeChange(current: number | null, previous: number | null): number | null {
  return current === null || previous === null || previous === 0 ? null : (current - previous) / previous;
}
