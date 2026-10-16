import { prisma } from "@/lib/prisma";
import { retryDatabaseRead } from "@/lib/database-read";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { readPageAuditVerdict } from "@/lib/keyword-monitoring";
import { isAuditPageForSite, keywordWorkPlanSchema, PAGE_AUDIT_DOMAINS, PAGE_AUDIT_SOURCE_ID, type PageAuditDomain } from "@/lib/page-audit";
import { pageTaskWorkDetails, type PageTaskWorkItem } from "@/lib/keyword-page-tasks";
import type { KeywordPageTasksResponse, SitePageTask } from "@/lib/keyword-page-task-read";

/** This projection reads stored work; it never creates tasks or changes goals. */
export async function loadKeywordPageTasks(): Promise<KeywordPageTasksResponse> {
  return retryDatabaseRead(async () => {
    const activeSites = await prisma.seoSite.findMany({ where: { active: true, domain: { in: [...PAGE_AUDIT_DOMAINS] } }, select: { domain: true } });
    const sites = activeSites.map(row => row.domain as PageAuditDomain);
    if (!sites.length) return { kind: "keyword-page-tasks", tasks: [], sites: [], summary: { taskCount: 0, pendingKeywords: 0, assignedKeywords: 0 } };
    const [members, stored] = await Promise.all([
      prisma.siteKeyword.findMany({ where: { siteDomain: { in: sites }, active: true, keyword: { active: true },
        OR: [{ siteDomain: "flatkey.ai", pool: "FORMAL" }, { siteDomain: { in: sites.filter(site => site !== "flatkey.ai") }, topicId: { not: null } }] },
        select: { siteDomain: true, keywordId: true, keyword: { select: { text: true } } } }),
      prisma.keywordContentTask.findMany({ where: { siteDomain: { in: sites }, status: { notIn: ["RESTORED", "MERGED"] } }, orderBy: [{ siteDomain: "asc" }, { id: "asc" }] }),
    ]);
    const ids = [...new Set(members.map(row => row.keywordId))];
    const evidence = ids.length ? await prisma.keywordSourceRow.findMany({ where: { siteDomain: { in: sites }, sourceId: PAGE_AUDIT_SOURCE_ID,
      rowKey: { in: ids.map(id => `keyword:${id}`) } }, select: { siteDomain: true, rowKey: true, snapshot: true } }) : [];
    const identity = new Map(members.map(row => [`${row.siteDomain}:${row.keywordId}`, row]));
    const items = new Map<string, PageTaskWorkItem[]>();
    for (const row of evidence) {
      if (!row.rowKey.startsWith("keyword:")) continue;
      const id = row.rowKey.slice("keyword:".length), member = identity.get(`${row.siteDomain}:${id}`);
      const snapshot = row.snapshot && typeof row.snapshot === "object" && !Array.isArray(row.snapshot) ? row.snapshot as Record<string, unknown> : {};
      if (!member || (snapshot.keywordId !== undefined && snapshot.keywordId !== id)
        || (typeof snapshot.keyword === "string" && normalizeKeywordText(snapshot.keyword) !== normalizeKeywordText(member.keyword.text))) continue;
      const parsed = keywordWorkPlanSchema.safeParse(snapshot.workPlan);
      if (!parsed.success || parsed.data.action === "LINK") continue;
      const expected = { BUILD: "NO_MATCH", EXPAND: "CONTENT_GAP" } as const;
      const urls = [...parsed.data.pageUrls, parsed.data.previousPageUrl, parsed.data.plannedPageUrl].filter((url): url is string => typeof url === "string");
      if (readPageAuditVerdict(snapshot) !== expected[parsed.data.action] || urls.some(url => !isAuditPageForSite(url, member.siteDomain as PageAuditDomain))) continue;
      const siteItems = items.get(member.siteDomain) ?? [];
      siteItems.push({ ...parsed.data, keywordId: id, keyword: member.keyword.text });
      items.set(member.siteDomain, siteItems);
    }
    const tasks: SitePageTask[] = stored.filter(row => !["MERGED", "RESTORED"].includes(row.status)).map(row => ({
      id: row.id, siteDomain: row.siteDomain as PageAuditDomain, plannedUrl: row.plannedUrl, type: row.type as SitePageTask["type"],
      status: row.status, title: row.title, reason: row.reason, keywords: row.keywords, targetUrls: row.targetUrls, owner: row.owner,
      dueAt: row.dueAt?.toISOString() ?? null, ...pageTaskWorkDetails(row, items.get(row.siteDomain) ?? []),
    }));
    const siteSummary = sites.map(siteDomain => {
      const pending = new Set((items.get(siteDomain) ?? []).map(row => normalizeKeywordText(row.keyword)));
      const assigned = new Set(tasks.filter(task => task.siteDomain === siteDomain).flatMap(task => task.keywords.map(normalizeKeywordText)));
      return { siteDomain, taskCount: tasks.filter(task => task.siteDomain === siteDomain).length,
        pendingKeywords: pending.size, assignedKeywords: [...pending].filter(word => assigned.has(word)).length };
    });
    return { kind: "keyword-page-tasks", tasks, sites: siteSummary, summary: {
      taskCount: tasks.length, pendingKeywords: siteSummary.reduce((sum, site) => sum + site.pendingKeywords, 0),
      assignedKeywords: siteSummary.reduce((sum, site) => sum + site.assignedKeywords, 0),
    } };
  });
}
