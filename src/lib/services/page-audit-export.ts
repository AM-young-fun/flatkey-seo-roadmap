import { prisma } from "@/lib/prisma";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { PAGE_AUDIT_SOURCE_ID } from "@/lib/page-audit";
import { loadSerpMonitoringCohort, loadSerpTargetCohort } from "@/lib/services/serp-targets";

/** A read-only inventory export; it never calls a ranking provider. */
export async function exportHeldPageAuditWorklist() {
  const cohort = await loadSerpTargetCohort("all");
  const monitoring = await loadSerpMonitoringCohort("all", cohort);
  const held = monitoring.heldTargets;
  const domains = [...new Set(held.map(row => row.siteDomain))];
  const keywordIds = [...new Set(held.map(row => row.keywordId))];
  const [members, audits] = held.length ? await Promise.all([
    prisma.siteKeyword.findMany({ where: { siteDomain: { in: domains }, keywordId: { in: keywordIds } },
      select: { siteDomain: true, keywordId: true, targetUrls: true, candidateUrls: true, mappingStatus: true,
        auditReason: true, sourceUrl: true, pool: true, topicId: true, curatedAt: true } }),
    prisma.keywordSourceRow.findMany({ where: { siteDomain: { in: domains }, sourceId: PAGE_AUDIT_SOURCE_ID,
      rowKey: { in: keywordIds.map(id => `keyword:${id}`) } }, select: { siteDomain: true, rowKey: true, snapshot: true, observedAt: true } }),
  ]) : [[], []];
  const membership = new Map(members.map(row => [`${row.siteDomain}:${row.keywordId}`, row]));
  const evidence = new Map(audits.map(row => [`${row.siteDomain}:${row.rowKey.slice("keyword:".length)}`, row]));
  return { kind: "page-audit-worklist" as const, generatedAt: new Date().toISOString(), cohortHash: cohort.hash,
    summary: { allSiteTargets: cohort.targets.length, heldSiteTargets: held.length,
      heldKeywords: new Set(held.map(row => normalizeKeywordText(row.keyword))).size,
      sites: Object.fromEntries(domains.map(domain => [domain, held.filter(row => row.siteDomain === domain).length])) },
    rows: held.map(row => { const key = `${row.siteDomain}:${row.keywordId}`;
      return { ...row, membership: membership.get(key) ?? null, latestAudit: evidence.get(key)?.snapshot ?? null,
        latestAuditObservedAt: evidence.get(key)?.observedAt?.toISOString() ?? null };
    }),
  };
}
