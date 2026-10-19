import { keywordRelevance } from "./keyword-relevance";
import type { PageAuditVerdict } from "./page-audit";

export const SERP_TARGET_SITES = ["flatkey.ai", "rackrate.org", "modelfit.cc"] as const;
// Paid recurring collection is scoped independently from the saved inventory.
export const SERP_COLLECTION_SITE = "flatkey.ai";

export type SerpTargetCandidate = {
  keywordId: string;
  text: string;
  siteDomain: string;
  active: boolean;
  keywordActive: boolean;
  siteActive: boolean;
  topicId: string | null;
  pool: string;
};

export type SerpTarget = {
  keywordId: string;
  keyword: string;
  siteDomain: string;
  targetUrls: string[];
};

// This is the full business target inventory used by the overview and history.
// The paid monitoring subset is classified separately below; missing a page or
// a ranking must never remove a keyword from this inventory.
export function eligibleSerpTargets<T extends SerpTargetCandidate>(rows: T[]): T[] {
  const selected = new Map<string, T>();
  for (const row of rows) {
    if (!SERP_TARGET_SITES.includes(row.siteDomain as typeof SERP_TARGET_SITES[number]) ||
      !row.active || !row.keywordActive || !row.siteActive || !row.topicId) continue;
    if (row.siteDomain === "flatkey.ai" && row.pool !== "FORMAL") continue;
    if (keywordRelevance(row.siteDomain, row.text).status === "unrelated") continue;
    selected.set(`${row.siteDomain}:${row.keywordId}`, row);
  }
  return [...selected.values()];
}

export const serpTargetKey = (target: Pick<SerpTarget, "siteDomain" | "keywordId">) => `${target.siteDomain}:${target.keywordId}`;

export type SerpMonitoringHoldReason = "PAGE_NOT_BUILT" | "PAGE_INTENT_MISMATCH" | "PAGE_REVIEW_REQUIRED" | "NO_VERIFIED_PAGE";
export type SerpMonitoringReadiness = "VERIFIED_PAGE" | "PAGE_OPTIMIZATION" | "SOURCE_VERIFIED";
export type SerpMonitoringEvidence = {
  pageAudit?: { verdict: PageAuditVerdict; pageUrls: string[]; workPlan?: { action: "LINK" | "EXPAND" | "BUILD"; pageUrls: string[] } | null };
  verifiedSourcePages?: string[];
};
export type HeldSerpTarget = SerpTarget & { reason: SerpMonitoringHoldReason; reasonLabel: string };
export type SerpMonitoringClassification = {
  targets: SerpTarget[];
  heldTargets: HeldSerpTarget[];
  allTargetCount: number;
  heldTargetCount: number;
  readinessByTarget: Record<string, SerpMonitoringReadiness>;
  breakdown: { verifiedPages: number; existingPagesToOptimize: number; sourceVerifiedPages: number;
    pageNotBuilt: number; intentMismatch: number; pageReviewRequired: number; noVerifiedPage: number };
};

function monitoringPage(value: string, siteDomain: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(url.hostname === siteDomain || url.hostname.endsWith(`.${siteDomain}`))) return null;
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch { return null; }
}

const monitoringHoldLabels: Record<SerpMonitoringHoldReason, string> = {
  PAGE_NOT_BUILT: "待建设，页面上线并核实后加入监控",
  PAGE_INTENT_MISMATCH: "页面意图不匹配，暂不抓取",
  PAGE_REVIEW_REQUIRED: "页面尚待核实，暂不抓取",
  NO_VERIFIED_PAGE: "缺少页面核实证据，暂不抓取",
};

/** Classify the existing formal inventory; this never promotes a research term. */
export function classifySerpMonitoringCohort(allTargets: SerpTarget[], evidence: ReadonlyMap<string, SerpMonitoringEvidence>): SerpMonitoringClassification {
  const result: SerpMonitoringClassification = { targets: [], heldTargets: [], allTargetCount: allTargets.length, heldTargetCount: 0,
    readinessByTarget: {}, breakdown: { verifiedPages: 0, existingPagesToOptimize: 0, sourceVerifiedPages: 0,
      pageNotBuilt: 0, intentMismatch: 0, pageReviewRequired: 0, noVerifiedPage: 0 } };
  const holdCount = { PAGE_NOT_BUILT: "pageNotBuilt", PAGE_INTENT_MISMATCH: "intentMismatch",
    PAGE_REVIEW_REQUIRED: "pageReviewRequired", NO_VERIFIED_PAGE: "noVerifiedPage" } as const;
  for (const target of allTargets) {
    const key = serpTargetKey(target), proof = evidence.get(key), audit = proof?.pageAudit;
    const pages = (urls: string[]) => [...new Set(urls.map(url => monitoringPage(url, target.siteDomain)).filter((url): url is string => Boolean(url)))].sort();
    const hold = (reason: SerpMonitoringHoldReason) => {
      result.heldTargets.push({ ...target, targetUrls: [...target.targetUrls], reason, reasonLabel: monitoringHoldLabels[reason] });
      result.breakdown[holdCount[reason]]++;
    };
    let verifiedPages: string[] = [], readiness: SerpMonitoringReadiness;
    if (audit) {
      // A saved negative audit takes precedence over later source assertions.
      // A new page must pass page verification before its old hold is removed.
      if (audit.verdict === "NO_MATCH" || audit.verdict === "MISSING" || audit.workPlan?.action === "BUILD") { hold("PAGE_NOT_BUILT"); continue; }
      if (audit.verdict === "MISMATCH") { hold("PAGE_INTENT_MISMATCH"); continue; }
      if (audit.verdict === "REVIEW") { hold("PAGE_REVIEW_REQUIRED"); continue; }
      const auditedPages = new Set(pages(audit.pageUrls));
      if (audit.verdict === "VERIFIED") {
        if (audit.workPlan && audit.workPlan.action !== "LINK") { hold("PAGE_REVIEW_REQUIRED"); continue; }
        verifiedPages = pages([...target.targetUrls, ...(audit.workPlan?.pageUrls ?? [])]).filter(url => auditedPages.has(url));
        readiness = "VERIFIED_PAGE";
      } else if (audit.verdict === "CONTENT_GAP") {
        if (audit.workPlan && audit.workPlan.action !== "EXPAND") { hold("PAGE_REVIEW_REQUIRED"); continue; }
        // Audited existing pages can need optimization while targetUrls is
        // empty. Their work-plan pageUrls must not be mistaken for no page.
        verifiedPages = pages(audit.workPlan?.pageUrls ?? audit.pageUrls).filter(url => auditedPages.has(url));
        readiness = "PAGE_OPTIMIZATION";
      } else { hold("PAGE_REVIEW_REQUIRED"); continue; }
    } else {
      verifiedPages = pages(proof?.verifiedSourcePages ?? []);
      readiness = "SOURCE_VERIFIED";
    }
    if (!verifiedPages.length) { hold("NO_VERIFIED_PAGE"); continue; }
    result.targets.push({ ...target, targetUrls: verifiedPages });
    result.readinessByTarget[key] = readiness;
    if (readiness === "VERIFIED_PAGE") result.breakdown.verifiedPages++;
    else if (readiness === "PAGE_OPTIMIZATION") result.breakdown.existingPagesToOptimize++;
    else result.breakdown.sourceVerifiedPages++;
  }
  result.heldTargetCount = result.heldTargets.length;
  return result;
}
