import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { classifySerpMonitoringCohort, eligibleSerpTargets, serpTargetKey, SERP_TARGET_SITES, SERP_COLLECTION_SITE,
  type SerpTarget, type SerpTargetCandidate, type SerpMonitoringEvidence } from "@/lib/serp-targets";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { readPageAuditVerdict } from "@/lib/keyword-monitoring";
import { PAGE_AUDIT_SOURCE_ID } from "@/lib/page-audit";
import { SOURCE_SYNC_SOURCES } from "@/lib/source-sync";

export async function loadSerpTargetCohort(site = "all"): Promise<{ targets: SerpTarget[]; hash: string }> {
  const domains = Prisma.join(site === "all" ? [...SERP_TARGET_SITES] : [site]);
  const rows = await prisma.$queryRaw<Array<SerpTargetCandidate & { targetUrls: string[] }>>(Prisma.sql`
    /* serp-monitor:cohort */
    SELECT sk."siteDomain", sk."keywordId", k.text, sk.active,
      k.active AS "keywordActive", s.active AS "siteActive", sk."topicId", sk.pool, sk."targetUrls"
    FROM "SiteKeyword" sk JOIN "Keyword" k ON k.id = sk."keywordId"
    JOIN "SeoSite" s ON s.domain = sk."siteDomain"
    WHERE sk."siteDomain" IN (${domains}) AND sk.active = true AND k.active = true AND s.active = true
      AND sk."topicId" IS NOT NULL AND (sk."siteDomain" <> 'flatkey.ai' OR sk.pool = 'FORMAL')
    ORDER BY sk."siteDomain", sk."keywordId"
  `);
  const targets = eligibleSerpTargets(rows).map(row => ({
    keywordId: row.keywordId, keyword: row.text, siteDomain: row.siteDomain,
    targetUrls: [...new Set(row.targetUrls ?? [])].sort(),
  })).sort((a, b) => a.siteDomain.localeCompare(b.siteDomain) || a.keywordId.localeCompare(b.keywordId));
  return { targets, hash: createHash("sha256").update(JSON.stringify(targets)).digest("hex") };
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const urls = (value: unknown): string[] => Array.isArray(value) ? value.filter((url): url is string => typeof url === "string") : [];

/** The scheduled paid task only monitors Flatkey; other sites remain in inventory. */
export function loadScheduledSerpMonitoringCohort() {
  return loadSerpMonitoringCohort(SERP_COLLECTION_SITE);
}

/** Saved evidence only: no page requests, provider calls or state mutations. */
export async function loadSerpMonitoringCohort(site = "all", existingCohort?: { targets: SerpTarget[]; hash: string }) {
  const cohort = existingCohort ?? await loadSerpTargetCohort(site);
  const evidence = new Map<string, SerpMonitoringEvidence>();
  if (cohort.targets.length) {
    const domains = [...new Set(cohort.targets.map(target => target.siteDomain))];
    const rowKeys = [...new Set(cohort.targets.map(target => `keyword:${target.keywordId}`))];
    const rows = await prisma.$queryRaw<Array<{ siteDomain: string; sourceId: string; rowKey: string; snapshot: unknown }>>(Prisma.sql`
      /* serp-monitor:page-readiness-evidence */
      SELECT source."siteDomain", source."sourceId", source."rowKey",
        CASE WHEN source."sourceId" = ${PAGE_AUDIT_SOURCE_ID} THEN jsonb_build_object(
          'keywordId', source.snapshot->'keywordId', 'verdict', source.snapshot->'verdict', 'pageUrl', source.snapshot->'pageUrl',
          'additionalPages', COALESCE((SELECT jsonb_agg(jsonb_build_object('pageUrl', page->'pageUrl'))
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(source.snapshot->'additionalPages') = 'array' THEN source.snapshot->'additionalPages' ELSE '[]'::jsonb END) page), '[]'::jsonb),
          'workPlan', CASE WHEN jsonb_typeof(source.snapshot->'workPlan') = 'object' THEN jsonb_build_object(
            'action', source.snapshot->'workPlan'->'action', 'pageUrls', source.snapshot->'workPlan'->'pageUrls') END
        ) ELSE jsonb_build_object('completion', source.snapshot->'completion', 'pageUrl', source.snapshot->'pageUrl',
          'publication', source.snapshot->'publication', 'keywords', source.snapshot->'keywords') END AS snapshot
      FROM "KeywordSourceRow" source
      WHERE source."siteDomain" IN (${Prisma.join(domains)}) AND (
        (source."sourceId" = ${PAGE_AUDIT_SOURCE_ID} AND source."rowKey" IN (${Prisma.join(rowKeys)})) OR
        source."sourceId" IN (${Prisma.join(Object.keys(SOURCE_SYNC_SOURCES))})
      )
    `);
    const targetMap = new Map(cohort.targets.map(target => [serpTargetKey(target), target]));
    const byText = new Map<string, SerpTarget[]>();
    for (const target of cohort.targets) {
      const key = `${target.siteDomain}:${normalizeKeywordText(target.keyword)}`;
      byText.set(key, [...(byText.get(key) ?? []), target]);
    }
    for (const row of rows) {
      const snapshot = record(row.snapshot);
      if (row.sourceId === PAGE_AUDIT_SOURCE_ID) {
        const keywordId = row.rowKey.startsWith("keyword:") ? row.rowKey.slice(8) : "", key = `${row.siteDomain}:${keywordId}`;
        if (!targetMap.has(key)) continue;
        const work = record(snapshot.workPlan), action = work.action;
        const invalidIdentity = snapshot.keywordId != null && snapshot.keywordId !== keywordId;
        const invalidPlan = snapshot.workPlan != null && (!["LINK", "EXPAND", "BUILD"].includes(String(action)) || !Array.isArray(work.pageUrls));
        evidence.set(key, { ...evidence.get(key), pageAudit: {
          verdict: invalidIdentity || invalidPlan ? "REVIEW" : readPageAuditVerdict(snapshot),
          pageUrls: [typeof snapshot.pageUrl === "string" ? snapshot.pageUrl : "", ...
            (Array.isArray(snapshot.additionalPages) ? snapshot.additionalPages.flatMap(page => typeof record(page).pageUrl === "string" ? [record(page).pageUrl as string] : []) : [])].filter(Boolean),
          workPlan: ["LINK", "EXPAND", "BUILD"].includes(String(action)) ? { action: action as "LINK" | "EXPAND" | "BUILD", pageUrls: urls(work.pageUrls) } : null,
        } });
        continue;
      }
      if (!Object.hasOwn(SOURCE_SYNC_SOURCES, row.sourceId)) continue;
      const publication = record(snapshot.publication);
      if (snapshot.completion !== "COMPLETED" || publication.pageVerified !== true ||
        typeof publication.verificationReason !== "string" || publication.verificationReason.trim().length < 12 || typeof snapshot.pageUrl !== "string") continue;
      for (const raw of Array.isArray(snapshot.keywords) ? snapshot.keywords : []) {
        const word = record(raw);
        const relevant = word.relevance === "RELEVANT" || word.newModel === true && word.relevance !== "UNRELATED" && typeof word.reason === "string" && word.reason.trim().length >= 20;
        if (typeof word.keyword !== "string" || word.pageIntentMatched !== true || !relevant) continue;
        for (const target of byText.get(`${row.siteDomain}:${normalizeKeywordText(word.keyword)}`) ?? []) {
          const key = serpTargetKey(target), previous = evidence.get(key);
          evidence.set(key, { ...previous, verifiedSourcePages: [...(previous?.verifiedSourcePages ?? []), snapshot.pageUrl] });
        }
      }
    }
  }
  const classified = classifySerpMonitoringCohort(cohort.targets, evidence);
  const targets = classified.targets.sort((a, b) => a.siteDomain.localeCompare(b.siteDomain) || a.keywordId.localeCompare(b.keywordId));
  return { ...classified, targets, hash: createHash("sha256").update(JSON.stringify(targets)).digest("hex"),
    allTargets: cohort.targets, allTargetHash: cohort.hash };
}
