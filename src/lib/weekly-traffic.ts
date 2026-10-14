export function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shift(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return dateString(date);
}

// Reports use completed days in the GA4 property's reporting timezone.
export function weeklyPeriods(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  // Monday is still in progress: only include it starting on Tuesday.
  const end = shift(today, -((weekday + 6) % 7 || 7));
  return {
    current: { start: shift(end, -6), end },
    previous: { start: shift(end, -13), end: shift(end, -7) },
  };
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
