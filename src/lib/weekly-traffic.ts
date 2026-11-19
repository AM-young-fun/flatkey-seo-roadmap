export function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shift(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return dateString(date);
}

export const WEEKLY_REPORT_TIMEZONE = "America/Los_Angeles";
export const THURSDAY_REPORT_START = "2026-11-12";

export function isThursdayReport(start: string): boolean {
  return start >= THURSDAY_REPORT_START && new Date(`${start}T00:00:00Z`).getUTCDay() === 4;
}

// A closed calendar week does not imply that GA4/GSC have finished processing it.
export function weeklyPeriods(now = new Date(), timezone = WEEKLY_REPORT_TIMEZONE) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  // Preserve old calendars when inspecting historical collection times.
  const endDay = today >= "2026-11-19" ? 3 : today >= "2026-10-23" ? 4 : 1;
  const end = shift(today, -((weekday - endDay + 7) % 7 || 7));
  return {
    current: { start: shift(end, -6), end },
    previous: { start: shift(end, -13), end: shift(end, -7) },
  };
}

export function reportPeriods(start: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start)) || dateString(new Date(start)) !== start || !isWeeklyPeriod(start, shift(start, 6))) throw new Error("周报日期无效");
  return { current: { start, end: shift(start, 6) }, previous: { start: shift(start, -7), end: shift(start, -1) } };
}

// Show the week being prepared on the day before publication. Import
// completeness is validated separately against the property timezone/cutoff.
export function activeReportPeriods(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  // New Thursday reports appear only after Wednesday has closed in Los Angeles.
  if (today >= "2026-11-19") return weeklyPeriods(now);
  const closed = weeklyPeriods(now, "Asia/Shanghai");
  return new Date(`${today}T00:00:00Z`).getUTCDay() === (today >= "2026-10-23" ? 4 : 1) ? reportPeriods(shift(closed.current.start, 7)) : closed;
}

export function isWeeklyPeriod(start: string, end: string): boolean {
  const weekday = new Date(`${start}T00:00:00Z`).getUTCDay();
  // Historical Tuesday/Friday reports retain their original dates.
  return (weekday === 2 || weekday === 5 || isThursdayReport(start)) && shift(start, 6) === end;
}

export function registrationRate(users: number, registrations: number): number | null {
  return users > 0 ? registrations / users : null;
}

export function relativeChange(current: number | null, previous: number | null): number | null {
  return current === null || previous === null || previous === 0 ? null : (current - previous) / previous;
}
