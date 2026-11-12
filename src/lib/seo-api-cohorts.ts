import { z } from "zod";
import { shiftDay } from "./seo-date-range";

export const COHORT_TIMEZONE = "America/Los_Angeles" as const;
export const COHORT_DELAY_SECONDS = 172800 as const;
export const cohortKinds = ["api-first-success-d7", "api-first-payment-d30"] as const;
export const cohortDefinitions = {
  "api-first-success-d7": { label: "7 天首次成功使用", event: "first_model_success", seconds: 604800 },
  "api-first-payment-d30": { label: "30 天首次付费", event: "first_payment_completed", seconds: 2592000 },
} as const;
export type CohortKind = typeof cohortKinds[number];
export type CohortQuery = { start: string; end: string; country: "all" | "US" | "JP" | "BR" | "ES"; scope: "all-channels" | "session-organic-search" };
export const cohortStatusLabels = { unconfigured: "观察起点待确认", insufficient_coverage: "注册区间未完整覆盖", immature: "观察窗口未结束", unavailable: "查询待核验", partial: "数据不完整", no_users: "暂无可观测注册用户", ready: "观察完成" } as const;

export function cohortDay(value: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: COHORT_TIMEZONE }).format(value); }
/** Resolve property-local midnight, including the 23/25-hour days around DST. */
export function cohortMidnight(day: string): number {
  z.iso.date().parse(day);
  const target = Date.parse(day + "T00:00:00Z");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: COHORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let value = target;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
    const represented = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const delta = target - represented;
    if (!delta) return value;
    value += delta;
  }
  throw Error("cohort_timezone_boundary_unresolved");
}
export function cohortCoverageStart(raw: string | undefined): string | null {
  const parsed = z.iso.datetime({ offset: true }).safeParse(raw?.trim());
  return parsed.success ? new Date(parsed.data).toISOString() : null;
}
export function cohortObservationEnd(registrationEnd: string, kind: CohortKind) {
  // Signup is strictly before the next midnight. Subtract 1 ms only when finding
  // the containing date; GA4 itself enforces the inclusive microsecond horizon.
  return cohortDay(new Date(cohortMidnight(shiftDay(registrationEnd, 1)) + cohortDefinitions[kind].seconds * 1000 - 1));
}
export const apiCohortSchema = z.object({
  version: z.literal(1), kind: z.enum(cohortKinds), status: z.enum(Object.keys(cohortStatusLabels) as [keyof typeof cohortStatusLabels, ...(keyof typeof cohortStatusLabels)[]]),
  identity: z.literal("ga4-reporting-identity"), closedFunnel: z.literal(true), population: z.literal("observable-canonical-registrations"),
  registrationStart: z.iso.date(), registrationEnd: z.iso.date(), observationEnd: z.iso.date(),
  registrationCountry: z.enum(["all", "US", "JP", "BR", "ES"]), registrationScope: z.enum(["all-channels", "session-organic-search"]),
  timezone: z.literal(COHORT_TIMEZONE), coverageStart: z.iso.datetime().nullable(), firstEligibleRegistrationDay: z.iso.date().nullable(),
  windowSeconds: z.union([z.literal(604800), z.literal(2592000)]), processingDelaySeconds: z.literal(COHORT_DELAY_SECONDS),
  matureAt: z.iso.datetime(), observedAt: z.iso.datetime(),
  registeredUsers: z.number().int().nonnegative().nullable(), convertedUsers: z.number().int().nonnegative().nullable(), rate: z.number().min(0).max(1).nullable(),
  reasons: z.array(z.string().max(300)).max(12),
}).strict().superRefine((row, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (row.registrationEnd < row.registrationStart || Date.parse(row.registrationEnd) - Date.parse(row.registrationStart) > 366 * 86400000) issue("cohort 注册区间无效");
  if (row.windowSeconds !== cohortDefinitions[row.kind].seconds || row.observationEnd !== cohortObservationEnd(row.registrationEnd, row.kind)) issue("cohort 观察窗口不一致");
  if (row.matureAt !== new Date(cohortMidnight(shiftDay(row.observationEnd, 1)) + COHORT_DELAY_SECONDS * 1000).toISOString()) issue("cohort 成熟时间不一致");
  if (row.coverageStart) {
    const day = cohortDay(new Date(row.coverageStart));
    const eligible = Date.parse(row.coverageStart) === cohortMidnight(day) ? day : shiftDay(day, 1);
    if (row.firstEligibleRegistrationDay !== eligible) issue("cohort 起点不一致");
  } else if (row.status !== "unconfigured" || row.firstEligibleRegistrationDay !== null) issue("cohort 未配置不能有结果");
  if (row.status === "ready" || row.status === "no_users") {
    if (!row.coverageStart || !row.firstEligibleRegistrationDay || row.registrationStart < row.firstEligibleRegistrationDay || Date.parse(row.observedAt) < Date.parse(row.matureAt)) issue("cohort 覆盖不足或尚未成熟");
    if (row.registeredUsers === null || row.convertedUsers === null || row.convertedUsers > row.registeredUsers || row.reasons.length) issue("cohort 人数或质量无效");
    if (row.status === "ready" && (!row.registeredUsers || row.rate !== (row.convertedUsers ?? 0) / row.registeredUsers)) issue("cohort 比率必须取自同漏斗用户数");
    if (row.status === "no_users" && (row.registeredUsers !== 0 || row.convertedUsers !== 0 || row.rate !== null)) issue("cohort 零分母不能显示比率");
  } else if (row.registeredUsers !== null || row.convertedUsers !== null || row.rate !== null || !row.reasons.length) issue("未核验 cohort 不应有数值");
});
export type ApiCohort = z.infer<typeof apiCohortSchema>;

/** This gate never supplies a coverage epoch from event history or current time. */
export function planApiCohort(query: CohortQuery, kind: CohortKind, now: Date, rawCoverage?: string): ApiCohort {
  z.iso.date().parse(query.start); z.iso.date().parse(query.end);
  if (query.end < query.start || Date.parse(query.end) - Date.parse(query.start) > 366 * 86400000) throw Error("cohort_invalid_dates");
  const coverageStart = cohortCoverageStart(rawCoverage);
  const coverageDay = coverageStart ? cohortDay(new Date(coverageStart)) : null;
  const firstEligibleRegistrationDay = coverageDay && coverageStart ? Date.parse(coverageStart) === cohortMidnight(coverageDay) ? coverageDay : shiftDay(coverageDay, 1) : null;
  const observationEnd = cohortObservationEnd(query.end, kind);
  const matureAt = new Date(cohortMidnight(shiftDay(observationEnd, 1)) + COHORT_DELAY_SECONDS * 1000).toISOString();
  const base = { version: 1 as const, kind, identity: "ga4-reporting-identity" as const, closedFunnel: true as const, population: "observable-canonical-registrations" as const,
    registrationStart: query.start, registrationEnd: query.end, registrationCountry: query.country, registrationScope: query.scope, observationEnd, timezone: COHORT_TIMEZONE, coverageStart, firstEligibleRegistrationDay,
    windowSeconds: cohortDefinitions[kind].seconds, processingDelaySeconds: COHORT_DELAY_SECONDS, matureAt, observedAt: now.toISOString(), registeredUsers: null, convertedUsers: null, rate: null };
  let status: ApiCohort["status"] = "unavailable", reasons = ["awaiting_funnel_query"];
  if (!coverageStart) { status = "unconfigured"; reasons = ["coverage_start_not_verified_or_invalid"]; }
  else if (!firstEligibleRegistrationDay || query.start < firstEligibleRegistrationDay) { status = "insufficient_coverage"; reasons = ["registration_period_predates_verified_coverage"]; }
  else if (now.getTime() < Date.parse(matureAt)) { status = "immature"; reasons = ["observation_or_processing_window_not_complete"]; }
  // GA4 explorations can retain only two months. Do not assume a longer property
  // retention setting; recent seven-day mature windows remain within this bound.
  else if (query.start < shiftDay(cohortDay(now), -50)) { reasons = ["outside_50_day_retention_safety_window"]; }
  return apiCohortSchema.parse({ ...base, status, reasons });
}

/** Re-query recent mature registration weeks via the existing daily collector. */
export function matureCohortWindows(now: Date, rawCoverage?: string): { start: string; end: string }[] {
  if (!cohortCoverageStart(rawCoverage)) return [];
  const result = new Map<string, { start: string; end: string }>();
  for (const kind of cohortKinds) {
    let end = shiftDay(cohortDay(now), -Math.round(cohortDefinitions[kind].seconds / 86400) - 2);
    for (let i = 0; i < 4; i++, end = shiftDay(end, -1)) {
      const range = { start: shiftDay(end, -6), end };
      const plan = planApiCohort({ ...range, country: "all", scope: "all-channels" }, kind, now, rawCoverage);
      if (plan.status === "immature") continue;
      if (plan.reasons[0] === "awaiting_funnel_query") result.set(range.start + ":" + range.end, range);
      break;
    }
  }
  return [...result.values()];
}
