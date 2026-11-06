export type DateRange = {
    start: string;
    end: string;
};
export const shiftDay = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const propertyToday = (timeZone = "America/Los_Angeles") => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
export const defaultRange = (): DateRange => { const end = shiftDay(propertyToday(), -1); return { start: shiftDay(end, -29), end }; };
export function validRange(r: DateRange) { return [r.start, r.end].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d) && r.start <= r.end; }
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
