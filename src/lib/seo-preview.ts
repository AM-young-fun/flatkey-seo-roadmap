import "server-only";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { isLocalPreviewOrigin, isLocalPreviewRequest } from "./preview-origin";
import { multiRegionTrendResult, serpTrendRange, trendToday, type TrendPoint } from "./ranking-trends";
import type { DashboardResponse } from "./types";
import { overviewModule } from "./seo-overview-scope";

function previewRankingTrend(snapshot: Pick<DashboardResponse, "serpOverview">, range: ReturnType<typeof serpTrendRange>) {
    const overview = snapshot.serpOverview;
    if (!overview) throw new Error("排名快照未归档");
    const period = overview.currentPeriod;
    const point = (summary: (typeof overview.regions)[number]["summary"], completedAt: string | null): TrendPoint[] => {
        if (!completedAt || !summary.captured) return [];
        const date = trendToday(new Date(completedAt));
        if (date < range.start || date > range.end) return [];
        return [{
            date, periodKey: period.key, periodLabel: period.label, periodStart: period.start, periodEnd: period.end,
            captureEndAt: completedAt, counts: summary.buckets.map(bucket => bucket.count),
            sites: [overview.site], sources: [overview.source], total: summary.total,
            ranked: summary.ranked, captured: summary.captured, pending: summary.pending, outside: summary.outside,
        }];
    };
    const markets = overview.regions.map(region => ({
        region: region.region, status: "READY" as const,
        points: point(region.summary, region.latestCompletedAt),
    }));
    return multiRegionTrendResult(markets, range, new Date().toISOString(), point(overview.summary, overview.latestCompletedAt));
}

export async function previewRead(request: Request): Promise<Response | null> {
    if (process.env.NODE_ENV !== "development" || !process.env.SEO_PREVIEW_UPSTREAM_TOKEN)
        return null;
    const url = new URL(request.url);
    if (!isLocalPreviewRequest(request) || request.method !== "GET")
        return null;
    const origin = request.headers.get("origin");
    if (origin && !isLocalPreviewOrigin(request))
        return NextResponse.json({ message: "预览仅允许同源读取" }, { status: 403 });
    const headers = { "Cache-Control": "private, no-store", "X-SEO-Preview": "read-only" };
    if (["/api/traffic/daily", "/api/traffic/daily/groups"].includes(url.pathname)) {
        try {
            const upstream = await fetch("https://flatkey-seo-roadmap.vercel.app" + url.pathname + url.search, { headers: { Authorization: `Bearer ${process.env.SEO_PREVIEW_UPSTREAM_TOKEN}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000) });
            return new Response(await upstream.text(), { status: upstream.status, headers: { ...headers, "Content-Type": "application/json" } });
        }
        catch {
            return NextResponse.json({ message: "线上只读接口暂时不可用，请重试" }, { status: 503, headers });
        }
    }
    if (url.pathname === "/api/serp-monitor" && url.searchParams.get("progress") === "1")
        return NextResponse.json({ progress: null, preview: true }, { headers });
    const view = url.pathname === "/api/views" ? url.searchParams.get("view") : url.pathname === "/api/seo/worklist" ? "worklist" : null;
    if (view === "trends" && (url.searchParams.get("site") ?? "all") === "all") {
        const module = overviewModule(url.searchParams.get("module"));
        let range: ReturnType<typeof serpTrendRange>;
        try {
            range = serpTrendRange(url.searchParams.get("start") ?? undefined, url.searchParams.get("end") ?? undefined);
        } catch {
            return NextResponse.json({ message: "排名趋势日期无效" }, { status: 400, headers });
        }
        try {
            const saved = JSON.parse(await readFile(process.cwd() + "/.local/preview-trends-" + module + ".json", "utf8"));
            if (saved.schemaVersion !== 5 || saved.mode !== "serp-markets" || saved.moduleScope?.module !== module ||
                saved.moduleScope?.basis !== "current-registered-target-pages" || saved.start !== range.start || saved.end !== range.end)
                throw new Error("快照口径不一致");
            return NextResponse.json(saved, { headers: { ...headers, "X-SEO-Preview-Source": "captured-online-trends" } });
        } catch {
            if (module !== "all") return NextResponse.json({ message: "该模块的真实排名趋势快照尚未准备", code: "MODULE_TREND_SNAPSHOT_MISSING" }, { status: 503, headers });
        }
        try {
            const snapshot = JSON.parse(await readFile(process.cwd() + "/.local/preview-dashboard.json", "utf8"));
            return NextResponse.json({ ...previewRankingTrend(snapshot, range), moduleScope: { module, basis: "current-registered-target-pages" } }, { headers });
        } catch {
            return NextResponse.json({ message: "排名快照尚未准备" }, { status: 503, headers });
        }
    }
    if (view && ["dashboard", "traffic", "worklist"].includes(view)) {
        const week = view === "traffic" ? url.searchParams.get("week") : null;
        if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week))
            return NextResponse.json({ message: "历史周报日期无效" }, { status: 400, headers });
        try {
            return new Response(await readFile(process.cwd() + "/.local/preview-" + view + (week ? "-" + week : "") + ".json", "utf8"), { headers: { ...headers, "Content-Type": "application/json", "X-SEO-Preview-Source": "captured-online-snapshot" } });
        }
        catch {
            return NextResponse.json({ message: "线上快照尚未准备" }, { status: 503, headers });
        }
    }
    return null;
}
