import { z } from "zod";
import { createHash } from "node:crypto";
import { quarterMembershipSelectionSchema, quarterMembershipHash, type QuarterMembershipRow, type QuarterMembershipTopic } from "./quarter-membership";
import { GROWTH_RESEARCH_COUNTRIES, GROWTH_LANGUAGES, GROWTH_MARKET_LANGUAGES, isGrowthTopicPlaceholder } from "./seo-growth-markets";
import { keywordMarketAssignmentSchema, MARKET_ASSIGNMENT_SOURCE_ID, readKeywordMarketAssignment } from "./keyword-market-policy";
import { reviewGrowthLanguage, growthTargetId, type GrowthWordLanguageEvidence } from "./growth-workspace";
import { approvedDiagnosticWordLanguages } from "./growth-word-language-evidence";
import { GROWTH_DEADLINE_CUTOFF } from "./growth-strategy";

export const HUMAN_WORD_LANGUAGE_SOURCE_ID = "SEO_HUMAN_WORD_LANGUAGE_REVIEW";
export const PRE_FREEZE_IDENTITY_AUDIT = "PRE_FREEZE_IDENTITIES_APPLIED_V1";
const sha = z.string().regex(/^[a-f0-9]{64}$/u), id = z.string().min(1).max(200);
const evidence = z.object({ reference: z.string().min(1).max(3000), observedAt: z.iso.datetime({ offset: true }),
  content: z.string().min(1).max(16000), sha256: sha, quote: z.string().min(1).max(4000) }).strict();
const historicalTimeUnknown = z.object({ acknowledgement: z.literal("historical-time-unknown"),
  selectionSourceHash: sha, keyword: z.string().min(1).max(2000), country: z.enum(GROWTH_RESEARCH_COUNTRIES), language: z.enum(GROWTH_LANGUAGES),
  sourceSha256: sha, reason: z.string().trim().min(12).max(2000) }).strict();
const span = z.object({ text: z.string().min(1).max(500), start: z.number().int().min(0), end: z.number().int().positive() }).strict();
export const preFreezeReviewSchema = z.object({ version: z.literal("pre-freeze-identities-v1"),
  selection: quarterMembershipSelectionSchema, selectionHash: sha,
  assignments: z.array(z.object({ siteDomain: z.enum(["flatkey.ai", "rackrate.org", "modelfit.cc"]), keywordId: id,
    keyword: z.string().min(1).max(2000), topicId: id, country: z.enum(GROWTH_RESEARCH_COUNTRIES), language: z.enum(GROWTH_LANGUAGES),
    demand: evidence.extend({ observedAt: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).nullable(),
      timePrecision: z.enum(["day", "instant"]).optional(), observedAtOriginal: z.string().min(1).max(100).optional(), historicalTimeUnknown: historicalTimeUnknown.optional(),
      exactKeyword: z.string().min(1).max(2000), country: z.enum(GROWTH_RESEARCH_COUNTRIES), language: z.enum(GROWTH_LANGUAGES),
      metric: z.enum(["monthly_searches", "clicks", "impressions"]), value: z.number().positive().finite() }).strict(),
    wordLanguage: evidence.extend({ language: z.enum(GROWTH_LANGUAGES), spans: z.array(span).min(1).max(12), reason: z.string().trim().min(12).max(4000) }).strict(),
  }).strict()).min(1).max(200),
}).strict();
export const preFreezeCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview_identities"), requestId: id, review: preFreezeReviewSchema }).strict(),
  z.object({ action: z.literal("apply_identities"), requestId: id, review: preFreezeReviewSchema, expectedStateHash: sha,
    historicalTimeUnknownAcknowledged: z.literal(true).optional() }).strict(),
]);
export type PreFreezeReview = z.infer<typeof preFreezeReviewSchema>;
export type PreFreezeCommand = z.infer<typeof preFreezeCommandSchema>;
export type IdentitySourceRow = { siteDomain: string; sourceId: string; rowKey: string; snapshotHash: string; snapshot: unknown; [key: string]: unknown };
export type IdentityAudit = { id: string; status: string; summary: unknown; [key: string]: unknown };
export function hasHumanIdentityAudit(audit: IdentityAudit): boolean {
  const summary = object(audit.summary), receipt = object(summary.receipt);
  return audit.status === PRE_FREEZE_IDENTITY_AUDIT && receipt.actor === "human" && typeof receipt.requestId === "string"
    && audit.id === identityAuditId(receipt.requestId) && receipt.requestHash === audit.payloadHash
    && summary.receiptHash === preFreezeHash(receipt);
}
export type PreFreezeIdentityState = { members: QuarterMembershipRow[]; topics: QuarterMembershipTopic[];
  sites: { domain: string; active: boolean; [key: string]: unknown }[]; sources: IdentitySourceRow[]; proofAudits: IdentityAudit[]; quarter: unknown };
export class PreFreezeIdentityError extends Error { constructor(public code: string, message: string, public status = 409) { super(message); } }
export const preFreezeHash = quarterMembershipHash;
export const identityAuditId = (requestId: string) => `pre-freeze-identities:${requestId}`;
const memberKey = (site: string, keywordId: string) => `${site}\u0000${keywordId}`;
export const identitySourceKey = (row: Pick<IdentitySourceRow, "siteDomain" | "sourceId" | "rowKey">) => `${row.siteDomain}\u0000${row.sourceId}\u0000${row.rowKey}`;
const rowKey = (keywordId: string) => `keyword:${keywordId}`;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function preFreezeStateHash(state: PreFreezeIdentityState, review: PreFreezeReview) {
  return preFreezeHash({ selectionHash: review.selectionHash, reviewHash: preFreezeHash(review),
    ...state, members: [...state.members].sort((a, b) => memberKey(a.siteDomain, a.keywordId).localeCompare(memberKey(b.siteDomain, b.keywordId))),
    topics: [...state.topics].sort((a, b) => a.id.localeCompare(b.id)), sites: [...state.sites].sort((a, b) => a.domain.localeCompare(b.domain)),
    sources: [...state.sources].sort((a, b) => identitySourceKey(a).localeCompare(identitySourceKey(b))), proofAudits: [...state.proofAudits].sort((a, b) => a.id.localeCompare(b.id)) });
}
function rawSha(content: string) {
  // Artifact bytes use SHA256; state snapshots use stable canonical JSON.
  return createHash("sha256").update(content, "utf8").digest("hex");
}
function validateEvidence(source: Omit<z.infer<typeof evidence>, "observedAt"> & { observedAt: string | null }, now: Date, allowUnknownTime = false) {
  if (rawSha(source.content) !== source.sha256 || !source.content.includes(source.quote)
    || (source.observedAt === null ? !allowUnknownTime : /^\d{4}-\d{2}-\d{2}$/u.test(source.observedAt)
      ? source.observedAt > now.toISOString().slice(0, 10) : Date.parse(source.observedAt) > now.getTime())) throw new PreFreezeIdentityError("evidence_changed", "来源字节SHA、原文摘录或真实时间不匹配", 422);
}
const neutral = /^(?:gpu|cpu|api|ai|ia|llm|llms|ram|vram|cuda|gguf|ggml|moe|rag|ocr|vllm|lora|qlora|gpt|llama|qwen|claude|gemini|deepseek|mistral|llava|bloom|hunyuan|minimax|anthropic|openai|meta|google|nvidia|amd|intel|rtx|gtx|dgx|hbm|pcie|nvlink|nvl|tesla|geforce|quadro|blackwell|hopper|ampere|turing|volta|ada|lovelace|instruct|chat|base|vision|thinking|turbo|pro|ultra|mini|nano|flash|preview|fast)$/iu;
function validateLanguage(item: PreFreezeReview["assignments"][number], selectionSourceHash: string, now: Date, originalProof?: GrowthWordLanguageEvidence) {
  const exception = item.demand.historicalTimeUnknown;
  const day = item.demand.observedAt !== null && /^\d{4}-\d{2}-\d{2}$/u.test(item.demand.observedAt);
  if (day && (item.demand.timePrecision !== "day" || !item.demand.observedAtOriginal
    || item.demand.observedAtOriginal.replaceAll("/", "-") !== item.demand.observedAt || !item.demand.content.includes(item.demand.observedAtOriginal))) {
    throw new PreFreezeIdentityError("day_precision_required", "真实日精度来源须明确timePrecision=day并保留同一原始日期值及来源，不补00:00或时区", 422);
  }
  if (!day && item.demand.timePrecision === "day") throw new PreFreezeIdentityError("day_precision_mismatch", "未知时间或精确时点不能标作日精度来源", 422);
  if (item.demand.observedAt === null && (!exception || exception.selectionSourceHash !== selectionSourceHash || exception.keyword !== item.keyword
    || exception.country !== item.country || exception.language !== item.language || exception.sourceSha256 !== item.demand.sha256)) {
    throw new PreFreezeIdentityError("historical_time_exception_required", "历史指标时间未知须逐词明确确认例外，并绑定本清单、原词原国及来源SHA；不能伪造当前时间", 422);
  }
  if (item.demand.observedAt !== null && exception) throw new PreFreezeIdentityError("unexpected_time_exception", "来源已有确切时间，不应标成历史时间未知例外", 422);
  validateEvidence(item.wordLanguage, now); validateEvidence(item.demand, now, item.demand.observedAt === null && Boolean(exception));
  if (item.demand.exactKeyword !== item.keyword || item.demand.country !== item.country || item.demand.language !== item.language
    || GROWTH_MARKET_LANGUAGES[item.country] !== item.language || item.wordLanguage.language !== item.language
    || !item.demand.quote.normalize("NFKC").toLowerCase().includes(item.keyword.normalize("NFKC").toLowerCase())) {
    throw new PreFreezeIdentityError("market_evidence_mismatch", "必须是当前原词、原国家及对应当地语言的需求证据；不能借种子量或查询locale", 422);
  }
  const normalizedQuote = item.demand.quote.replace(/(?<=\d)[,\s](?=\d{3}(?:\D|$))/gu, "");
  const numbers = normalizedQuote.match(/\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
  if (!numbers.includes(item.demand.value)) throw new PreFreezeIdentityError("demand_value_missing", "同词来源摘录未包含所填需求数值，不能借用种子词或其他行的量", 422);
  const spans = item.wordLanguage.spans;
  const languageQuote = item.wordLanguage.quote.normalize("NFKC").toLowerCase();
  if (!languageQuote.includes(item.keyword.normalize("NFKC").toLowerCase())
    && !spans.every(part => languageQuote.includes(part.text.normalize("NFKC").toLowerCase()))) {
    throw new PreFreezeIdentityError("word_language_source_mismatch", "语种来源摘录须包含当前原词或全部申报原词span，不能贴另一词的证据", 422);
  }
  const baseUrl = /\bbase\s+url\b/iu.exec(item.keyword);
  const englishBaseUrl = item.country === "US" && item.language === "en" && baseUrl && /\bbase\s+url\b/iu.test(languageQuote)
    && spans.some(part => part.text.toLowerCase() === "base" && part.start === baseUrl.index && part.end === baseUrl.index + 4);
  const germanKi = item.country === "DE" && item.language === "de" && item.keyword.normalize("NFKC").trim().toLowerCase() === "ki api"
    && /\bki\b/iu.test(languageQuote) && /künstliche\s+intelligenz/iu.test(languageQuote)
    && spans.some(part => part.start === 0 && part.end === 2 && part.text.toLowerCase() === "ki");
  if (spans.some(part => part.end <= part.start || item.keyword.slice(part.start, part.end) !== part.text)
    || !englishBaseUrl && !germanKi && !spans.some(part => part.text.match(/\p{L}+/gu)?.some(token => !neutral.test(token) && (token.length >= 3 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token))))) {
    throw new PreFreezeIdentityError("neutral_word_language", "原词必须有可核实的本语言文本span；纯型号、品牌和共享缩写不能按查询语言确认", 422);
  }
  const intrinsic = reviewGrowthLanguage(item.keyword, item.country, item.language, undefined, originalProof);
  if (intrinsic.status === "mismatch") throw new PreFreezeIdentityError("word_language_conflict", "与已有明确原词语种证据冲突，不能覆盖或迁移", 409);
}
const humanProofSchema = z.object({ version: z.literal("human-word-language-v1"), actor: z.literal("human"), scope: z.literal("current-target-only"),
  auditId: id, siteDomain: z.string(), keywordId: id, keyword: z.string(), language: z.enum(GROWTH_LANGUAGES),
  reviewedAt: z.iso.datetime({ offset: true }), spans: z.array(span).min(1), sourceReference: z.string(), sourceSha256: sha,
  demandReference: z.string(), demandSha256: sha, reason: z.string().min(12) }).strict();
/** Only exact source snapshots authorized by a human audit can affect current targets. */
export function auditedHumanWordLanguages(sources: IdentitySourceRow[], audits: IdentityAudit[]): GrowthWordLanguageEvidence[] {
  const verifiedAuthority = new Map<IdentityAudit, boolean>();
  return sources.flatMap(row => {
    if (row.sourceId !== HUMAN_WORD_LANGUAGE_SOURCE_ID || preFreezeHash(row.snapshot) !== row.snapshotHash) return [];
    const parsed = humanProofSchema.safeParse(row.snapshot); if (!parsed.success) return [];
    const proof = parsed.data, audit = audits.find(item => item.id === proof.auditId && item.status === PRE_FREEZE_IDENTITY_AUDIT);
    if (!audit || row.siteDomain !== proof.siteDomain || row.rowKey !== rowKey(proof.keywordId)) return [];
    // Every source in a batch shares the same receipt. Verify it once per read.
    let authorized = verifiedAuthority.get(audit);
    if (authorized === undefined) {
      authorized = audit.authorityVerified === true || hasHumanIdentityAudit(audit);
      verifiedAuthority.set(audit, authorized);
    }
    const approved = object(audit.summary).approvedLanguageSources;
    if (!authorized || !Array.isArray(approved)
      || !approved.some(item => { const record = object(item); return record.siteDomain === row.siteDomain && record.rowKey === row.rowKey && record.snapshotHash === row.snapshotHash; })
      || proof.spans.some(part => proof.keyword.slice(part.start, part.end) !== part.text)) return [];
    return [{ site: proof.siteDomain, keywordId: proof.keywordId, keyword: proof.keyword, language: proof.language,
      source: `human-reviewed:${proof.auditId}#${proof.sourceSha256}`, scope: "current-target-only" as const,
      evidence: proof.spans.map(part => ({ text: part.text, start: part.start, end: part.end })) }];
  });
}
export function planPreFreezeIdentities(command: PreFreezeCommand, state: PreFreezeIdentityState, now = new Date()) {
  if (now.getTime() > Date.parse(GROWTH_DEADLINE_CUTOFF)) throw new PreFreezeIdentityError("quarter_closed", "本季已截止，不能事后补初始身份改变原季度验收", 409);
  const review = command.review;
  const unknownTimes = review.assignments.filter(item => item.demand.observedAt === null);
  if (command.action === "apply_identities" && unknownTimes.length && !command.historicalTimeUnknownAcknowledged) {
    throw new PreFreezeIdentityError("historical_time_ack_required", "须明确确认本批历史指标时间未知的逐词来源例外，再提交缺失身份", 422);
  }
  if (review.selectionHash !== preFreezeHash({ ...review.selection, members: [...review.selection.members].sort((a, b) => a.siteDomain.localeCompare(b.siteDomain) || a.keywordId.localeCompare(b.keywordId)) })) {
    throw new PreFreezeIdentityError("selection_changed", "确切1600原词清单SHA不匹配", 422);
  }
  const stateHash = preFreezeStateHash(state, review);
  if (command.action === "apply_identities" && command.expectedStateHash !== stateHash) throw new PreFreezeIdentityError("state_changed", "预览后原词、成员、话题、市场源或季度状态已变化；未提交", 409);
  const quarter = object(state.quarter), quarterPayload = object(quarter.payload);
  if (quarterPayload.baseline || object(quarterPayload.quarterPlanning).approval || quarter.status === "frozen") throw new PreFreezeIdentityError("baseline_frozen", "本入口仅用于首冻之前；原季度已冻结或已有批准时沿原身份补充流程", 409);
  const members = new Map(state.members.map(member => [memberKey(member.siteDomain, member.keywordId), member]));
  for (const selected of review.selection.members) {
    const member = members.get(memberKey(selected.siteDomain, selected.keywordId)), topic = state.topics.find(row => row.id === selected.topicId);
    if (!member || member.keyword.text !== selected.keyword || member.keyword.id !== selected.keywordId || !member.active || !member.keyword.active
      || !["FORMAL", "RESEARCH"].includes(member.pool) || !state.sites.some(site => site.domain === selected.siteDomain && site.active)
      || !topic?.active || isGrowthTopicPlaceholder(topic.text) || !topic.sites.some(site => site.siteDomain === selected.siteDomain)
      || member.topicId !== selected.topicId && !member.topicAssignments.some(edge => edge.topicId === selected.topicId)) {
      throw new PreFreezeIdentityError("original_identity_changed", "确切名单须全部对应本站真实启用原词及原TopicMap关系，不创建或提升成员", 422);
    }
  }
  const existingSources = new Map(state.sources.map(row => [identitySourceKey(row), row])), creates: { siteDomain: string; sourceId: string; rowKey: string; snapshot: unknown; snapshotHash: string; observedAt: Date }[] = [], results = [];
  const seen = new Set<string>(), validOldProofs = auditedHumanWordLanguages(state.sources, state.proofAudits);
  const diagnosticLanguages = approvedDiagnosticWordLanguages();
  for (const item of review.assignments) {
    const key = memberKey(item.siteDomain, item.keywordId);
    if (seen.has(key) || !review.selection.members.some(member => member.siteDomain === item.siteDomain && member.keywordId === item.keywordId && member.keyword === item.keyword && member.topicId === item.topicId)) throw new PreFreezeIdentityError("outside_selection", "每条须来自同一确切季度清单，不能重复或带入其他原词", 422);
    seen.add(key); validateLanguage(item, review.selection.sourceHash, now, diagnosticLanguages.find(proof => proof.site === item.siteDomain && proof.keywordId === item.keywordId && proof.keyword.normalize("NFKC").toLowerCase() === item.keyword.normalize("NFKC").toLowerCase()));
    const marketIdentity = { siteDomain: item.siteDomain, sourceId: MARKET_ASSIGNMENT_SOURCE_ID, rowKey: rowKey(item.keywordId) }, oldMarket = existingSources.get(identitySourceKey(marketIdentity));
    const current = readKeywordMarketAssignment(oldMarket?.snapshot);
    if (oldMarket && (!current || current.primaryCountry !== item.country || current.language !== item.language)) throw new PreFreezeIdentityError("primary_market_conflict", `${item.keyword}：原市场${current ? `${current.primaryCountry}/${current.language}` : "记录无效"}，本次${item.country}/${item.language}；409保留原值，不迁移、不覆盖、不加副国`, 409);
    if (!oldMarket) {
      const metricTime = item.demand.observedAt === null
        ? `Historical metric time unknown; historical-time-unknown explicitly acknowledged; selectionSourceHash=${review.selection.sourceHash}; sourceSha256=${item.demand.sha256}; reason=${item.demand.historicalTimeUnknown!.reason.slice(0, 300)}; reviewedAt is this human review, not metric collection. `
        : `Metric observedAt=${item.demand.observedAt}${item.demand.timePrecision === "day" ? ` (day precision; original=${item.demand.observedAtOriginal}; no clock or offset supplied)` : ""}. `;
      const snapshot = keywordMarketAssignmentSchema.parse({ primaryCountry: item.country, language: item.language, secondaryMarkets: [],
        evidence: `${metricTime}Human reviewed exact quarter word; ${item.demand.reference}#${item.demand.sha256}; ${item.wordLanguage.reference}#${item.wordLanguage.sha256}`.slice(0, 4000), reviewedAt: now.toISOString() });
      creates.push({ ...marketIdentity, snapshot, snapshotHash: preFreezeHash(snapshot), observedAt: now });
    }
    const proofIdentity = { siteDomain: item.siteDomain, sourceId: HUMAN_WORD_LANGUAGE_SOURCE_ID, rowKey: rowKey(item.keywordId) }, oldProof = existingSources.get(identitySourceKey(proofIdentity));
    if (oldProof && !validOldProofs.some(proof => proof.site === item.siteDomain && proof.keywordId === item.keywordId && proof.keyword === item.keyword && proof.language === item.language)) throw new PreFreezeIdentityError("language_review_conflict", "已有词语种审核无效或冲突，保留原值，不覆盖", 409);
    if (!oldProof) {
      const snapshot = humanProofSchema.parse({ version: "human-word-language-v1", actor: "human", scope: "current-target-only", auditId: identityAuditId(command.requestId),
        siteDomain: item.siteDomain, keywordId: item.keywordId, keyword: item.keyword, language: item.language, reviewedAt: now.toISOString(), spans: item.wordLanguage.spans,
        sourceReference: item.wordLanguage.reference, sourceSha256: item.wordLanguage.sha256, demandReference: item.demand.reference, demandSha256: item.demand.sha256, reason: item.wordLanguage.reason });
      creates.push({ ...proofIdentity, snapshot, snapshotHash: preFreezeHash(snapshot), observedAt: now });
    }
    results.push({ siteDomain: item.siteDomain, keywordId: item.keywordId, keyword: item.keyword, topicId: item.topicId, country: item.country, language: item.language,
      demandObservedAt: item.demand.observedAt, demandTimePrecision: item.demand.timePrecision ?? (item.demand.observedAt === null ? "unknown" : "instant"), demandObservedAtOriginal: item.demand.observedAtOriginal ?? null,
      historicalTimeUnknown: item.demand.historicalTimeUnknown ?? null,
      previousCountry: current?.primaryCountry ?? null, previousLanguage: current?.language ?? null,
      market: oldMarket ? "reuse" as const : "create" as const, languageReview: oldProof ? "reuse" as const : "create" as const,
      targetIdAfter: growthTargetId(item.siteDomain, item.keyword, item.country, item.language) });
  }
  return { stateHash, reviewHash: preFreezeHash(review), creates, results, selection: review.selection,
    historicalTimeUnknown: unknownTimes.map(item => ({ siteDomain: item.siteDomain, keywordId: item.keywordId, reference: item.demand.reference, observedAt: null, ...item.demand.historicalTimeUnknown! })) };
}
