export type SerpPeriod = { key: string; label: string; start: string; end: string; dueAt: string };
const monthText = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

export function serpPeriodFromKey(key: string): SerpPeriod {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return biweeklyPeriod(key);
  const match = /^(\d{4})-(0[1-9]|1[0-2])-([12])$/.exec(key);
  if (!match) throw new Error("INVALID_SERP_PERIOD");
  const year = Number(match[1]), month = Number(match[2]), part = Number(match[3]);
  if (year < 2020 || year > 9998) throw new Error("INVALID_SERP_PERIOD");
  const prefix = monthText(year, month), start = `${prefix}-${part === 1 ? "01" : "16"}`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { key, label: `${year}年${month}月第${part}期`, start,
    end: `${prefix}-${part === 1 ? "15" : String(lastDay)}`, dueAt: `${start}T02:30:00.000Z` };
}

const ANCHOR = "2026-10-20";
export const SERP_SCHEDULE_LOCAL_TIME = "16:00";
// Apply the new clock to the next unelapsed slot, preserving historical ledgers.
const AFTERNOON_SCHEDULE_FIRST_PERIOD = "2026-12-01";
const DAY = 86400000;
function addDays(day: string, count: number) { return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10); }
function biweeklyPeriod(start: string): SerpPeriod {
  const parsed = Date.parse(`${start}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== start ||
      (parsed - Date.parse(`${ANCHOR}T00:00:00Z`)) % (14 * DAY)) throw new Error("INVALID_SERP_PERIOD");
  const year = Number(start.slice(0, 4)), month = Number(start.slice(5, 7));
  const firstDay = `${start.slice(0, 7)}-01`;
  const firstSlot = addDays(ANCHOR, Math.ceil((Date.parse(`${firstDay}T00:00:00Z`) - Date.parse(`${ANCHOR}T00:00:00Z`)) / (14 * DAY)) * 14);
  const part = Math.round((parsed - Date.parse(`${firstSlot}T00:00:00Z`)) / (14 * DAY)) + 1;
  // Keep Tuesday IDs, the 14-day phase, and already elapsed capture slots.
  const clock = start >= AFTERNOON_SCHEDULE_FIRST_PERIOD ? SERP_SCHEDULE_LOCAL_TIME : start >= "2026-11-17" ? "10:10" : "08:00";
  const dueAt = start >= "2026-11-03"
    ? new Date(`${addDays(start, 2)}T${clock}:00+08:00`).toISOString()
    : `${start}T02:30:00.000Z`;
  return { key: start, label: `${year}年${month}月第${part}期`, start, end: addDays(start, 13), dueAt };
}
export function serpPeriod(value: Date | string = new Date()): SerpPeriod {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_SERP_PERIOD_DATE");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
  const offset = Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${ANCHOR}T00:00:00Z`)) / (14 * DAY));
  return biweeklyPeriod(addDays(ANCHOR, offset * 14));
}

export function storedSerpPeriod(value: Date | string): SerpPeriod {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(value));
  return day < ANCHOR ? serpPeriodFromKey(`${day.slice(0, 7)}-${Number(day.slice(8, 10)) <= 15 ? 1 : 2}`) : serpPeriod(value);
}

export function nextSerpPeriodKey(key: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return biweeklyPeriod(addDays(key, 14)).key;
  const period = serpPeriodFromKey(key), year = Number(period.start.slice(0, 4)), month = Number(period.start.slice(5, 7));
  return key.endsWith("-1") ? `${monthText(year, month)}-2` : `${monthText(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)}-1`;
}

export function periodDue(key: string): Date {
  return new Date(serpPeriodFromKey(key).dueAt);
}

/** Associates a real scheduled run with a closed LA report week; it is not proof of collection. */
export function serpCaptureBelongsToWeek(periodKey: string, start: string, end: string): boolean {
  try {
    const captureDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(periodDue(periodKey));
    const closedWeekSlot = /^\d{4}-\d{2}-\d{2}$/.test(periodKey) && periodKey >= AFTERNOON_SCHEDULE_FIRST_PERIOD &&
      new Date(start + "T00:00:00Z").getUTCDay() === 4 && new Date(end + "T00:00:00Z").getUTCDay() === 3;
    return closedWeekSlot ? captureDay === addDays(end, 1) : captureDay >= start && captureDay <= end;
  } catch { return false; }
}

// Interpret a persisted schedule cursor using its original period key. This
// lets an already-enabled future schedule move without touching its gates,
// budget, revision, or an unfinished/completed paid ledger.
export function scheduledSerpDue(value: Date | string): Date {
  const date = new Date(value), key = storedSerpPeriod(date).key;
  if (key < "2026-11-03") return date;
  const previousSlots = [
    `${key}T02:30:00.000Z`,
    new Date(`${key}T00:00:00+08:00`).toISOString(),
    `${addDays(key, 2)}T00:00:00.000Z`,
    `${addDays(key, 2)}T02:10:00.000Z`,
  ];
  return previousSlots.includes(date.toISOString()) ? periodDue(key) : date;
}

// The next fixed slot belongs to the next reporting period, never completion
// time plus an arbitrary number of days or a second charge in the same period.
export function nextSerpPeriodDue(value: Date | string = new Date()): Date {
  return periodDue(nextSerpPeriodKey(serpPeriod(value).key));
}
