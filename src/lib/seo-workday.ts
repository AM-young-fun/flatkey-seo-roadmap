import { isSeoWorkday } from "../../scripts/lib/seo-workday.cjs";
export { isSeoWorkday };

const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });
const workdayTimeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Return a Beijing calendar date, honoring the same holidays and makeup days as scheduling. */
export function nextSeoWorkdayDate(now: Date, includeToday = false): string {
  let day = dateFormat.format(now);
  const advance = () => { day = new Date(Date.parse(day + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10); };
  if (!includeToday) advance();
  while (!isSeoWorkday(new Date(day + "T00:00:00+08:00"))) advance();
  return day;
}

/** Work due for follow-up joins today's working window only before its 18:30 close. */
export function seoCatchUpDate(now: Date): string {
  if (isSeoWorkday(now) && workdayTimeFormat.format(now) < "18:30") return dateFormat.format(now);
  return nextSeoWorkdayDate(now);
}
