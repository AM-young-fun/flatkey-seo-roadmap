import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildOptimizedPages } from "@/lib/optimized-page-monitor";
import { prisma } from "@/lib/prisma";
import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { safeAnalyticsUrl } from "@/lib/seo-analytics";
import type { OptimizedEffectPage, OptimizedEffectVersion } from "@/lib/seo-page-effects";
import { loadWorkflowSnapshot } from "@/lib/services/seo-workflow";

export const dynamic = "force-dynamic";

async function completedSheetPages(local: boolean) {
  const rows: { rowKey: string; snapshot: unknown }[] = local
    ? JSON.parse(await readFile(join(process.cwd(), ".local/optimized-pages-preview.json"), "utf8")).rows
    : await prisma.keywordSourceRow.findMany({
      where: { siteDomain: "flatkey.ai", sourceId: "optimization" },
      select: { rowKey: true, snapshot: true },
    });
  return buildOptimizedPages(rows, []);
}

export async function GET(request: Request) {
  if (!await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  const local = analyticsLocalPreview(request);
  const [sheet, workflow] = await Promise.allSettled([completedSheetPages(local), loadWorkflowSnapshot({ allHistory: true }, local)]);
  if (sheet.status === "rejected" && workflow.status === "rejected") {
    return Response.json({ message: "暂时无法读取优化记录" }, { status: 503, headers });
  }

  const pages = new Map<string, OptimizedEffectPage>();
  function add(site: string, url: string, title: string, version: OptimizedEffectVersion) {
    if (!safeAnalyticsUrl(url)) return;
    const canonical = new URL(url);
    canonical.pathname = canonical.pathname.replace(/\/+$/, "") || "/";
    const key = canonical.href;
    const page = pages.get(key) ?? { site, url, title, versions: [] };
    page.versions.push(version);
    pages.set(key, page);
  }

  if (workflow.status === "fulfilled") {
    const now = Date.now();
    for (const row of workflow.value.publications) {
      if (row.kind !== "optimization" || row.status !== "verified" || !row.verifiedAt || !row.verificationRecordedAt
        || [row.publishedAt, row.verifiedAt, row.verificationRecordedAt].some(date => !Number.isFinite(Date.parse(date)) || Date.parse(date) > now)) continue;
      add(row.siteDomain, row.pageUrl, row.title, { id: row.id, date: row.publishedAt });
    }
  }
  if (sheet.status === "fulfilled") {
    for (const row of sheet.value) {
      add("flatkey.ai", row.url, row.title, { id: row.id, date: row.optimizedAt });
    }
  }
  for (const page of pages.values()) {
    page.versions.sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0));
  }
  return Response.json({ pages: [...pages.values()].sort((a, b) => (b.versions[0].date ?? "").localeCompare(a.versions[0].date ?? "") || a.url.localeCompare(b.url)),
    partial: sheet.status === "rejected" || workflow.status === "rejected" }, { headers });
}
