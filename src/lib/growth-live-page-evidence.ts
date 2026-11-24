import type { GrowthLivePageCheck } from "./growth-live-page";
import { growthWordKey } from "./growth-workspace";

type Target = { site: string; keywordId: string | null; keyword: string };
type PageAuditRow = { siteDomain: string; sourceId: string; rowKey: string; snapshotHash?: string; snapshot: unknown };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : null;

/** Consume the original normal page-audit record, never inventory READY/URLs.
 * REVIEW intentionally preserves old mappings, so it must remain counterevidence. */
export function growthPageAuditChecks(rows: PageAuditRow[], targets: Target[]): GrowthLivePageCheck[] {
  const selected = new Map(targets.filter(target => target.keywordId).map(target => [`${target.site}:keyword:${target.keywordId}`, target]));
  return rows.flatMap(row => {
    if (row.sourceId !== "page_audit") return [];
    const target = selected.get(`${row.siteDomain}:${row.rowKey}`); if (!target) return [];
    const snapshot = record(row.snapshot), identity = snapshot.keywordId === target.keywordId && typeof snapshot.keyword === "string" && growthWordKey(snapshot.keyword) === growthWordKey(target.keyword);
    const source = `page-audit:${row.siteDomain}:${row.rowKey}:${row.snapshotHash ?? "original-source"}`;
    const base = { site: row.siteDomain, keywordId: target.keywordId, source };
    const primary: GrowthLivePageCheck = { ...base, url: identity ? text(snapshot.pageUrl) : null, checkedAt: text(snapshot.checkedAt) ?? "", httpStatus: identity && typeof snapshot.httpStatus === "number" ? snapshot.httpStatus : null, canonicalUrl: identity ? text(snapshot.canonicalUrl) : null, verified: identity && snapshot.verdict === "VERIFIED" };
    const additional = identity && snapshot.verdict === "VERIFIED" && Array.isArray(snapshot.additionalPages) ? snapshot.additionalPages.map(value => {
      const page = record(value);
      return { ...base, url: text(page.pageUrl), checkedAt: text(page.checkedAt) ?? "", httpStatus: typeof page.httpStatus === "number" ? page.httpStatus : null, canonicalUrl: text(page.canonicalUrl), verified: true };
    }) : [];
    return [primary, ...additional];
  });
}

/** A stored publication is positive only with its actual versioned liveCheck.
 * publishedAt/verifiedAt/updatedAt never substitute for an HTTP checkedAt. */
export function growthPublicationPageChecks(workflow: { tasks: { id: string; siteDomain: string; keywordId?: string | null; keyword?: string | null; deletedAt?: string }[]; publications: { id: string; taskId: string; siteDomain: string; pageUrl: string; status: string; contentVersion: string; language: string; publishedAt: string; liveCheck?: unknown }[] }, targets: Target[]): GrowthLivePageCheck[] {
  const tasks = new Map(workflow.tasks.filter(task => !task.deletedAt).map(task => [task.id, task]));
  const selected = new Map(targets.filter(target => target.keywordId).map(target => [`${target.site}:${target.keywordId}`, target]));
  return workflow.publications.flatMap(publication => {
    const task = tasks.get(publication.taskId), target = task?.keywordId ? selected.get(`${publication.siteDomain}:${task.keywordId}`) : null;
    if (!task || task.siteDomain !== publication.siteDomain || !target || !task.keyword || growthWordKey(task.keyword) !== growthWordKey(target.keyword)) return [];
    const live = record(publication.liveCheck); if (!Object.keys(live).length) return [];
    const checkedAt = text(live.checkedAt) ?? "";
    const verified = publication.status === "verified" && live.httpStatus === 200 && live.contentMatched === true && live.linksChecked === true
      && live.contentVersion === publication.contentVersion && live.language === publication.language && typeof live.sourceReceipt === "string" && Boolean(live.sourceReceipt.trim())
      && Array.isArray(live.evidence) && live.evidence.length > 0 && Date.parse(checkedAt) >= Date.parse(publication.publishedAt);
    return [{ site: publication.siteDomain, keywordId: task.keywordId!, url: publication.pageUrl, checkedAt, httpStatus: typeof live.httpStatus === "number" ? live.httpStatus : null, canonicalUrl: text(live.canonicalUrl), verified, source: `publication:${publication.id}:${publication.contentVersion}` }];
  });
}
