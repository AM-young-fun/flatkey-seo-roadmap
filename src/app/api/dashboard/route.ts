import { NextResponse } from "next/server";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { loadDashboard } from "@/lib/services/dashboard-data";
import type { DashboardResponse } from "@/lib/types";
import { REGION_CODES } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const cache = new Map<string, { value: DashboardResponse; expiresAt: number }>();
const pending = new Map<string, Promise<DashboardResponse>>();

export async function GET(request?: Request) {
  const started = performance.now();
  const params = request ? new URL(request.url).searchParams : new URLSearchParams();
  const site = params.get("site") ?? "all";
  const source = params.get("source") ?? "combined";
  if (!["all", "flatkey.ai", "rackrate.org", "modelfit.cc"].includes(site) || !["gsc", "ahrefs", "combined"].includes(source))
    return NextResponse.json({ message: "参数无效" }, { status: 400 });
  if (!REGION_CODES.includes((params.get("region") ?? "US") as typeof REGION_CODES[number]))
    return NextResponse.json({ message: "地区无效" }, { status: 400 });
  // All countries share one payload, cache and in-flight read.
  const key = `${site}:${source}`;
  try {
    const cached = cache.get(key);
    const hit = Boolean(cached && cached.expiresAt > Date.now());
    if (!hit && !pending.has(key)) pending.set(key, retryDatabaseRead(() => loadDashboard(site, source)).then(value => {
      cache.set(key, { value, expiresAt: Date.now() + 30000 });
      return value;
    }).finally(() => pending.delete(key)));
    const value = hit ? cached!.value : await pending.get(key);
    return NextResponse.json(value, { headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": `dashboard;dur=${(performance.now() - started).toFixed(1)};desc="${hit ? "cache" : "database"}"`,
    } });
  } catch (error) {
    const code = databaseErrorCode(error);
    console.error("Dashboard read failed", { code });
    return NextResponse.json({ message: "数据暂时无法读取", code }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
  }
}
