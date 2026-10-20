import { prisma } from "@/lib/prisma";
import { keywordPageTag } from "@/lib/keyword-status-tags";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { readPageAuditVerdict } from "@/lib/keyword-monitoring";
import { isAuditPageForSite, keywordWorkPlanSchema, normalizeAuditPageUrl, PAGE_AUDIT_DOMAINS, PAGE_AUDIT_SOURCE_ID, type PageAuditDomain } from "@/lib/page-audit";
import { pageTaskDestination } from "@/lib/keyword-page-tasks";
import { CONTENT_TARGET_RANK, type ContentOpportunity, type ExportRegion } from "@/lib/keyword-export";
import { REGION_CODES } from "@/lib/seo";
import { buildSerpKeywordResults } from "@/lib/serp-results";
import { loadSerpTasks } from "@/lib/services/serp-results";
import { validSitePage } from "@/lib/keyword-volume-review";

/** Saved SERP evidence determines success; a completed page alone does not. */
export async function loadContentOpportunities(siteDomain: PageAuditDomain | null, region: ExportRegion = "all") {
  const sites = await prisma.seoSite.findMany({ where: { active: true, domain: siteDomain ?? { in: [...PAGE_AUDIT_DOMAINS] } }, select: { domain: true } });
  const domains = sites.map(site => site.domain);
  if (!domains.length) return [];
  const [members, tasks] = await Promise.all([
    // Active research rows remain available in inventory, but are not content targets.
    // Other sites use topic assignments until they have a curated formal pool.
    prisma.siteKeyword.findMany({ where: { siteDomain: { in: domains }, active: true, keyword: { active: true },
      OR: [{ siteDomain: "flatkey.ai", pool: "FORMAL" }, { siteDomain: { in: domains.filter(domain => domain !== "flatkey.ai") }, topicId: { not: null } }] },
      select: { siteDomain: true, keywordId: true, pool: true, mappingStatus: true, targetUrls: true, candidateUrls: true,
        keyword: { select: { text: true, defaultVolume: true } } } }),
    prisma.keywordContentTask.findMany({ where: { siteDomain: { in: domains }, status: { notIn: ["MERGED", "RESTORED"] } },
      select: { id: true, siteDomain: true, keywords: true, plannedUrl: true, type: true, status: true, targetUrls: true } }),
  ]);
  const ids = [...new Set(members.map(member => member.keywordId))];
  const [audits, serpTasks] = ids.length ? await Promise.all([
    prisma.keywordSourceRow.findMany({ where: { siteDomain: { in: domains }, sourceId: PAGE_AUDIT_SOURCE_ID,
      rowKey: { in: ids.map(id => `keyword:${id}`) } }, select: { siteDomain: true, rowKey: true, snapshot: true } }),
    loadSerpTasks(region),
  ]) : [[], []];
  const regions = region === "all" ? REGION_CODES : [region];
  const targets = members.map(member => ({ keywordId: member.keywordId, keyword: member.keyword.text, siteDomain: member.siteDomain, targetUrls: member.targetUrls }));
  const rankings = regions.map(code => ({ region: code, results: new Map(buildSerpKeywordResults(targets, serpTasks.filter(task => task.region === code))
    .map(result => [`${result.siteDomain}:${result.keywordId}`, result])) }));
  const snapshots = new Map(audits.map(row => [`${row.siteDomain}:${row.rowKey}`, row.snapshot]));
  const urlKey = (value: string) => { try { return normalizeAuditPageUrl(value); } catch { return value; } };
  const rows: ContentOpportunity[] = [];
  for (const member of members) {
    const raw = snapshots.get(`${member.siteDomain}:keyword:${member.keywordId}`);
    let snapshot = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (snapshot && ((snapshot.keywordId !== undefined && snapshot.keywordId !== member.keywordId)
      || (typeof snapshot.keyword === "string" && normalizeKeywordText(snapshot.keyword) !== normalizeKeywordText(member.keyword.text)))) snapshot = null;
    const evidence = rankings.map(market => {
      const result = market.results.get(`${member.siteDomain}:${member.keywordId}`)!;
      return { region: market.region, status: result.status, rank: result.rank, url: result.url, checkedAt: result.checkedAt,
        coveredThroughRank: result.coveredThroughRank, periodKey: result.periodKey };
    });
    const validRanks = evidence.filter(row => row.status === "RANKED" && row.rank !== null);
    const currentRank = validRanks.length ? Math.min(...validRanks.map(row => row.rank!)) : null;
    if (currentRank !== null && currentRank <= CONTENT_TARGET_RANK) continue;
    // Only a positive rank excludes a word. Unknown/failed captures stay in
    // the export, with their actual evidence state rather than a false absence claim.
    const confirmedOutside = evidence.every(row => row.status === "OUTSIDE_TOP100");
    const verdict = snapshot ? readPageAuditVerdict(snapshot) : null;
    const pageStatus = keywordPageTag({ ...member, latestPageAuditVerdict: verdict }).key;
    const parsed = keywordWorkPlanSchema.safeParse(snapshot?.workPlan);
    const expectedAction = pageStatus === "BUILD" ? "BUILD" : pageStatus === "EXPAND" ? "EXPAND" : pageStatus === "MATCHED" ? "LINK" : null;
    const plan = parsed.success && parsed.data.action === expectedAction && [...parsed.data.pageUrls, parsed.data.plannedPageUrl, parsed.data.previousPageUrl]
      .every(url => !url || isAuditPageForSite(url, member.siteDomain as PageAuditDomain)) ? parsed.data : null;
    const destination = plan ? pageTaskDestination({ ...plan, keyword: member.keyword.text, keywordId: member.keywordId }) : null;
    const word = normalizeKeywordText(member.keyword.text);
    const pageUrls = [...new Set([...(pageStatus === "BUILD" ? [] : member.targetUrls), ...(plan?.pageUrls ?? []),
      ...evidence.flatMap(row => row.status === "RANKED" && row.url ? [row.url] : [])].filter(url => validSitePage(url, member.siteDomain)))].sort();
    const hasPage = pageUrls.length > 0;
    const associatedUrls = [destination, ...pageUrls].filter((url): url is string => Boolean(url)).map(urlKey);
    const related = tasks.filter(task => task.siteDomain === member.siteDomain && !["MERGED", "RESTORED"].includes(task.status)
      && (task.keywords.some(value => normalizeKeywordText(value) === word)
        || [task.plannedUrl, ...task.targetUrls].some(url => associatedUrls.includes(urlKey(url)))));
    const taskStatuses = [...new Set(related.map(task => task.status))].sort();
    const recommendedAction = pageStatus === "MISMATCH" || pageStatus === "REVIEW" ? "REVIEW_PAGE"
      : hasPage ? "OPTIMIZE" : "BUILD";
    rows.push({ keywordId: member.keywordId, keyword: member.keyword.text, siteDomain: member.siteDomain, pool: member.pool,
      searchVolume: member.keyword.defaultVolume, hasPage, pageStatus, pageUrls, candidateUrls: member.candidateUrls,
      currentRank: null, isTop100: confirmedOutside ? false : null, opportunityStatus: confirmedOutside ? "OUTSIDE_TOP100" : "NEEDS_VERIFICATION", recommendedAction, rankingEvidence: evidence,
      taskStatus: taskStatuses.length === 0 ? "UNASSIGNED" : taskStatuses.length === 1 ? taskStatuses[0] : "MIXED", taskStatuses,
      taskIds: related.map(task => task.id).sort(), plannedUrls: [...new Set([...(plan?.action === "BUILD" && destination ? [destination] : []), ...related.filter(task => task.type === "NEW").map(task => task.plannedUrl)])].sort(),
      proposedTitle: plan?.proposedTitle ?? null, requirements: plan?.requirements ?? [], acceptance: plan?.acceptance ?? [] });
  }
  return rows.sort((a, b) => a.siteDomain.localeCompare(b.siteDomain) || b.searchVolume - a.searchVolume || a.keyword.localeCompare(b.keyword) || a.keywordId.localeCompare(b.keywordId));
}
