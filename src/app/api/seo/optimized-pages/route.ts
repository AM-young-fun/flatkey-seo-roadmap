import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildOptimizedPages } from "@/lib/optimized-page-monitor";
import { prisma } from "@/lib/prisma";
import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { safeAnalyticsUrl } from "@/lib/seo-analytics";
import type { OptimizedEffectPage, OptimizedEffectVersion } from "@/lib/seo-page-effects";
import { optimizedPageDetail, optimizedPageKey, optimizedPageList, type OptimizedPagesResponse } from "@/lib/optimized-page-list";
import { loadWorkflowSnapshot } from "@/lib/services/seo-workflow";
import { CLUSTER_SITES } from "@/lib/seo-cluster-sites";
import { validRange } from "@/lib/seo-date-range";

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
  const params = new URL(request.url).searchParams;
  const publication = params.get("publication"), url = params.get("pageUrl");
  const pageText = params.get("page") ?? "1", page = Number(pageText), site = params.get("site") ?? "all", search = params.get("q") ?? "";
  const start = params.get("start"), end = params.get("end");
  const range = start !== null && end !== null ? { start, end } : null;
  if (!/^\d+$/.test(pageText) || !Number.isSafeInteger(page) || page < 1 || search.length > 200
    || !["all", "flatkey.ai", ...CLUSTER_SITES.map(row => row.domain)].includes(site)
    || (start !== null || end !== null) && (!range || !validRange(range))
    || publication !== null && (!publication || publication.length > 512)
    || url !== null && !safeAnalyticsUrl(url)) {
    return Response.json({ message: "优化列表查询参数无效" }, { status: 400, headers });
  }
  const local = analyticsLocalPreview(request);
  const [sheet, workflow] = await Promise.allSettled([completedSheetPages(local), loadWorkflowSnapshot({ allHistory: true }, local)]);
  if (sheet.status === "rejected" && workflow.status === "rejected") {
    return Response.json({ message: "暂时无法读取优化记录" }, { status: 503, headers });
  }

  const pages = new Map<string, OptimizedEffectPage>();
  function add(site: string, url: string, title: string, version: OptimizedEffectVersion) {
    if (!safeAnalyticsUrl(url)) return;
    const key = optimizedPageKey(url);
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
  const partial = sheet.status === "rejected" || workflow.status === "rejected";
  const result: OptimizedPagesResponse = publication || url
    ? { view: "detail", item: optimizedPageDetail(pages, publication, url), partial }
    : { view: "list", ...optimizedPageList(pages.values(), { page, site, search, range }), partial };
  return Response.json(result, { headers });
}
