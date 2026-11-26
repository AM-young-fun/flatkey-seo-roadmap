export type DateRange = {
    start: string;
    end: string;
};
export const shiftDay = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const propertyToday = (timeZone = "America/Los_Angeles") => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
export const SEO_REPORT_TIME_ZONE = "Asia/Shanghai";
export const seoToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: SEO_REPORT_TIME_ZONE }).format(now);

export const WEEKLY_REPORT_SWITCH_DATE = "2026-11-19";

// Keep an exact Friday archive address readable after preparation moves to Thursday.
export function weeklyReportDate(date: string): string {
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  const current = date >= WEEKLY_REPORT_SWITCH_DATE;
  if (current && weekday === 5) return date;
  return shiftDay(date, -((weekday - (current ? 4 : 5) + 7) % 7));
}

export function weeklyReportRange(date: string): DateRange {
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  const anchor = date >= WEEKLY_REPORT_SWITCH_DATE
    ? shiftDay(date, -((weekday - 4 + 7) % 7)) : weeklyReportDate(date);
  return { start: shiftDay(anchor, -7), end: shiftDay(anchor, -1) };
}

/** Daily observation only. Reports/season acceptance retain their own fixed weeks.
 * LA midnight follows real IANA DST; a Beijing date is never a source-day cutoff. */
export function latestClosedLa7DayRange(now = new Date(), endLimit?: string): DateRange {
  if (!Number.isFinite(now.getTime()) || endLimit && (!/^\d{4}-\d{2}-\d{2}$/.test(endLimit) || new Date(endLimit + "T00:00:00Z").toISOString().slice(0, 10) !== endLimit)) throw Error("invalid_rolling7_day");
  const lastClosed = shiftDay(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now), -1);
  const end = endLimit && endLimit < lastClosed ? endLimit : lastClosed;
  return { start: shiftDay(end, -6), end };
}

export function collectionDateRange(days: number, now: Date, sourceTimeZone = "America/Los_Angeles"): DateRange {
    const requestedEnd = shiftDay(seoToday(now), -1);
    const sourceToday = new Intl.DateTimeFormat("en-CA", { timeZone: sourceTimeZone }).format(now);
    const sourceEnd = shiftDay(sourceToday, -1);
    const end = requestedEnd < sourceEnd ? requestedEnd : sourceEnd;
    return { start: shiftDay(end, 1 - days), end };
}

export const defaultRange = (): DateRange => { const end = shiftDay(propertyToday(), -1); return { start: shiftDay(end, -29), end }; };
export function validRange(r: DateRange) { return [r.start, r.end].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d) && r.start <= r.end; }
export type ListDatePreset = "all" | "week" | "nextWeek" | "month" | "custom";
// Task delivery uses a Friday–Thursday business week. Stored plan weekStart
// values remain Monday keys; this is only the delivery/filtering window.
export function workWeekDateRange(today: string): DateRange {
  const weekday = new Date(today + "T00:00:00Z").getUTCDay();
  const start = shiftDay(today, -((weekday - 5 + 7) % 7));
  return { start, end: shiftDay(start, 6) };
}
export function listDateRange(preset: ListDatePreset, today: string, custom: DateRange, week: "calendar" | "work" = "calendar"): DateRange | null {
  if (preset === "custom") return validRange(custom) ? custom : null;
  if (preset === "nextWeek") return week === "work" ? workWeekDateRange(shiftDay(today, 7)) : null;
  if (preset === "week") {
    if (week === "work") return workWeekDateRange(today);
    const start = shiftDay(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7));
    return { start, end: shiftDay(start, 6) };
  }
  if (preset === "month") {
    const [year, month] = today.split("-").map(Number);
    return { start: today.slice(0, 8) + "01", end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
  }
  return null;
}
export function dateInListRange(value: string | null | undefined, range: DateRange | null) {
  if (!range) return true;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const day = value.length === 10 ? value : seoToday(date);
  return day >= range.start && day <= range.end;
}
export function previousRange(r: DateRange) { const n = (Date.parse(r.end) - Date.parse(r.start)) / 86400000 + 1; return { start: shiftDay(r.start, -n), end: shiftDay(r.start, -1) }; }

export function yearAgoRange(range: DateRange): DateRange {
  const previousYear = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
    return `${year - 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  };
  return { start: previousYear(range.start), end: previousYear(range.end) };
}

export function closedPreset(name: "yesterday" | "week" | "lastWeek" | "month", today = propertyToday()): DateRange | null {
  const end = shiftDay(today, -1);
  const weekStart = shiftDay(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 2) % 7));
  const range = name === "yesterday" ? { start: end, end }
    : name === "lastWeek" ? { start: shiftDay(weekStart, -7), end: shiftDay(weekStart, -1) }
    : { start: name === "week" ? weekStart : today.slice(0, 8) + "01", end };
  return range.start <= range.end ? range : null;
}
