import { createHash } from "node:crypto";
import { keywordRelevance, normalizeKeywordText } from "@/lib/keyword-relevance";
import keywordAudit from "@/lib/data/keyword-okr-audit.json";
import { ImportRequestError } from "@/lib/ranking-import";
import { SOURCE_SYNC_SOURCES, type SourceSyncPayload, type SourceSyncResult } from "@/lib/source-sync";

type InputRow = SourceSyncPayload["rows"][number];
export type SourceSnapshot = { version: 1; rowKey: string; slug: string; language: string; title: string; topic: string;
  completion: InputRow["completion"]; rawStatus: string; pageUrl: string | null;
  optimizedAt?: string | null; optimizationNote?: string;
  publication: { pageVerified: boolean; verificationReason: string };
  keywords: Array<{ keyword: string; role: "PRIMARY" | "SECONDARY"; relevance: "RELEVANT" | "REVIEW" | "UNRELATED"; reason: string; pageIntentMatched: boolean; newModel: boolean }>;
};
export type SourceState = { rowKey: string; snapshotHash: string; snapshot: unknown; observedAt: Date | null };
export type SyncKeyword = { id: string; text: string; active: boolean };
export type SyncMembership = { keywordId: string; active: boolean; pool: string; reviewStatus: string; curationId: string | null;
  curatedAt: Date | null; targetUrls: string[]; candidateUrls: string[]; mappingStatus: string; topicId: string | null; protected: boolean };
export type SyncMembershipChange = { normalized: string; keywordId: string | null; create: boolean; pool: "FORMAL" | "RESEARCH";
  reviewStatus: string; reason: string; pageUrl: string | null; protected: boolean; fillInitialPage: boolean; verifyExisting: boolean };
export type SourceSyncPlan = { result: SourceSyncResult; snapshots: Array<{ row: SourceSnapshot; hash: string }>;
  newKeywords: Array<{ text: string; type: "MAIN" | "LONG_TAIL" }>; memberships: SyncMembershipChange[] };
const curatedDecisions = new Map(keywordAudit.decisions.map(decision => [normalizeKeywordText(decision.text), decision]));
const tidy = (value?: string) => (value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
export const sourceSyncHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function normalizeSourceRows(payload: SourceSyncPayload): SourceSnapshot[] {
  return payload.rows.map(row => {
    let pageUrl: string | null = null;
    if (row.pageUrl) {
      const parsed = new URL(row.pageUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || !(parsed.hostname === "flatkey.ai" || parsed.hostname.endsWith(".flatkey.ai"))) {
        throw new ImportRequestError("来源页面必须是本站的HTTPS页面", 400);
      }
      parsed.hash = "";
      pageUrl = parsed.toString();
    }
    const keywords = row.keywords.map(word => ({ keyword: normalizeKeywordText(word.keyword), role: word.role, relevance: word.relevance,
      reason: tidy(word.reason), pageIntentMatched: word.pageIntentMatched, newModel: word.newModel })).sort((a, b) => a.keyword.localeCompare(b.keyword));
    if (new Set(keywords.map(word => word.keyword)).size !== keywords.length) throw new ImportRequestError(`来源行 ${row.rowKey} 存在规范化重复词，请先去重`, 400);
    return { version: 1 as const, rowKey: row.rowKey.normalize("NFKC").trim(), slug: tidy(row.slug), language: tidy(row.language).toLowerCase(), title: tidy(row.title), topic: tidy(row.topic),
      completion: row.completion, rawStatus: tidy(row.rawStatus), pageUrl,
      ...(row.optimizedAt !== undefined ? { optimizedAt: row.optimizedAt } : {}),
      ...(row.optimizationNote !== undefined ? { optimizationNote: tidy(row.optimizationNote) } : {}),
      publication: { pageVerified: row.publication.pageVerified, verificationReason: tidy(row.publication.verificationReason) }, keywords };
  }).sort((a, b) => a.rowKey.localeCompare(b.rowKey));
}

export function planSourceSync(payload: SourceSyncPayload, priorRows: SourceState[], keywords: SyncKeyword[], links: SyncMembership[]): SourceSyncPlan {
  const priorByKey = new Map(priorRows.map(row => [row.rowKey, row]));
  const normalized = normalizeSourceRows({ ...payload, rows: payload.rows.map(row => {
    // Older collectors do not yet send the publication date. Their next sync
    // must not erase a date already read from the optimization sheet.
    const prior = priorByKey.get(row.rowKey.normalize("NFKC").trim())?.snapshot as SourceSnapshot | undefined;
    return { ...row,
      ...(row.optimizedAt === undefined && prior?.optimizedAt !== undefined ? { optimizedAt: prior.optimizedAt } : {}),
      ...(row.optimizationNote === undefined && prior?.optimizationNote !== undefined ? { optimizationNote: prior.optimizationNote } : {}),
    };
  }) });
  if (new Set(normalized.map(row => row.rowKey)).size !== normalized.length) throw new ImportRequestError("来源行标识规范化后重复", 400);
  const snapshots = normalized.map(row => ({ row, hash: sourceSyncHash(row) })).filter(({ row, hash }) => priorByKey.get(row.rowKey)?.snapshotHash !== hash);
  for (const { row } of snapshots) {
    const prior = priorByKey.get(row.rowKey);
    if (prior?.observedAt && !payload.collectedAt) throw new ImportRequestError(`来源行 ${row.rowKey} 已有读取时间，变更时必须提供collectedAt`, 409);
    if (payload.collectedAt && prior?.observedAt && Date.parse(payload.collectedAt) < prior.observedAt.getTime()) throw new ImportRequestError(`来源行 ${row.rowKey} 早于已保存的版本，请重新读取`, 409);
  }
  const incomingTexts = new Set(normalized.flatMap(row => row.keywords.map(word => word.keyword)));
  const grouped = new Map<string, SyncKeyword[]>();
  for (const keyword of keywords) {
    const text = normalizeKeywordText(keyword.text);
    if (incomingTexts.has(text)) grouped.set(text, [...(grouped.get(text) ?? []), keyword]);
  }
  const linkById = new Map(links.map(link => [link.keywordId, link]));
  const stateHash = sourceSyncHash({ sourceId: payload.sourceId, proposedRows: normalized,
    rows: normalized.map(row => ({ rowKey: row.rowKey, snapshotHash: priorByKey.get(row.rowKey)?.snapshotHash ?? null })),
    keywords: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([text, values]) => ({ text, values: values.map(keyword => ({ ...keyword, membership: linkById.get(keyword.id) ?? null })).sort((a, b) => a.id.localeCompare(b.id)) })),
  });
  const result: SourceSyncResult = { kind: "source-sync", requestId: payload.requestId, targetDomain: "flatkey.ai", sourceId: payload.sourceId, action: payload.action,
    imported: snapshots.length, duplicate: snapshots.length === 0, stateHash,
    sourceSummary: { changedRows: snapshots.length, unchangedRows: normalized.length - snapshots.length, newKeywords: 0, newMemberships: 0, promotedFormal: 0, heldResearch: 0, blocked: 0, conflicts: 0, updatedMemberships: 0 }, changes: [] };
  const newKeywords: SourceSyncPlan["newKeywords"] = [], memberships: SyncMembershipChange[] = [];
  if (!snapshots.length) return { result, snapshots, newKeywords, memberships };
  // A lost response may be replayed with the original preview token. Identical
  // stored source rows are already committed and must remain a read-only retry.
  if (payload.expectedStateHash && payload.expectedStateHash !== stateHash) throw new ImportRequestError("预览后来源或人工审核状态已变化，请重新预览", 409);
  for (const { row } of snapshots) {
    const before = priorByKey.get(row.rowKey)?.snapshot as Record<string, unknown> | undefined;
    const fields = before ? Object.keys(row).filter(key => JSON.stringify(before[key]) !== JSON.stringify(row[key as keyof SourceSnapshot])) : ["sourceSnapshot"];
    result.changes.push({ rowKey: row.rowKey, keyword: null, action: before ? "source_row_changed" : "source_row_added", fields, reason: "仅保存此稳定来源行的增量；缺行和移除的词均不删除" });
  }
  const affected = new Set(snapshots.flatMap(({ row }) => row.keywords.map(word => word.keyword)));
  for (const text of [...affected].sort()) {
    const sources = normalized.flatMap(row => row.keywords.filter(word => word.keyword === text).map(word => ({ row, word })));
    const rowKey = sources.map(source => source.row.rowKey).sort()[0];
    const record = (action: string, reason: string, fields: string[] = [], verifyExisting = false) => result.changes.push({ rowKey, keyword: text, action, fields, reason, ...(verifyExisting ? { verifyExisting: true as const } : {}) });
    const policy = keywordRelevance("flatkey.ai", text);
    const decision = curatedDecisions.get(text);
    const retired = decision && /^(?:exclude_|merge_|retire_|normalize_)/.test(decision.action);
    if (retired) {
      result.sourceSummary.blocked++; record("curated_alias_or_exclusion", keywordAudit.reasons[decision.reason]); continue;
    }
    const curatedHold = decision?.action.startsWith("hold_") ?? false;
    if (policy.status === "unrelated" || sources.every(source => source.word.relevance === "UNRELATED")) {
      result.sourceSummary.blocked++; record("unrelated_source_only", policy.reason ?? "来源审核判断业务无关，仅保留原始来源记录"); continue;
    }
    const candidates = grouped.get(text) ?? [];
    const tracked = candidates.filter(keyword => linkById.has(keyword.id));
    const activeTracked = tracked.filter(keyword => linkById.get(keyword.id)!.active);
    if (activeTracked.length > 1 || (!activeTracked.length && tracked.length > 1) || (!tracked.length && candidates.length > 1)) {
      result.sourceSummary.conflicts++; record("ambiguous_keyword_identity", "多个关键词ID规范化后相同，未自动选择或制造别名"); continue;
    }
    const selected = activeTracked[0] ?? tracked[0] ?? candidates[0];
    const link = selected ? linkById.get(selected.id) : undefined;
    if ((selected && !selected.active) || (link && (!link.active || ["ARCHIVED", "MERGED"].includes(link.pool)))) {
      result.sourceSummary.blocked++; record("protected_inactive", "全局停用、归档或归并记录不能由来源同步复活"); continue;
    }
    const qualified = sources.filter(({ row, word }) => {
      const modelException = word.newModel && word.reason.length >= 20 && word.relevance !== "UNRELATED";
      const relevant = (word.relevance === "RELEVANT" && policy.status !== "review") || modelException;
      return !curatedHold && relevant && row.completion === "COMPLETED" && row.pageUrl && row.publication.pageVerified && row.publication.verificationReason.length >= 12 && word.pageIntentMatched;
    });
    const verifiedPages = [...new Set(qualified.map(source => source.row.pageUrl!))].sort();
    const promotableReview = !link || ["UNREVIEWED", "OUTSIDE_FORMAL_POOL"].includes(link.reviewStatus);
    if (link?.pool === "FORMAL" || (link && !promotableReview)) {
      if (link.pool === "FORMAL" && ["CONFIRMED", "SOURCE_CONFIRMED"].includes(link.reviewStatus) && link.mappingStatus === "RECORDED" && link.candidateUrls.length === 0 && link.targetUrls.length === 1
        && verifiedPages.length === 1 && link.targetUrls[0] === verifiedPages[0]) {
        const reason = "已有正式目标的同一页面首次完成公开可用性与该关键词主意图核验，仅更新核验状态";
        memberships.push({ normalized: text, keywordId: selected!.id, create: false, pool: "FORMAL", reviewStatus: link.reviewStatus,
          reason, pageUrl: verifiedPages[0], protected: link.protected, fillInitialPage: false, verifyExisting: true });
        result.sourceSummary.updatedMemberships++;
        record("verified_existing_page", reason, ["mappingStatus"], true);
      } else {
        const sourceUrls = [...new Set(sources.map(source => source.row.pageUrl).filter((url): url is string => Boolean(url)))];
        if (sourceUrls.some(url => !link.targetUrls.includes(url))) { result.sourceSummary.conflicts++; record("protected_mapping", "已有正式或人工审核的页面和状态保持不变；新来源页面待核对"); }
        else record("protected_existing", "已有正式或人工审核决定保持不变，仅追加来源记录");
      }
      continue;
    }
    let formal = verifiedPages.length === 1;
    if (verifiedPages.length > 1) { result.sourceSummary.conflicts++; record("multiple_verified_pages", "同一词有多个真实页面候选，未自动选页或重挂"); }
    const pageUrl = formal ? verifiedPages[0] : null;
    const existingPages = link?.targetUrls ?? [];
    if (formal && existingPages.length && !(existingPages.length === 1 && existingPages[0] === pageUrl)) {
      formal = false; result.sourceSummary.conflicts++; record("existing_mapping_conflict", "既有页面关联与新来源不同，不重挂、不晋升");
    }
    if (formal && link && ((!link.topicId) || (link.curationId && (link.mappingStatus !== "UNMAPPED" || link.candidateUrls.length > 0)))) {
      formal = false; result.sourceSummary.conflicts++; record("protected_reviewed_mapping", "缺少话题归属或已有人工页面审核结论，保持候选，不覆盖人工配置");
    }
    const reason = formal ? "协作表已完成；业务相关、页面公开可用且该关键词主意图已核实" : "保留候选：尚未同时确认完成、业务相关、真实页面与该词意图匹配";
    if (!selected) { newKeywords.push({ text, type: sources.some(source => source.word.role === "PRIMARY") ? "MAIN" : "LONG_TAIL" }); result.sourceSummary.newKeywords++; }
    if (!link) {
      memberships.push({ normalized: text, keywordId: selected?.id ?? null, create: true, pool: formal ? "FORMAL" : "RESEARCH", reviewStatus: formal ? "SOURCE_CONFIRMED" : curatedHold ? "HELD_FOR_RESEARCH" : "UNREVIEWED", reason, pageUrl: formal ? pageUrl : null, protected: formal && qualified.some(source => source.word.newModel), fillInitialPage: formal, verifyExisting: false });
      result.sourceSummary.newMemberships++;
      if (formal) result.sourceSummary.promotedFormal++; else result.sourceSummary.heldResearch++;
      record(formal ? "new_formal" : "new_research", reason, ["membership", "pool", ...(formal ? ["initialTargetUrl", "verifiedMapping"] : [])]);
    } else if (formal) {
      memberships.push({ normalized: text, keywordId: selected!.id, create: false, pool: "FORMAL", reviewStatus: "SOURCE_CONFIRMED", reason, pageUrl, protected: link.protected, fillInitialPage: !existingPages.length, verifyExisting: false });
      result.sourceSummary.promotedFormal++; result.sourceSummary.updatedMemberships++;
      record("promoted_formal", reason, ["pool", "reviewStatus", ...(!existingPages.length ? ["initialTargetUrl", "verifiedMapping"] : [])]);
    } else {
      result.sourceSummary.heldResearch++; record("research_retained", reason);
    }
  }
  return { result, snapshots, newKeywords, memberships };
}

export function sourceSyncDocumentUrl(sourceId: SourceSyncPayload["sourceId"]) { return SOURCE_SYNC_SOURCES[sourceId].url; }
