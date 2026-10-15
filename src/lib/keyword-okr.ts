export const KEYWORD_OKR_AUDIT_ID = "flatkey-keyword-curation-2026-10-15-v2";
export type KeywordPool = "FORMAL" | "RESEARCH" | "ARCHIVED" | "MERGED";
export type KeywordMappingStatus = "READY" | "MODEL_PROTECTED" | "RECORDED" | "UNMAPPED" | "NEEDS_BUILD" | "NEEDS_EXPANSION" | "NEEDS_REMAP" | "MULTIPLE_CANDIDATES";
export type KeywordOkrItem = {
  id: string; text: string; siteDomain: string; active: boolean; pool: KeywordPool;
  reviewStatus: string; mappingStatus: KeywordMappingStatus; targetUrls: string[]; candidateUrls: string[];
  reason: string | null; protected: boolean; auditedAt: string | null; auditId: string | null;
  actualPages: Array<{ url: string; source: string; region: string; periodStart: string | null; periodEnd: string | null; collectedAt: string; rank: number | null }>;
};
export type KeywordContentTask = {
  id: string; plannedUrl: string; type: "NEW" | "EXPAND" | "REUSE"; status: string;
  title: string; reason: string; keywords: string[]; targetUrls: string[]; owner: string | null; dueAt: string | null;
};
export type KeywordOkrResponse = {
  siteDomain: string; initialized: boolean; rankingCaptureEnabled: false;
  availableAudit: { id: string; asOf: string; formalKeywords: number; tasks: number };
  summary: { formal: number; research: number; archived: number; merged: number; protectedModels: number; mapping: Record<string, number>; tasks: Record<string, number> };
  keywords: KeywordOkrItem[]; tasks: KeywordContentTask[];
  audits: Array<{ id: string; status: string; appliedAt: string; restoredAt: string | null; changed: number }>;
};
export type KeywordOkrMutation = { siteDomain: "flatkey.ai"; action: "preview" | "apply" | "restore"; auditId: string };
export type KeywordOkrMutationResponse = {
  siteDomain: string; auditId: string; action: "preview" | "apply" | "restore";
  status: "PREVIEW" | "APPLIED" | "RESTORED"; changed: number; unchanged: boolean;
  summary: KeywordOkrResponse["summary"]; rankingCaptureEnabled: false;
};
