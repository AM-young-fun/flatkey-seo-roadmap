export type DateRange = {
    start: string;
    end: string;
};
export const shiftDay = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const propertyToday = (timeZone = "America/Los_Angeles") => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
export const SEO_REPORT_TIME_ZONE = "Asia/Shanghai";
export const seoToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: SEO_REPORT_TIME_ZONE }).format(now);

export function collectionDateRange(days: number, now: Date, sourceTimeZone = "America/Los_Angeles"): DateRange {
    const requestedEnd = shiftDay(seoToday(now), -1);
    const sourceToday = new Intl.DateTimeFormat("en-CA", { timeZone: sourceTimeZone }).format(now);
    const sourceEnd = shiftDay(sourceToday, -1);
    const end = requestedEnd < sourceEnd ? requestedEnd : sourceEnd;
    return { start: shiftDay(end, 1 - days), end };
}

export const defaultRange = (): DateRange => { const end = shiftDay(propertyToday(), -1); return { start: shiftDay(end, -29), end }; };
export function validRange(r: DateRange) { return [r.start, r.end].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d) && r.start <= r.end; }
export type ListDatePreset = "all" | "week" | "month" | "custom";
export function listDateRange(preset: ListDatePreset, today: string, custom: DateRange): DateRange | null {
  if (preset === "custom") return validRange(custom) ? custom : null;
  if (preset === "week") {
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
