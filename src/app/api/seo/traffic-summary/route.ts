import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { readWorkflowBody, workflowErrorResponse } from "@/lib/seo-workflow-http";
import { shiftDay, validRange } from "@/lib/seo-date-range";
import { closedTrafficSummaryDay, mergeTrafficSummaryDay, mergeTrafficSummaryPeriod, trafficSummaryDaySchema, trafficSummaryEvidence, trafficSummaryPeriodEvidence, trafficSummaryPeriodKind, trafficSummaryPeriodSchema, trafficSummaryTrendDay, TRAFFIC_SUMMARY_KIND, TRAFFIC_SUMMARY_PERIOD, type TrafficSummaryPeriod } from "@/lib/seo-traffic-summary";
import { z } from "zod";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

export async function GET(request: Request) {
  try {
    if (!await authenticateImportToken(request) && !await authorizeAnalyticsRead(request)) return json({ message: "请先登录" }, 401);
    const params = new URL(request.url).searchParams;
    const input = params.get("date"), start = params.get("start"), end = params.get("end");
    const latestClosedDay = closedTrafficSummaryDay();
    if (params.get("view") === "period") {
      if ([...params.keys()].some(key => !["view", "start", "end"].includes(key) || params.getAll(key).length !== 1)
        || !start || !end || !validRange({ start, end }) || end > latestClosedDay || Date.parse(end) - Date.parse(start) > 365 * 86400000) {
        return json({ message: "请选择有效的闭合统计周期" }, 400);
      }
      const row = await prisma.seoAnalyticsDay.findUnique({ where: { kind_date: { kind: trafficSummaryPeriodKind({ start, end }), date: end } },
        select: { payload: true } });
      const result = trafficSummaryPeriodSchema.safeParse(row?.payload);
      return json({ period: result.success && result.data.start === start && result.data.end === end ? result.data : null });
    }
    if (start !== null || end !== null) {
      if (input !== null || !start || !end || !validRange({ start, end }) || end > latestClosedDay
        || Date.parse(end) - Date.parse(start) > 365 * 86400000) return json({ message: "请选择已结束的洛杉矶日期，区间最多 366 天" }, 400);
      const rows = await prisma.seoAnalyticsDay.findMany({ where: { kind: TRAFFIC_SUMMARY_KIND, date: { gte: start, lte: end } },
        select: { date: true, payload: true } });
      const days = new Map(rows.flatMap(row => {
        const result = trafficSummaryDaySchema.safeParse(row.payload);
        return result.success && result.data.date === row.date ? [[row.date, result.data] as const] : [];
      }));
      const daily = [];
      for (let date = start; date <= end; date = shiftDay(date, 1)) daily.push(trafficSummaryTrendDay(date, days.get(date) ?? null));
      return json({ start, end, daily });
    }
    if (input && (!z.iso.date().safeParse(input).success || input > latestClosedDay)) return json({ message: "请选择已结束的洛杉矶日期" }, 400);
    const date = input ?? latestClosedDay, previous = shiftDay(date, -1);
    const rows = await prisma.seoAnalyticsDay.findMany({
      where: { kind: TRAFFIC_SUMMARY_KIND, date: { in: [date, previous] } }, select: { date: true, payload: true },
    });
    const parse = (day: string) => {
      const payload = trafficSummaryDaySchema.safeParse(rows.find(row => row.date === day)?.payload);
      return payload.success && payload.data.date === day ? payload.data : null;
    };
    return json({ date, latestClosedDay, day: parse(date), previous: parse(previous) });
  } catch (error) { return workflowErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    if (request.headers.has("origin") || !await authenticateImportToken(request)) return json({ message: "需要原采集凭据" }, 403);
    const input = await readWorkflowBody(request, 32_768);
    if (input && typeof input === "object" && "kind" in input && input.kind === TRAFFIC_SUMMARY_PERIOD) {
      return await saveTrafficPeriod(trafficSummaryPeriodSchema.parse(input));
    }
    const day = trafficSummaryDaySchema.parse(input);
    const now = new Date();
    if (day.date > closedTrafficSummaryDay(now)) return json({ message: "仅可归档已结束的洛杉矶日期" }, 422);
    const evidence = trafficSummaryEvidence(day).filter(value => value !== null);
    if (!evidence.length || evidence.some(value => Date.parse(value.observedAt) > now.getTime()
      || day.date > closedTrafficSummaryDay(new Date(value.observedAt)))) return json({ message: "来源观测日期未核实" }, 422);
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${TRAFFIC_SUMMARY_KIND + ":" + day.date}))`;
      const key = { kind: TRAFFIC_SUMMARY_KIND, date: day.date }, where = { kind_date: key };
      const prior = await tx.seoAnalyticsDay.findUnique({ where, select: { payload: true } });
      const previous = prior ? trafficSummaryDaySchema.parse(prior.payload) : null;
      const merged = mergeTrafficSummaryDay(previous, day);
      const metrics = trafficSummaryEvidence(merged);
      const observedAt = new Date(metrics.flatMap(value => value ? [value.observedAt] : []).sort().at(-1)!);
      const data = { observedAt, complete: metrics.every(Boolean), payload: merged as Prisma.InputJsonValue };
      await tx.seoAnalyticsDay.upsert({ where, create: { ...key, ...data }, update: data });
      return json({ date: day.date, complete: data.complete, observedAt });
    });
  } catch (error) { return workflowErrorResponse(error); }
}


async function saveTrafficPeriod(period: TrafficSummaryPeriod) {
  const now = new Date(), evidence = trafficSummaryPeriodEvidence(period).filter(value => value !== null);
  if (!evidence.length || evidence.some(value => Date.parse(value.observedAt) > now.getTime()
    || period.end > closedTrafficSummaryDay(new Date(value.observedAt)))) return json({ message: "周期来源观测时间未核实" }, 422);
  const key = { kind: trafficSummaryPeriodKind(period), date: period.end }, where = { kind_date: key };
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key.kind + ":" + key.date}))`;
    const prior = await tx.seoAnalyticsDay.findUnique({ where, select: { payload: true } });
    const previous = prior ? trafficSummaryPeriodSchema.parse(prior.payload) : null;
    const merged = mergeTrafficSummaryPeriod(previous, period);
    const metrics = trafficSummaryPeriodEvidence(merged);
    const observedAt = new Date(metrics.flatMap(value => value ? [value.observedAt] : []).sort().at(-1)!);
    const data = { observedAt, complete: metrics.every(Boolean), payload: merged as Prisma.InputJsonValue };
    await tx.seoAnalyticsDay.upsert({ where, create: { ...key, ...data }, update: data });
    return json({ period: merged, complete: data.complete });
  });
}
