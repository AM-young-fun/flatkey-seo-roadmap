import { createHash } from "node:crypto";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { ImportRequestError } from "@/lib/ranking-import";
import { normalizeAuditPageUrl, PAGE_AUDIT_SOURCE_ID, type PageAuditPayload, type PageAuditResult } from "@/lib/page-audit";

export type PageAuditMembership = { keywordId: string; keyword: { text: string; active: boolean }; active: boolean; pool: string; reviewStatus: string;
  curationId: string | null; curatedAt: Date | null; targetUrls: string[]; candidateUrls: string[]; mappingStatus: string; topicId: string | null; protected: boolean; auditReason: string | null };
export type PageAuditSourceState = { rowKey: string; snapshotHash: string; snapshot: unknown; observedAt: Date | null };
export type PageAuditSnapshot = Omit<PageAuditPayload["rows"][number], "pageUrl" | "canonicalUrl"> & { version: 1; keywordId: string; pageUrl?: string; canonicalUrl?: string };
export type PageAuditChange = { before: PageAuditMembership; after: Pick<PageAuditMembership, "mappingStatus" | "targetUrls" | "candidateUrls" | "auditReason">; fields: string[] };
export type PageAuditPlan = { result: PageAuditResult; snapshots: Array<{ rowKey: string; snapshot: PageAuditSnapshot; hash: string }>; memberships: PageAuditChange[] };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const tidy = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();

export function planKeywordPageAudit(payload: PageAuditPayload, priorRows: PageAuditSourceState[], memberships: PageAuditMembership[]): PageAuditPlan {
  const priorByKey = new Map(priorRows.map(row => [row.rowKey, row]));
  const proposed = payload.rows.map(row => {
    const keyword = normalizeKeywordText(row.keyword);
    const matches = memberships.filter(link => normalizeKeywordText(link.keyword.text) === keyword && link.active && link.keyword.active
      && (payload.targetDomain === "flatkey.ai" ? link.pool === "FORMAL" : link.topicId !== null));
    if (matches.length !== 1) throw new ImportRequestError(matches.length ? `关键词 ${keyword} 有多个正式身份，请人工核对` : `关键词 ${keyword} 不是已启用的本站正式目标`, matches.length ? 409 : 400);
    const before = matches[0], rowKey = `keyword:${before.keywordId}`;
    const snapshot: PageAuditSnapshot = { version: 1, keywordId: before.keywordId, keyword, verdict: row.verdict,
      ...(row.pageUrl ? { pageUrl: normalizeAuditPageUrl(row.pageUrl) } : {}), ...(row.canonicalUrl ? { canonicalUrl: normalizeAuditPageUrl(row.canonicalUrl) } : {}),
      ...(row.httpStatus !== undefined ? { httpStatus: row.httpStatus } : {}), checkedAt: new Date(row.checkedAt).toISOString(), reason: tidy(row.reason),
      evidence: Object.fromEntries(Object.entries(row.evidence).filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([key, value]) => [key, tidy(value)])) };
    if (row.inventory) snapshot.inventory = { ...row.inventory, checkedAt: new Date(row.inventory.checkedAt).toISOString() };
    if (row.workPlan) snapshot.workPlan = { ...row.workPlan,
      pageUrls: row.workPlan.pageUrls.map(normalizeAuditPageUrl),
      ...(row.workPlan.plannedPageUrl ? { plannedPageUrl: normalizeAuditPageUrl(row.workPlan.plannedPageUrl) } : {}),
      previousPageUrl: row.workPlan.previousPageUrl ? normalizeAuditPageUrl(row.workPlan.previousPageUrl) : null,
      proposedTitle: tidy(row.workPlan.proposedTitle), requirements: row.workPlan.requirements.map(tidy), acceptance: row.workPlan.acceptance.map(tidy) };
    if (row.additionalPages?.length) snapshot.additionalPages = row.additionalPages.map(page => ({ ...page,
      pageUrl: normalizeAuditPageUrl(page.pageUrl), canonicalUrl: normalizeAuditPageUrl(page.canonicalUrl), checkedAt: new Date(page.checkedAt).toISOString(), reason: tidy(page.reason),
      evidence: Object.fromEntries(Object.entries(page.evidence).filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([key, value]) => [key, tidy(value)])),
    })).sort((a, b) => a.pageUrl.localeCompare(b.pageUrl));
    return { before, rowKey, snapshot, hash: hash(snapshot) };
  }).sort((a, b) => a.rowKey.localeCompare(b.rowKey));
  if (new Set(proposed.map(row => row.rowKey)).size !== proposed.length) throw new ImportRequestError("每个正式关键词每批只能复核一次", 400);
  const stateHash = hash({ siteDomain: payload.targetDomain, sourceId: PAGE_AUDIT_SOURCE_ID, proposed: proposed.map(({ snapshot, before, rowKey }) => ({ snapshot, before, previousHash: priorByKey.get(rowKey)?.snapshotHash ?? null })) });
  const changed = proposed.filter(row => priorByKey.get(row.rowKey)?.snapshotHash !== row.hash);
  const result: PageAuditResult = { kind: "page-audit", requestId: payload.requestId, targetDomain: payload.targetDomain, action: payload.action,
    imported: changed.length, duplicate: changed.length === 0, stateHash,
    pageSummary: { changed: changed.length, unchanged: proposed.length - changed.length, verified: 0, missing: 0, mismatch: 0, review: 0, noMatch: 0, contentGap: 0 }, changes: [] };
  // A committed request may be replayed with its original preview hash. Stored
  // identical evidence is already processed and must not overwrite later edits.
  if (!changed.length) return { result, snapshots: [], memberships: [] };
  if (payload.expectedStateHash && payload.expectedStateHash !== stateHash) throw new ImportRequestError("预览后页面或人工审核状态已变化，请重新预览", 409);
  const planned: PageAuditChange[] = [];
  for (const row of changed) {
    const previous = priorByKey.get(row.rowKey);
    const checkedAt = Date.parse(row.snapshot.checkedAt);
    if ((previous?.observedAt && checkedAt <= previous.observedAt.getTime()) || (row.before.curatedAt && checkedAt < row.before.curatedAt.getTime())) throw new ImportRequestError(`关键词 ${row.snapshot.keyword} 的页面证据早于已有审核，请重新核验`, 409);
    const { before, snapshot } = row;
    const after = { mappingStatus: before.mappingStatus, targetUrls: [...before.targetUrls], candidateUrls: [...before.candidateUrls], auditReason: before.auditReason };
    if (snapshot.verdict !== "REVIEW") {
      after.mappingStatus = snapshot.verdict === "VERIFIED" ? "READY" : ["MISSING", "NO_MATCH"].includes(snapshot.verdict) ? "NEEDS_BUILD" : snapshot.verdict === "CONTENT_GAP" ? "NEEDS_EXPANSION" : "NEEDS_REMAP";
      after.targetUrls = snapshot.verdict === "VERIFIED" ? [snapshot.pageUrl!, ...(snapshot.additionalPages ?? []).map(page => page.pageUrl)] : [];
      after.candidateUrls = [...new Set([...before.candidateUrls, ...before.targetUrls, ...(snapshot.verdict !== "VERIFIED" && snapshot.pageUrl ? [snapshot.pageUrl] : [])])].filter(url => !after.targetUrls.includes(url));
      after.auditReason = `页面逐词复核 ${snapshot.checkedAt}｜${snapshot.verdict}｜${snapshot.pageUrl ? `HTTP ${snapshot.httpStatus}｜${snapshot.pageUrl}` : "公开页面目录核查"}｜${snapshot.reason}｜${JSON.stringify({ evidence: snapshot.evidence, inventory: snapshot.inventory, additionalPages: snapshot.additionalPages })}`;
    }
    const fields = (Object.keys(after) as Array<keyof typeof after>).filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
    if (fields.length) planned.push({ before, after, fields });
    const counter = { VERIFIED: "verified", MISSING: "missing", MISMATCH: "mismatch", REVIEW: "review", NO_MATCH: "noMatch", CONTENT_GAP: "contentGap" } as const;
    result.pageSummary[counter[snapshot.verdict]]++;
    result.changes.push({ keyword: snapshot.keyword, verdict: snapshot.verdict, mappingStatusBefore: before.mappingStatus, mappingStatusAfter: after.mappingStatus,
      targetUrlsBefore: before.targetUrls, targetUrlsAfter: after.targetUrls, candidateUrlsBefore: before.candidateUrls, candidateUrlsAfter: after.candidateUrls,
      fields, reason: snapshot.reason });
  }
  return { result, snapshots: changed.map(({ rowKey, snapshot, hash }) => ({ rowKey, snapshot, hash })), memberships: planned };
}
