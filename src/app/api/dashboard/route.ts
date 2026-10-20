import { NextResponse } from "next/server";
import { databaseErrorCategory, databaseErrorCode, databaseReadPhase, retryDatabaseRead } from "@/lib/database-read";
import { loadDashboard } from "@/lib/services/dashboard-data";
import type { DashboardResponse } from "@/lib/types";
import { REGION_CODES } from "@/lib/seo";
import { profileRead } from "@/lib/read-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const cache = new Map<string, { value: DashboardResponse; expiresAt: number }>();
const pending = new Map<string, Promise<DashboardResponse>>();
const compactPayload = (value: DashboardResponse, compact: boolean) => !compact ? value : { ...value, keywords: value.keywords.map(keyword => {
  const { volumeReview, ...row } = keyword;
  return { ...row, volumeReviewLabel: volumeReview?.label };
}) };

export async function GET(request: Request) {
  const started = performance.now();
  const params = request ? new URL(request.url).searchParams : new URLSearchParams();
  const site = params.get("site") ?? "all";
  const source = params.get("source") ?? "dataforseo_serp";
  const period = params.get("period") ?? "week";
  const researchParam = params.get("includeResearch") ?? "0";
  if (researchParam !== "0" && researchParam !== "1") return NextResponse.json({ message: "词池范围无效" }, { status: 400 });
  const includeResearch = researchParam === "1";
  const compact = params.get("compact") === "1";
  const currentOnly = params.get("currentOnly") === "1", keywordId = params.get("keywordId") ?? undefined;
  if (keywordId !== undefined && (!keywordId.trim() || keywordId.length > 200)) return NextResponse.json({ message: "关键词标识无效" }, { status: 400 });
  if (period !== "week" && period !== "history") return NextResponse.json({ message: "统计区间无效" }, { status: 400 });
  if (!["all", "flatkey.ai", "rackrate.org", "modelfit.cc"].includes(site) || !["gsc", "ahrefs", "dataforseo_labs", "dataforseo_serp", "combined"].includes(source))
    return NextResponse.json({ message: "参数无效" }, { status: 400 });
  if (!REGION_CODES.includes((params.get("region") ?? "US") as typeof REGION_CODES[number]))
    return NextResponse.json({ message: "地区无效" }, { status: 400 });
  // All countries share one payload, cache and in-flight read.
  const key = `${site}:${source}:${period}:${includeResearch ? "library" : "formal"}:${currentOnly ? "current" : "full"}:${keywordId ?? "all"}`;
  try {
    if (params.get("profile") === "1") {
      const { value, ...timing } = await profileRead(() => retryDatabaseRead(() => loadDashboard(site, source, period, new Date(), includeResearch, { currentOnly, keywordId })));
      const payload = compactPayload(value, compact);
      return NextResponse.json({ ...timing, payloadBytes: Buffer.byteLength(JSON.stringify(payload)), keywords: value.keywords.length, topics: value.topics.length,
        fieldBytes: Object.fromEntries(["latestRanks", "rankingEvidence", "targetUrls"].map(field => [field, Buffer.byteLength(JSON.stringify(payload.keywords.map(keyword => keyword[field as keyof typeof keyword])))])) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const cached = cache.get(key);
    const hit = params.get("refresh") !== "1" && Boolean(cached && cached.expiresAt > Date.now());
    if (!hit && !pending.has(key)) pending.set(key, retryDatabaseRead(() => loadDashboard(site, source, period, new Date(), includeResearch, { currentOnly, keywordId })).then(value => {
      cache.set(key, { value, expiresAt: Date.now() + 30000 });
      if (cache.size > 40) cache.delete(cache.keys().next().value!);
      return value;
    }).finally(() => pending.delete(key)));
    const value = hit ? cached!.value : await pending.get(key);
    // The browser displays the review label only. Keep full regional review
    // details available to collectors without repeating them for every row.
    const payload = value ? compactPayload(value, compact) : value;
    return NextResponse.json(payload, { headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": `dashboard;dur=${(performance.now() - started).toFixed(1)};desc="${hit ? "cache" : "database"}"`,
    } });
  } catch (error) {
    const code = databaseErrorCode(error);
    const readPhase = databaseReadPhase(error);
    const category = databaseErrorCategory(error);
    console.error("Dashboard read failed", { code, readPhase, category });
    return NextResponse.json({ message: "数据暂时无法读取", code, readPhase, category }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
  }
}
