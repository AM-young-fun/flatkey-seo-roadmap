/* global module */
"use strict";

// Report clocks are independent of the content workflow's Beijing calendar.
const SEO_REPORT_LA_TIME_ZONE = "America/Los_Angeles";
const SEO_REPORT_LA_SWITCH_DATE = "2026-11-19";
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: SEO_REPORT_LA_TIME_ZONE });
const clockFormat = new Intl.DateTimeFormat("en-CA", { timeZone: SEO_REPORT_LA_TIME_ZONE, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function reportDay(now = new Date()) { return dayFormat.format(now); }
function reportStamp(value) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: SEO_REPORT_LA_TIME_ZONE, hour12: false,
    dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

/** Resolve an LA wall clock; a spring gap rolls forward by the skipped interval. */
function reportTime(day, hour = 0, minute = 0) {
  const target = Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  if (!Number.isFinite(target)) throw Error("invalid_report_time");
  let instant = target;
  const candidates = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const parts = Object.fromEntries(clockFormat.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    if (local === target) return new Date(instant).toISOString();
    candidates.push({ instant, local });
    instant += target - local;
  }
  // Preview/archive creation must remain available on the missing 02:00 day.
  // Scheduled sending separately skips that nonexistent business window.
  const next = candidates.filter(candidate => candidate.local >= target).sort((a, b) => a.instant - b.instant)[0];
  if (!next) throw Error("unresolved_report_time");
  return new Date(next.instant).toISOString();
}

const reportDayStart = day => reportTime(day);
const thursday = day => new Date(day + "T00:00:00Z").getUTCDay() === 4;
const dailyReportArchiveOnly = (date, now = new Date()) => thursday(date) || thursday(reportDay(now));

module.exports = { SEO_REPORT_LA_TIME_ZONE, SEO_REPORT_LA_SWITCH_DATE, reportDay, reportStamp, reportTime, reportDayStart, dailyReportArchiveOnly };
