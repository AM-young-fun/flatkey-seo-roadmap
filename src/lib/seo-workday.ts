const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });

// State Council General Office notices: 国办发明电〔2025〕7号 and 〔2026〕10号.
const holidays = [
  ["2026-01-01", "2026-01-03"],
  ["2026-02-15", "2026-02-23"],
  ["2026-04-04", "2026-04-06"],
  ["2026-05-01", "2026-05-05"],
  ["2026-06-19", "2026-06-21"],
  ["2026-09-25", "2026-09-27"],
  ["2026-10-01", "2026-10-07"],
  ["2027-01-01", "2027-01-03"],
  ["2027-02-05", "2027-02-13"],
  ["2027-04-03", "2027-04-05"],
  ["2027-05-01", "2027-05-05"],
  ["2027-06-09", "2027-06-09"],
  ["2027-09-15", "2027-09-15"],
  ["2027-10-01", "2027-10-07"],
];

const makeupDays = new Set([
  "2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10",
  "2027-01-31", "2027-02-14", "2027-05-08", "2027-09-26", "2027-10-09",
]);

export function isSeoWorkday(now: Date): boolean {
  const date = dateFormat.format(now);
  if (makeupDays.has(date)) return true;
  if (holidays.some(([start, end]) => date >= start && date <= end)) return false;

  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  return weekday >= 1 && weekday <= 5;
}
