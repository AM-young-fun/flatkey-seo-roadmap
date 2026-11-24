import { z } from "zod";
import { cohortDay, cohortMidnight } from "./seo-api-cohorts";
import { shiftDay } from "./seo-date-range";

export type ConversionStatus = "ready" | "partial" | "unavailable";
export type ConversionMetric = { value: number | null; unit: "users" | "ratio" | "inquiries" | "quotes" | "deals"; status: ConversionStatus; reason: string | null; sourceRefs: string[] };
export type ConversionScope = { site: string; start: string; end: string; timezone: "America/Los_Angeles"; country: string };
export type ConversionCohort = { id: string; registrationStart: string; registrationEnd: string; registeredUsers: number | null; matureRegisteredUsers: number | null;
  confirmedFirstPayers: number | null; rate: number | null; maturity: "mature" | "immature" | "mixed" | "unavailable"; status: ConversionStatus; reasons: string[] };
export type ConversionProjection = { version: 1; generatedAt: string; scope: ConversionScope;
  api: { registration: { eligibleVisitors: ConversionMetric; firstRegistrations: ConversionMetric; eligibleFirstRegistrations: ConversionMetric; rate: ConversionMetric };
    firstPayment30d: { registeredUsers: ConversionMetric; confirmedFirstPayers: ConversionMetric; rate: ConversionMetric; cohorts: ConversionCohort[] } };
  gpu: { inquiries: ConversionMetric; quotes: ConversionMetric; deals: ConversionMetric };
  readiness: { status: ConversionStatus; reasons: string[] }; sourceEvidence: { reference: string; observedAt: string }[] };

const stamp = z.iso.datetime({ offset: true }), count = z.number().int().nonnegative(), key = z.string().min(1).max(300);
/** Saved, explicitly qualified source evidence; this module never creates a
 * tracking identity or promotes legacy GA event counts to user-cohort facts. */
export const conversionEvidenceSchema = z.object({
  version: z.literal(1), source: z.literal("existing-authorized-readonly"), site: z.string().min(1).max(100),
  start: z.iso.date(), end: z.iso.date(), country: z.string().min(2).max(10), timezone: z.literal("America/Los_Angeles"), observedAt: stamp,
  populationBusiness: z.literal("api"), attribution: z.literal("first-user-organic-search"), registeredUsers: count,
  coverage: z.object({ registrationsComplete: z.boolean(), firstRegistrationHistoryVerified: z.boolean(), acquisitionVerified: z.boolean(),
    visitorPopulationComplete: z.boolean(), visitorEligibilityVerified: z.boolean(), paymentHistoryComplete: z.boolean(),
    paymentCompleteThrough: stamp.nullable(), gpuStagesVerified: z.boolean(), gpuComplete: z.boolean() }).strict(),
  registrations: z.array(z.object({ registrationId: key, userKey: key.nullable(), visitorKey: key.nullable(), registeredAt: stamp }).strict()).max(100000),
  visitors: z.array(z.object({ visitorKey: key, enteredAt: stamp, eligibleAtEntry: z.boolean() }).strict()).max(100000),
  payments: z.array(z.object({ transactionId: key, userKey: key.nullable(), paidAt: stamp, amount: z.number().nonnegative(),
    successful: z.boolean(), isTest: z.boolean(), creditGrant: z.boolean() }).strict()).max(100000),
  gpuEvents: z.array(z.object({ id: key, stage: z.enum(["inquiries", "quotes", "deals"]), occurredAt: stamp, valid: z.boolean(), isTest: z.boolean() }).strict()).max(100000),
}).strict().refine(row => row.start <= row.end, "invalid_source_window");
export type ConversionEvidence = z.infer<typeof conversionEvidenceSchema>;
const THIRTY_DAYS = 720 * 3600000;
const unique = (values: string[]) => [...new Set(values)];
const numberAt = (value: string) => Date.parse(value);
const metric = (value: number | null, unit: ConversionMetric["unit"], status: ConversionStatus, reason: string | null, refs: string[]): ConversionMetric => ({ value, unit, status, reason, sourceRefs: refs });

export function unavailableConversionProjection(scope: ConversionScope, now = new Date(), reason = "尚无可核验的首次注册身份、注册资格及完整首次支付来源；未用旧GA4漏斗或事件数代替") : ConversionProjection {
  const missing = (unit: ConversionMetric["unit"]) => metric(null, unit, "unavailable", reason, []);
  return { version: 1, generatedAt: now.toISOString(), scope, api: { registration: { eligibleVisitors: missing("users"), firstRegistrations: missing("users"), eligibleFirstRegistrations: missing("users"), rate: missing("ratio") },
    firstPayment30d: { registeredUsers: missing("users"), confirmedFirstPayers: missing("users"), rate: missing("ratio"), cohorts: [] } },
    gpu: { inquiries: missing("inquiries"), quotes: missing("quotes"), deals: missing("deals") }, readiness: { status: "unavailable", reasons: [reason] }, sourceEvidence: [] };
}

export function buildConversionProjection(scope: ConversionScope, inputs: { reference: string; payload: unknown }[], now = new Date()): ConversionProjection {
  const valid = inputs.flatMap(input => { const parsed = conversionEvidenceSchema.safeParse(input.payload); return parsed.success ? [{ reference: input.reference, row: parsed.data }] : []; })
    .filter(({ row }) => row.site === scope.site && row.start === scope.start && row.end === scope.end && row.country === scope.country
      && numberAt(row.observedAt) <= now.getTime()).sort((a, b) => numberAt(b.row.observedAt) - numberAt(a.row.observedAt));
  if (!valid.length) return unavailableConversionProjection(scope, now);
  const { row, reference } = valid[0], refs = [reference], result = unavailableConversionProjection(scope, now), problems: string[] = [];
  const asOf = Math.min(now.getTime(), numberAt(row.observedAt));
  if (asOf < cohortMidnight(shiftDay(scope.end, 1))) return unavailableConversionProjection(scope, now, "同一来源统计窗口尚未完整结束，不计算转化率");
  const inWindow = (value: string) => { const day = cohortDay(new Date(value)); return day >= scope.start && day <= scope.end; };
  const registrationsById = new Map<string, ConversionEvidence["registrations"][number]>();
  for (const value of row.registrations) {
    const old = registrationsById.get(value.registrationId);
    if (old && JSON.stringify(old) !== JSON.stringify(value)) problems.push("同一注册记录身份或时间冲突");
    else registrationsById.set(value.registrationId, value);
  }
  const firstByUser = new Map<string, ConversionEvidence["registrations"][number]>();
  for (const value of [...registrationsById.values()].sort((a, b) => numberAt(a.registeredAt) - numberAt(b.registeredAt))) {
    const identity = value.userKey ? `user:${value.userKey}` : `registration:${value.registrationId}`;
    if (!firstByUser.has(identity)) firstByUser.set(identity, value);
  }
  const registrations = [...firstByUser.values()].filter(value => inWindow(value.registeredAt) && numberAt(value.registeredAt) <= asOf);
  const N = row.registeredUsers;
  if (!row.coverage.firstRegistrationHistoryVerified) problems.push("尚未核实全历史首次有效注册，一人只能进入一个注册cohort");
  if (!row.coverage.acquisitionVerified) problems.push("首次自然获客来源尚未核实");
  if (!row.coverage.registrationsComplete || registrations.length !== N) problems.push("注册成员覆盖未齐，保留原注册分母");
  if (registrations.some(value => !value.userKey)) problems.push("部分原注册用户缺稳定支付关联身份，未从分母删除");
  const identityReady = problems.length === 0;
  result.api.registration.firstRegistrations = metric(N, "users", identityReady ? "ready" : "partial", identityReady ? null : unique(problems).join("；"), refs);
  result.api.firstPayment30d.registeredUsers = { ...result.api.registration.firstRegistrations };

  const visitors = new Map<string, ConversionEvidence["visitors"][number]>();
  for (const visitor of [...row.visitors].sort((a, b) => numberAt(a.enteredAt) - numberAt(b.enteredAt))) if (inWindow(visitor.enteredAt) && numberAt(visitor.enteredAt) <= asOf && !visitors.has(visitor.visitorKey)) visitors.set(visitor.visitorKey, visitor);
  const eligible = [...visitors.values()].filter(value => value.eligibleAtEntry), visitorReady = row.coverage.visitorPopulationComplete && row.coverage.visitorEligibilityVerified;
  const eligibleKeys = new Set(eligible.map(value => value.visitorKey));
  const converted = new Set(registrations.filter(value => value.visitorKey && eligibleKeys.has(value.visitorKey)
    && numberAt(value.registeredAt) >= numberAt(visitors.get(value.visitorKey)!.enteredAt)).map(value => value.visitorKey!));
  result.api.registration.eligibleVisitors = metric(visitorReady ? eligible.length : null, "users", visitorReady ? "ready" : "unavailable", visitorReady ? null : "缺同窗口、同来源且进入时尚未注册的去重访客分母", refs);
  const registrationVisitors = registrations.flatMap(value => value.visitorKey ? [value.visitorKey] : []);
  const registrationRateReady = identityReady && visitorReady && registrationVisitors.length === N && new Set(registrationVisitors).size === N;
  result.api.registration.eligibleFirstRegistrations = metric(registrationRateReady ? converted.size : null, "users", registrationRateReady ? "ready" : "unavailable",
    registrationRateReady ? null : "本窗口合格访客与首次注册的身份未完全对齐", refs);
  result.api.registration.rate = metric(registrationRateReady && eligible.length ? converted.size / eligible.length : null, "ratio", registrationRateReady ? "ready" : "unavailable",
    registrationRateReady ? eligible.length ? null : "真实零分母，不计算注册率" : "首次注册用户与可注册访客身份/资格未完全对齐，不用会话数或全部用户混除", refs);

  const transactions = new Map<string, ConversionEvidence["payments"][number]>(), paymentProblems: string[] = [];
  for (const payment of row.payments) {
    const old = transactions.get(payment.transactionId);
    if (old && JSON.stringify(old) !== JSON.stringify(payment)) paymentProblems.push("同一交易回执冲突，不能认定首次收款");
    else transactions.set(payment.transactionId, payment);
  }
  if ([...transactions.values()].some(value => value.successful && !value.isTest && !value.creditGrant && value.amount > 0 && !value.userKey && numberAt(value.paidAt) <= asOf)) paymentProblems.push("存在无法关联原注册身份的成功收款，不把关联缺失当未付费");
  const firstPayment = new Map<string, ConversionEvidence["payments"][number]>();
  for (const payment of [...transactions.values()].filter(value => value.successful && !value.isTest && !value.creditGrant && value.amount > 0 && value.userKey && numberAt(value.paidAt) <= asOf)
    .sort((a, b) => numberAt(a.paidAt) - numberAt(b.paidAt))) if (!firstPayment.has(payment.userKey!)) firstPayment.set(payment.userKey!, payment);
  if (!row.coverage.paymentHistoryComplete) paymentProblems.push("首次成功支付全历史尚未核实，不能把续费或窗口内第一笔当首次付款");
  const coverageThrough = row.coverage.paymentCompleteThrough ? Math.min(asOf, numberAt(row.coverage.paymentCompleteThrough)) : -Infinity;
  const cohort = (members: typeof registrations, count: number, start: string, end: string): ConversionCohort => {
    const maturityTimes = members.map(value => numberAt(value.registeredAt) + THIRTY_DAYS), fullyMatureByEnd = asOf >= cohortMidnight(shiftDay(end, 1)) + THIRTY_DAYS;
    const matureCount = members.length === count ? maturityTimes.filter(value => value <= asOf).length : fullyMatureByEnd ? count : null;
    const maturity = matureCount === null ? "unavailable" : matureCount === count ? "mature" : matureCount === 0 ? "immature" : "mixed";
    const issues = [...problems, ...paymentProblems];
    const requiredThrough = maturityTimes.length ? Math.min(asOf, Math.max(...maturityTimes)) : asOf;
    if (coverageThrough < requiredThrough) issues.push("支付账本未覆盖同批用户的完整观察截止");
    let paid = 0, chronologyConflict = false;
    for (const member of members) {
      const payment = member.userKey ? firstPayment.get(member.userKey) : null;
      if (!payment) continue;
      if (numberAt(payment.paidAt) < numberAt(member.registeredAt)) { issues.push("首次付款早于所称首次注册，需核原身份/时间"); chronologyConflict = true; continue; }
      if (numberAt(payment.paidAt) < numberAt(member.registeredAt) + THIRTY_DAYS) paid++;
    }
    const paymentKnown = row.coverage.paymentHistoryComplete && coverageThrough >= Math.min(asOf, requiredThrough) && paymentProblems.length === 0 && !chronologyConflict;
    const complete = identityReady && !issues.length && members.length === count;
    if (maturity !== "mature") issues.push("注册后720小时尚未全部成熟，只展示截至观察时点的进展");
    return { id: `${scope.site}:${scope.country}:${start}:${end}`, registrationStart: start, registrationEnd: end, registeredUsers: count,
      matureRegisteredUsers: matureCount, confirmedFirstPayers: paymentKnown && (identityReady || paid > 0) ? paid : null, rate: complete && maturity === "mature" && count > 0 ? paid / count : null,
      maturity, status: complete && maturity === "mature" ? "ready" : "partial", reasons: unique(issues) };
  };
  const summary = cohort(registrations, N, scope.start, scope.end);
  const days = new Map<string, typeof registrations>();
  for (const registration of registrations) { const day = cohortDay(new Date(registration.registeredAt)); days.set(day, [...(days.get(day) ?? []), registration]); }
  result.api.firstPayment30d.cohorts = registrations.length === N ? [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, members]) => cohort(members, members.length, day, day)) : [summary];
  result.api.firstPayment30d.confirmedFirstPayers = metric(summary.confirmedFirstPayers, "users", summary.confirmedFirstPayers === null ? "unavailable" : summary.status,
    summary.reasons.length ? summary.reasons.join("；") : null, refs);
  result.api.firstPayment30d.rate = metric(summary.rate, "ratio", summary.status, summary.reasons.length ? summary.reasons.join("；") : N === 0 ? "真实零注册分母，不计算付费率" : null, refs);
  for (const stage of ["inquiries", "quotes", "deals"] as const) {
    const ready = row.coverage.gpuStagesVerified && row.coverage.gpuComplete;
    const ids = new Set(row.gpuEvents.filter(event => event.stage === stage && event.valid && !event.isTest && inWindow(event.occurredAt) && numberAt(event.occurredAt) <= asOf).map(event => event.id));
    result.gpu[stage] = metric(ready ? ids.size : null, stage, ready ? "ready" : "unavailable", ready ? null : "缺已核验有效询盘/报价/成交业务来源，未用GA事件或注册人数替代", refs);
  }
  const metrics = [...Object.values(result.api.registration), ...Object.values(result.api.firstPayment30d).filter((value): value is ConversionMetric => !Array.isArray(value)), ...Object.values(result.gpu)];
  result.readiness = { status: metrics.every(value => value.status === "ready") ? "ready" : "partial", reasons: unique(metrics.flatMap(value => value.reason ? [value.reason] : [])) };
  result.sourceEvidence = [{ reference, observedAt: row.observedAt }];
  return result;
}

export function conversionReportLines(snapshot?: ConversionProjection) {
  if (!snapshot) return ["GPU业务承接：询盘/报价/成交尚无同窗口可靠来源。", "API注册/30天首次付费：缺注册资格、首次注册身份或完整支付来源，不计算转化率。"];
  const number = (value: ConversionMetric) => value.value === null ? "未接可靠来源" : value.unit === "ratio" ? `${(value.value * 100).toFixed(1)}%` : String(value.value);
  return [`GPU业务承接：有效询盘 ${number(snapshot.gpu.inquiries)}；报价 ${number(snapshot.gpu.quotes)}；成交 ${number(snapshot.gpu.deals)}（各按原业务ID去重）。`,
    `API自然获客：首次注册 ${number(snapshot.api.registration.firstRegistrations)}；同窗口合格访客注册 ${number(snapshot.api.registration.eligibleFirstRegistrations)}/${number(snapshot.api.registration.eligibleVisitors)}，注册率 ${number(snapshot.api.registration.rate)}；同批注册后30天首次付费率 ${number(snapshot.api.firstPayment30d.rate)}。`,
    ...(snapshot.api.firstPayment30d.rate.value === null ? ["30天批次未成熟或来源未齐时保留原注册分母，不把缺源记0；GPU采购周期另看询盘/报价/成交。"] : [])];
}

export function conversionReportMissingFactLines(snapshot: ConversionProjection, text: string) {
  return conversionReportLines(snapshot).filter(line => !text.includes(line));
}
