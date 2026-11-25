import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { readWorkflowBody, workflowErrorResponse } from "@/lib/seo-workflow-http";
import { shiftDay } from "@/lib/seo-date-range";
import { closedTrafficSummaryDay, mergeTrafficSummaryDay, trafficSummaryDaySchema, trafficSummaryEvidence, TRAFFIC_SUMMARY_KIND } from "@/lib/seo-traffic-summary";
import { z } from "zod";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

export async function GET(request: Request) {
  try {
    if (!await authenticateImportToken(request) && !await authorizeAnalyticsRead(request)) return json({ message: "请先登录" }, 401);
    const input = new URL(request.url).searchParams.get("date");
    const latestClosedDay = closedTrafficSummaryDay();
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
    const day = trafficSummaryDaySchema.parse(await readWorkflowBody(request, 32_768));
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
