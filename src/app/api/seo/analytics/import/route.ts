import { authenticateImportToken } from "@/lib/services/import-tokens";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { analyticsObservationSchema, analyticsStorageKind, type AnalyticsObservation } from "@/lib/seo-analytics";
import { propertyToday } from "@/lib/seo-date-range";
import { clusterDomainForProperty, siteReportToday } from "@/lib/seo-cluster-sites";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  if (!await authenticateImportToken(request)) {
    return Response.json({ message: "需要采集凭据" }, { status: 401, headers });
  }
  if (request.headers.get("origin")) return Response.json({ message: "仅接受服务器采集请求" }, { status: 403, headers });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ message: "报表为空" }, { status: 400, headers });
  let length = 0;
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4_000_000) {
        await reader.cancel();
        return Response.json({ message: "单日报表超过大小限制" }, { status: 413, headers });
      }
      chunks.push(Buffer.from(value));
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const batch = Array.isArray(input);
    const inputs: unknown[] = batch ? input : [input];
    if (inputs.length < 1 || inputs.length > 100) throw new Error("日期无效");
    const latest = new Map<string, { kind: string; row: AnalyticsObservation }>();
    for (const entry of inputs) {
      const row = analyticsObservationSchema.parse(entry);
      const site = clusterDomainForProperty(row.property);
      const today = row.kind === "ga4-site" || row.kind === "ga4-pages" ? siteReportToday(site) : propertyToday();
      if (row.date >= today || Date.parse(row.observedAt) > Date.now() + 300000) throw new Error("日期无效");
      const kind = analyticsStorageKind(row.kind, row.country, site);
      const key = `${kind}:${row.date}`;
      const saved = latest.get(key)?.row;
      if (!saved || row.complete && !saved.complete || row.complete === saved.complete && Date.parse(row.observedAt) > Date.parse(saved.observedAt)) {
        latest.set(key, { kind, row });
      }
    }
    const records = [...latest.values()].map(({ kind, row }) => ({
      kind, date: row.date, observedAt: new Date(row.observedAt), complete: row.complete, payload: row,
    }));
    const stored = await prisma.$executeRaw`
      INSERT INTO "SeoAnalyticsDay" ("kind", "date", "observedAt", "complete", "payload")
      SELECT item."kind", item."date", item."observedAt" AT TIME ZONE 'UTC', item."complete", item."payload"
      FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb)
        AS item("kind" text, "date" text, "observedAt" timestamptz, "complete" boolean, "payload" jsonb)
      ORDER BY item."kind", item."date"
      ON CONFLICT ("kind", "date") DO UPDATE SET
        "observedAt" = EXCLUDED."observedAt", "complete" = EXCLUDED."complete", "payload" = EXCLUDED."payload"
      WHERE (EXCLUDED."complete" AND NOT "SeoAnalyticsDay"."complete")
        OR (EXCLUDED."complete" = "SeoAnalyticsDay"."complete" AND EXCLUDED."observedAt" > "SeoAnalyticsDay"."observedAt")
        OR (EXCLUDED."kind" LIKE 'ga4-pages%' AND EXCLUDED."observedAt" > "SeoAnalyticsDay"."observedAt"
          AND EXCLUDED."payload"->>'hostnameDimension' = 'hostName'
          AND "SeoAnalyticsDay"."payload"->>'hostnameDimension' IS DISTINCT FROM 'hostName')
    `;
    if (batch) return Response.json({ stored, received: records.length }, { headers });
    const row = records[0].payload;
    return Response.json({ stored: Boolean(stored), date: row.date, kind: row.kind }, { headers });
  } catch (error) {
    const bad = error instanceof SyntaxError || error instanceof Error && (error.name === "ZodError" || error.message === "日期无效");
    return Response.json({ message: bad ? "报表日期或字段无效" : "归档失败" }, { status: bad ? 400 : 503, headers });
  }
}

export async function GET(request: Request) {
  if (!await authenticateImportToken(request) || request.headers.get("origin")) {
    return Response.json({ message: "需要采集凭据" }, { status: 401, headers });
  }
  const params = new URL(request.url).searchParams;
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";
  const days = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isInteger(days) || days < 0 || days > 90) {
    return Response.json({ message: "日期范围无效" }, { status: 400, headers });
  }
  const kind = params.get("kind");
  const rows = await prisma.seoAnalyticsDay.findMany({
    where: { date: { gte: start, lte: end }, ...(kind ? { kind } : {}) },
    select: { kind: true, date: true, observedAt: true, complete: true, ...(kind && start === end ? { payload: true } : {}) },
    orderBy: [{ date: "desc" }, { kind: "asc" }],
  });
  // Small metadata projection avoids transferring full 90-day query payloads.
  const hosts = await prisma.$queryRaw<Array<{ kind: string; date: string; hostnameDimension: string | null }>>(Prisma.sql`
    SELECT kind, date, payload->>'hostnameDimension' AS "hostnameDimension"
    FROM "SeoAnalyticsDay" WHERE date >= ${start} AND date <= ${end} AND kind LIKE 'ga4-pages%'
      ${kind ? Prisma.sql`AND kind = ${kind}` : Prisma.empty}
  `);
  const byKey = new Map(hosts.map(row => [`${row.kind}:${row.date}`, row.hostnameDimension]));
  return Response.json({ rows: rows.map(row => ({ ...row, ...(byKey.has(`${row.kind}:${row.date}`) ? { hostnameDimension: byKey.get(`${row.kind}:${row.date}`) } : {}) })) }, { headers });
}
