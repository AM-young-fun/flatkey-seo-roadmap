"use strict";

const beijingDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });
const beijingClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const sourceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });

function shiftDate(day, days) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function seoCollectionWindow(now = new Date()) {
  const businessDate = beijingDate.format(now);
  const dayOfWeek = new Date(businessDate + "T00:00:00Z").getUTCDay();
  const monday = dayOfWeek === 1;
  const weekend = dayOfWeek === 0 || dayOfWeek === 6;
  const clock = beijingClock.format(now);
  const current = shiftDate(sourceDate.format(now), -1);

  // Report day D is tied to the closed Los Angeles source day D−1.
  // Monday can also process Friday, whose Beijing report would have run Saturday.
  const scheduledSourceDates = weekend || clock < "16:00" ? []
    : (monday ? [-2, -1, 0] : [0]).map(offset => shiftDate(current, offset));
  const retrySourceDate = scheduledSourceDates.length && !monday ? shiftDate(current, -1) : null;
  return {
    businessDate, weekend, scheduledSourceDates,
    retrySourceDate,
    dailyReportDates: clock >= "18:00" ? scheduledSourceDates.map(day => shiftDate(day, 1)) : [],
    retryReportDate: clock >= "18:00" && retrySourceDate ? shiftDate(retrySourceDate, 1) : null,
    patrolDate: clock < "16:00" ? null : businessDate,
  };
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(seoCollectionWindow()) + "\n");
}

module.exports = { seoCollectionWindow };
