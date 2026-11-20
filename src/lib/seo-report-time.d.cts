export const SEO_REPORT_LA_TIME_ZONE: "America/Los_Angeles";
export const SEO_REPORT_LA_SWITCH_DATE: "2026-11-19";
export function reportDay(now?: Date): string;
export function reportStamp(value: string | Date): string;
export function reportTime(day: string, hour?: number, minute?: number): string;
export function reportDayStart(day: string): string;
export function dailyReportArchiveOnly(date: string, now?: Date): boolean;
