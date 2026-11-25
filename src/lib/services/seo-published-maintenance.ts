import { Prisma } from "@prisma/client";
import { growthWebsitePageUrl } from "@/lib/growth-live-page";
import { assignedGrowthMarkets } from "@/lib/growth-workspace";
import { MARKET_ASSIGNMENT_SOURCE_ID } from "@/lib/keyword-market-policy";
import { hasMaintenanceIntentReview, hasPublishedMaintenanceSource } from "@/lib/seo-published-maintenance";
import type { WorkflowTask } from "@/lib/seo-workflow";
import { WorkflowError, type WorkflowStoredRow } from "@/lib/seo-workflow-state";

export async function assertPublishedMaintenanceTasks(db: Prisma.TransactionClient, tasks: WorkflowTask[], records: WorkflowStoredRow[], now: Date) {
  if (!tasks.length) return;
  for (const task of tasks) {
    if (!hasMaintenanceIntentReview(task)) throw new WorkflowError("published_maintenance_intent_required", `任务 ${task.id} 须记录当地搜索意图和已上线原页的对照，完成前10条自然结果及实际打开前5页后再排期。`, 422);
  }

  const identities = tasks.flatMap(task => task.keywordId ? [{ siteDomain: task.siteDomain, keywordId: task.keywordId }] : []);
  const [members, assignments] = await Promise.all([
    db.siteKeyword.findMany({ where: { OR: identities }, select: { siteDomain: true, keywordId: true, active: true, targetUrls: true, keyword: { select: { text: true, active: true } } } }),
    db.keywordSourceRow.findMany({ where: { sourceId: MARKET_ASSIGNMENT_SOURCE_ID, OR: identities.map(row => ({ siteDomain: row.siteDomain, rowKey: `keyword:${row.keywordId}` })) }, select: { siteDomain: true, rowKey: true, snapshot: true } }),
  ]);
  const urls = new Set<string>();
  for (const task of tasks) {
    const page = growthWebsitePageUrl(task.pageUrl, task.siteDomain);
    if (!page) continue;
    const member = members.find(row => row.siteDomain === task.siteDomain && row.keywordId === task.keywordId);
    for (const url of member?.targetUrls ?? []) if (growthWebsitePageUrl(url, task.siteDomain) === page) urls.add(url);
    for (const host of [task.siteDomain, `www.${task.siteDomain}`]) {
      const url = new URL(page);
      url.hostname = host;
      urls.add(url.href);
      if (url.pathname !== "/") { url.pathname += "/"; urls.add(url.href); }
    }
  }
  const inventory = urls.size ? await db.seoPageInventory.findMany({ where: { url: { in: [...urls] }, lastSeen: { lte: now } }, select: { url: true } }) : [];
  const pages = new Set(inventory.flatMap(row => growthWebsitePageUrl(row.url, new URL(row.url).hostname.replace(/^www\./u, "")) ?? []));
  for (const task of tasks) {
    const row = members.find(row => row.siteDomain === task.siteDomain && row.keywordId === task.keywordId);
    const scope = assignments.find(item => item.siteDomain === task.siteDomain && item.rowKey === `keyword:${task.keywordId}`);
    const source = row && { ...row, keyword: row.keyword.text, active: row.active && row.keyword.active, markets: assignedGrowthMarkets(scope?.snapshot) };
    if (!hasPublishedMaintenanceSource(task, source, pages, records, now)) {
      throw new WorkflowError("published_maintenance_source_required", `任务 ${task.id} 须关联同站、同原词、同市场语种的真实已上线页面，请从已上线关键词库核对来源。`, 422);
    }
  }
}
