export type SerpPeriod = { key: string; label: string; start: string; end: string; dueAt: string };
const monthText = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

export function serpPeriodFromKey(key: string): SerpPeriod {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-([12])$/.exec(key);
  if (!match) throw new Error("INVALID_SERP_PERIOD");
  const year = Number(match[1]), month = Number(match[2]), part = Number(match[3]);
  if (year < 2020 || year > 9998) throw new Error("INVALID_SERP_PERIOD");
  const prefix = monthText(year, month), start = `${prefix}-${part === 1 ? "01" : "16"}`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { key, label: `${year}年${month}月第${part}期`, start,
    end: `${prefix}-${part === 1 ? "15" : String(lastDay)}`, dueAt: `${start}T02:30:00.000Z` };
}

export function serpPeriod(value: Date | string = new Date()): SerpPeriod {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_SERP_PERIOD_DATE");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
  return serpPeriodFromKey(`${day.slice(0, 7)}-${Number(day.slice(8, 10)) <= 15 ? 1 : 2}`);
}

export function nextSerpPeriodKey(key: string): string {
  const period = serpPeriodFromKey(key), year = Number(period.start.slice(0, 4)), month = Number(period.start.slice(5, 7));
  return key.endsWith("-1") ? `${monthText(year, month)}-2` : `${monthText(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)}-1`;
}

export function periodDue(key: string): Date {
  return new Date(serpPeriodFromKey(key).dueAt);
}

// The next fixed slot belongs to the next reporting period, never completion
// time plus an arbitrary number of days or a second charge in the same period.
export function nextSerpPeriodDue(value: Date | string = new Date()): Date {
  return periodDue(nextSerpPeriodKey(serpPeriod(value).key));
}
