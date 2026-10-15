import auditData from "@/lib/data/keyword-okr-audit.json";
import { keywordRelevance, normalizeKeywordText } from "@/lib/keyword-relevance";
import { KEYWORD_OKR_AUDIT_ID, type KeywordMappingStatus, type KeywordPool, type KeywordOkrResponse } from "@/lib/keyword-okr";

export const okrAudit = auditData;
export const OKR_SITE = "flatkey.ai";
export type CurationState = {
  keywordId: string; text: string; active: boolean; topicId: string | null; origin: string; targetUrls: string[];
  pool: KeywordPool; reviewStatus: string; mappingStatus: KeywordMappingStatus; candidateUrls: string[];
  auditReason: string | null; protected: boolean; curatedAt: string | null; curationId: string | null;
  exclusionReason: string | null; excludedAt: string | null; restoredAt: string | null;
};
export type CurationKeyword = { id: string; text: string; topicId?: string | null; active?: boolean };

export function auditedMapping(row: typeof auditData.keywords[number]) {
  const urls = [...new Set(row.urls)];
  const protectedModel = row.actions.includes("retain_model_protected");
  let mappingStatus: KeywordMappingStatus;
  if (protectedModel) mappingStatus = "MODEL_PROTECTED";
  else if (row.mapping === "已有匹配正文，待关联") mappingStatus = "READY";
  else if (row.actions.includes("retain_remap")) mappingStatus = urls.length ? "NEEDS_REMAP" : "NEEDS_BUILD";
  else if (row.mapping.includes("补强") || row.mapping.includes("维护")) mappingStatus = "NEEDS_EXPANSION";
  else if (row.mapping.includes("待制作") || row.mapping.includes("待建") || row.mapping.includes("需制作")) mappingStatus = "NEEDS_BUILD";
  else mappingStatus = urls.length > 1 ? "MULTIPLE_CANDIDATES" : urls.length ? "RECORDED" : "UNMAPPED";
  // An HTTP 200 or a former sheet URL is not proof of intent coverage. Keep
  // remap/partial candidates separate until a later explicit review.
  const targetUrls = ["READY", "MODEL_PROTECTED", "RECORDED"].includes(mappingStatus) ? urls : [];
  return { mappingStatus, targetUrls, candidateUrls: targetUrls.length ? [] : urls, protectedModel };
}

export function buildCurationPlan(existing: CurationState[], keywords: CurationKeyword[], fallbackTopics: { formal: string; model: string }, at: string): CurationState[] {
  const linksByText = new Map<string, CurationState[]>();
  for (const row of existing) {
    const key = normalizeKeywordText(row.text);
    linksByText.set(key, [...(linksByText.get(key) ?? []), row]);
  }
  const keywordsByText = new Map<string, CurationKeyword[]>();
  for (const row of keywords) {
    const key = normalizeKeywordText(row.text);
    keywordsByText.set(key, [...(keywordsByText.get(key) ?? []), row]);
  }
  const decisions = new Map(auditData.decisions.map(row => [normalizeKeywordText(row.text), row]));
  const after = new Map<string, CurationState>();
  for (const row of existing) {
    const relevance = keywordRelevance(OKR_SITE, row.text);
    const decision = decisions.get(normalizeKeywordText(row.text));
    const excluded = decision?.action.startsWith("exclude_") || relevance.status === "unrelated";
    const merged = decision?.action.startsWith("merge_") || decision?.action.startsWith("retire_") || decision?.action.startsWith("normalize_");
    const pool: KeywordPool = excluded ? "ARCHIVED" : merged ? "MERGED" : "RESEARCH";
    after.set(row.keywordId, { ...row, pool, active: pool === "RESEARCH" ? row.active : false,
      reviewStatus: excluded ? "EXCLUDED" : merged ? "MERGED" : decision ? "HELD_FOR_RESEARCH" : relevance.status === "review" ? "HELD_FOR_RESEARCH" : "OUTSIDE_FORMAL_POOL",
      auditReason: decision ? auditData.reasons[decision.reason] : relevance.reason ?? "不在本轮已确认业务目标中，保留研究及历史记录",
      protected: false, curatedAt: at, curationId: KEYWORD_OKR_AUDIT_ID,
      ...(pool === "RESEARCH" ? {} : { exclusionReason: decision ? auditData.reasons[decision.reason] : relevance.reason ?? "业务无关", excludedAt: at }),
    });
  }
  for (const row of auditData.keywords) {
    const text = normalizeKeywordText(row.text);
    const priorCandidates = linksByText.get(text) ?? [];
    const prior = priorCandidates.find(item => item.text === text) ?? priorCandidates[0];
    const candidates = keywordsByText.get(text) ?? [];
    const keyword = prior ? { id: prior.keywordId, text: prior.text, topicId: prior.topicId } : candidates.find(item => item.text === text) ?? candidates[0] ?? { id: `new:${text}`, text };
    const mapping = auditedMapping(row);
    after.set(keyword.id, {
      keywordId: keyword.id, text: keyword.text, active: true,
      topicId: prior?.topicId ?? (mapping.protectedModel ? fallbackTopics.model : fallbackTopics.formal),
      origin: prior?.origin ?? "PLANNED", targetUrls: mapping.targetUrls,
      pool: "FORMAL", reviewStatus: "CONFIRMED", mappingStatus: mapping.mappingStatus, candidateUrls: mapping.candidateUrls,
      auditReason: auditData.reasons[row.reason], protected: mapping.protectedModel,
      curatedAt: at, curationId: KEYWORD_OKR_AUDIT_ID, exclusionReason: null, excludedAt: null,
      restoredAt: prior?.active === false ? at : prior?.restoredAt ?? null,
    });
    // Case/spacing aliases stay recoverable but cannot inflate formal counts.
    for (const duplicate of priorCandidates.filter(item => item.keywordId !== keyword.id)) {
      after.set(duplicate.keywordId, { ...after.get(duplicate.keywordId)!, pool: "MERGED", active: false,
        reviewStatus: "MERGED", auditReason: `规范化重复词，正式目标为 ${text}`, exclusionReason: `规范化重复词，正式目标为 ${text}`, excludedAt: at });
    }
  }
  return [...after.values()].sort((a, b) => a.keywordId.localeCompare(b.keywordId));
}

export function summarizeCuration(rows: CurationState[]): KeywordOkrResponse["summary"] {
  const summary: KeywordOkrResponse["summary"] = { formal: 0, research: 0, archived: 0, merged: 0, protectedModels: 0, mapping: {}, tasks: {} };
  for (const row of rows) {
    const key = row.pool.toLowerCase() as "formal" | "research" | "archived" | "merged";
    summary[key]++;
    if (row.pool === "FORMAL") {
      summary.mapping[row.mappingStatus] = (summary.mapping[row.mappingStatus] ?? 0) + 1;
      if (row.protected) summary.protectedModels++;
    }
  }
  for (const row of auditData.tasks) summary.tasks[row.type] = (summary.tasks[row.type] ?? 0) + 1;
  return summary;
}

export function restoredCuration(before: CurationState[], after: CurationState[], current: CurationState[], at: string): CurationState[] {
  const live = new Map(current.map(row => [row.keywordId, row]));
  const prior = new Map(before.map(row => [row.keywordId, row]));
  const same = (a: CurationState, b: CurationState) => (Object.keys(a) as Array<keyof CurationState>).filter(key => key !== "text").every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]));
  for (const row of after) {
    const currentRow = live.get(row.keywordId);
    if (!currentRow || !same(currentRow, row)) throw new Error("审计后关键词配置已变化，不能覆盖后续修改；请先核对冲突");
  }
  return after.map(row => prior.get(row.keywordId) ?? { ...row, active: false, pool: "RESEARCH", reviewStatus: "AUDIT_RESTORED", protected: false,
    curationId: null, curatedAt: null, targetUrls: [], candidateUrls: [], mappingStatus: "UNMAPPED",
    auditReason: "已恢复审计；此批次新建的关联保留历史，退出正式目标", excludedAt: at, exclusionReason: "审计恢复：批次新增关联", restoredAt: at });
}
