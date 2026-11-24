import { createHash } from "node:crypto";
import { z } from "zod";
import type { GrowthTarget, GrowthWorkspace } from "./growth-types";
import { growthExactTrafficSchema, growthTrafficHasCompleteHostScope, type GrowthExactTrafficEvidence } from "./growth-exact-traffic";
import { growthObservationComparisonInputSchema, growthObservationComparisonStoredSchema, prepareGrowthObservationComparison, type GrowthObservationComparison } from "./growth-observation-comparison";
import { growthObservationComparisonText } from "./growth-observation-display";
import { GROWTH_MARKET_LANGUAGES } from "./seo-growth-markets";
import { quarterPlanningInputSchema, quarterPlanningStoredSchema } from "./growth-quarter-planning";

export const GROWTH_STRATEGY_KIND = "growth-strategy";
export const GROWTH_QUARTER_ID = "2026-close";
export const GROWTH_DEADLINE_CUTOFF = "2027-02-05T15:59:59.999Z";
export const GROWTH_FINAL_TRAFFIC_PERIOD = { start: "2027-01-28", end: "2027-02-03" } as const;
export const GROWTH_TRAFFIC_SITES = ["flatkey.ai"] as const;
export const GROWTH_TRAFFIC_SCOPE = { version: "flatkey-only-v3", sites: ["flatkey.ai"], label: "Flatkey 单站完整周自然会话", goal: 3000 } as const;
export const GROWTH_EXECUTION_SITES = ["flatkey.ai", "rackrate.org", "modelfit.cc"] as const;
const id = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(3000);
const stamp = z.iso.datetime({ offset: true });
const evidence = z.array(z.object({ source: z.enum(["GA4", "GSC", "SERP", "publication", "competitor", "demand", "manual"]), reference: text, observedAt: stamp, supports: text }).strict()).min(1).max(30);
const scopeSchema = z.object({ site: z.enum(GROWTH_EXECUTION_SITES), topicId: id, country: z.string().min(2).max(10), language: z.string().min(2).max(20), kinds: z.array(z.enum(["blog", "optimization", "cluster_landing", "research", "review"])).min(1).max(5), maxTasks: z.number().int().min(1).max(100), validUntil: stamp }).strict();
const driverSchema = z.object({ title: z.string().min(1).max(500), url: z.url().startsWith("https://"), topicId: id.nullable(), module: z.string().max(100), country: z.string().min(2).max(10), language: z.string().min(2).max(20), source: z.enum(["GA4", "GSC"]), metric: z.enum(["sessions", "clicks", "impressions"]), previous: z.number().nonnegative(), current: z.number().nonnegative(), window: z.object({ start: z.iso.date(), end: z.iso.date(), previousStart: z.iso.date(), previousEnd: z.iso.date(), timezone: z.string().min(1) }).strict(), publicationIds: z.array(id).max(30), taskIds: z.array(id).max(30), explanation: text, limitation: text, nextAction: text }).strict();
export type GrowthDriver = z.infer<typeof driverSchema>;
export const growthDirectionSchema = z.object({
  id, title: z.string().min(1).max(200), hypothesis: text, rationale: text, counterEvidence: text,
  competitiveGap: text, ownAdvantage: text, proposedAction: text, investment: text, expiresAt: stamp,
  scope: z.array(scopeSchema).min(1).max(20), evidence, drivers: z.array(driverSchema).max(10),
  taskIds: z.array(id).max(100), experimentId: id,
  experiment: z.object({ baseline: text, comparison: text, primaryMetric: text, businessGuardrail: text, successCondition: text, adjustmentCondition: text, reviewAt: stamp }).strict(),
}).strict();
export type GrowthDirectionInput = z.infer<typeof growthDirectionSchema>;
export type GrowthDecision = { decision: "approve" | "hold" | "reject"; reason: string; decidedAt: string; actor: "human"; revision: number; scope: GrowthDirectionInput["scope"] };
export type GrowthDirection = GrowthDirectionInput & { revision: number; preparedBy: "human" | "collector"; updatedAt: string; decisions: GrowthDecision[]; decision: GrowthDecision | null };
export type GrowthBaselineTarget = Pick<GrowthTarget, "id" | "keywordId" | "site" | "topicId" | "keyword" | "country" | "language" | "publishedUrls" | "plannedUrls"> & { pageState?: GrowthTarget["pageState"]; reason?: string; languageStatus?: GrowthTarget["languageStatus"] };
export type GrowthIdentityRevision = { revision: number; approvedAt: string; actor: "human"; sourceVersion: string; reason: string; mappings: { targetId: string; country: string; language: string }[] };
export type GrowthBatch = { id: string; admittedAt: string; deadline: string; targets: GrowthBaselineTarget[]; actor: "human" | "collector"; reason: string };
export type GrowthObservation = {
  id: string; publicationId: string; taskId: string; site: string; pageUrl: string; contentVersion: string;
  publishedAt: string; checkpoint: 7 | 14 | 28 | 56; checkedAt: string; timezone: string;
  windowStart: string; windowEnd: string; indexing: "indexed" | "not_indexed" | "unknown";
  rank: number | null; sessions: number | null; evidence: z.infer<typeof evidence>; conclusion: string; nextAction: string;
  windowSource?: "GA4" | "GSC"; indexingEvidence?: { source: "GSC"; reference: string; checkedAt: string; url: string };
  rankingEvidence?: { source: "SERP"; targetId: string; checkedAt: string; reference: string };
  trafficEvidence?: { source: "GA4"; propertyId: string; sourceTimezone: string; start: string; end: string; reference: string; complete: true };
  coverage?: { indexing: "verified" | "missing"; ranking: "verified" | "missing"; traffic: "verified" | "missing" };
  comparison?: GrowthObservationComparison;
};
const observationSchema = z.object({ id, publicationId: id, taskId: id, site: z.enum(GROWTH_EXECUTION_SITES), pageUrl: z.url().startsWith("https://"), contentVersion: id,
  publishedAt: stamp, checkpoint: z.union([z.literal(7), z.literal(14), z.literal(28), z.literal(56)]), checkedAt: stamp, timezone: z.string().min(1),
  windowStart: z.iso.date(), windowEnd: z.iso.date(), windowSource: z.enum(["GA4", "GSC"]).optional(), indexing: z.enum(["indexed", "not_indexed", "unknown"]), rank: z.number().int().min(1).max(100).nullable(), sessions: z.number().int().nonnegative().nullable(), evidence, conclusion: text, nextAction: text,
  indexingEvidence: z.object({ source: z.literal("GSC"), reference: text, checkedAt: stamp, url: z.url().startsWith("https://") }).strict().optional(),
  rankingEvidence: z.object({ source: z.literal("SERP"), targetId: id, checkedAt: stamp, reference: text }).strict().optional(),
  trafficEvidence: z.object({ source: z.literal("GA4"), propertyId: z.string().regex(/^\d+$/), sourceTimezone: z.string().min(1), start: z.iso.date(), end: z.iso.date(), reference: text, complete: z.literal(true) }).strict().optional(),
}).strict();
const storedObservationSchema = observationSchema.extend({ coverage: z.object({ indexing: z.enum(["verified", "missing"]), ranking: z.enum(["verified", "missing"]), traffic: z.enum(["verified", "missing"]) }).strict().optional(), comparison: growthObservationComparisonStoredSchema.optional() });
const newObservationSchema = observationSchema.extend({ comparison: growthObservationComparisonInputSchema });
export type GrowthStrategy = {
  id: typeof GROWTH_QUARTER_ID; version: number; updatedAt: string | null;
  deadline: "2027-02-05"; coverageGoal: 0.6; qualityGoal: 0.8; weeklySessionsGoal: 3000;
  baseline: { frozenAt: string; actor: "human"; sourceVersion: string; targets: GrowthBaselineTarget[]; reason: string } | null;
  batches: GrowthBatch[]; directions: GrowthDirection[]; observations: GrowthObservation[]; trafficEvidence: GrowthExactTrafficEvidence[];
  /** Baseline IDs/members stay immutable; explicitly approved scope supplements are append-only. */
  identityRevisions: GrowthIdentityRevision[];
  quarterPlanning?: z.infer<typeof quarterPlanningStoredSchema> | null;
  quarterPlanningHistory?: z.infer<typeof quarterPlanningStoredSchema>[];
};
const decisionSchema = z.object({ decision: z.enum(["approve", "hold", "reject"]), reason: text, decidedAt: stamp, actor: z.literal("human"), revision: z.number().int().positive(), scope: z.array(scopeSchema).min(1) }).strict();
const baselineTargetSchema = z.object({ id, keywordId: id.nullable(), site: z.enum(GROWTH_EXECUTION_SITES), topicId: id, keyword: z.string().min(1), country: z.string().min(2).nullable(), language: z.string().min(2).nullable(), publishedUrls: z.array(z.url()), plannedUrls: z.array(z.url()), pageState: z.enum(["published", "planned", "unmapped"]).optional(), reason: z.string().optional(), languageStatus: z.enum(["match", "mismatch", "unknown"]).optional() }).strict();
const identityMappingSchema = z.object({ targetId: id, country: z.string().min(2).max(10), language: z.string().min(2).max(20) }).strict();
export const growthStrategyStoredSchema = z.object({
  id: z.literal(GROWTH_QUARTER_ID), version: z.number().int().nonnegative(), updatedAt: stamp.nullable(), deadline: z.literal("2027-02-05"), coverageGoal: z.literal(0.6), qualityGoal: z.literal(0.8), weeklySessionsGoal: z.literal(3000),
  baseline: z.object({ frozenAt: stamp, actor: z.literal("human"), sourceVersion: id, targets: z.array(baselineTargetSchema).min(1), reason: text }).strict().nullable(),
  batches: z.array(z.object({ id, admittedAt: stamp, deadline: z.iso.date(), targets: z.array(baselineTargetSchema).min(1), actor: z.enum(["human", "collector"]), reason: text }).strict()),
  directions: z.array(growthDirectionSchema.extend({ revision: z.number().int().positive(), preparedBy: z.enum(["human", "collector"]), updatedAt: stamp, decisions: z.array(decisionSchema), decision: decisionSchema.nullable() }).strict()),
  observations: z.array(storedObservationSchema),
  trafficEvidence: z.array(growthExactTrafficSchema).default([]),
  quarterPlanning: quarterPlanningStoredSchema.nullable().optional(),
  quarterPlanningHistory: z.array(quarterPlanningStoredSchema).optional(),
  identityRevisions: z.array(z.object({ revision: z.number().int().positive(), approvedAt: stamp, actor: z.literal("human"), sourceVersion: id, reason: text, mappings: z.array(identityMappingSchema).min(1) }).strict()).default([]),
}).strict();
export const emptyGrowthStrategy = (): GrowthStrategy => ({ id: GROWTH_QUARTER_ID, version: 0, updatedAt: null, deadline: "2027-02-05", coverageGoal: 0.6, qualityGoal: 0.8, weeklySessionsGoal: 3000, baseline: null, batches: [], directions: [], observations: [], trafficEvidence: [], identityRevisions: [] });
const commandBase = { requestId: z.string().regex(/^[a-zA-Z0-9:_-]{8,200}$/), expectedVersion: z.number().int().nonnegative() };
export const growthStrategyCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...commandBase, action: z.literal("save_quarter_plan"), plan: quarterPlanningInputSchema }).strict(),
  z.object({ ...commandBase, action: z.literal("approve_quarter_plan"), hash: z.string().regex(/^[a-f0-9]{64}$/), sourceVersion: id, reason: text }).strict(),
  z.object({ ...commandBase, action: z.literal("save_direction"), direction: growthDirectionSchema }).strict(),
  z.object({ ...commandBase, action: z.literal("decide_direction"), directionId: id, revision: z.number().int().positive(), decision: z.enum(["approve", "hold", "reject"]), reason: text }).strict(),
  z.object({ ...commandBase, action: z.literal("freeze_baseline"), targetIds: z.array(id).min(1).max(20000), sourceVersion: id, reason: text }).strict(),
  z.object({ ...commandBase, action: z.literal("resolve_baseline_identities"), mappings: z.array(identityMappingSchema).min(1).max(20000), sourceVersion: id, reason: text }).strict(),
  z.object({ ...commandBase, action: z.literal("admit_batch"), batchId: id, targetIds: z.array(id).min(1).max(5000), deadline: z.iso.date(), reason: text }).strict(),
  z.object({ ...commandBase, action: z.literal("record_observation"), observation: newObservationSchema }).strict(),
  z.object({ ...commandBase, action: z.literal("record_traffic"), evidence: growthExactTrafficSchema }).strict(),
]);
export type GrowthStrategyCommand = z.infer<typeof growthStrategyCommandSchema>;
export class GrowthStrategyError extends Error { constructor(public code: string, message: string, public status = 409) { super(message); } }
export function growthHash(value: unknown) {
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)])) : value;
  return createHash("sha256").update(JSON.stringify(ordered(value ?? null))).digest("hex");
}
export function growthWorkspaceIdentity(workspace: GrowthWorkspace) {
  return growthHash(workspace.targets.filter(t => t.membership === "formal").map(t => [t.id, t.keywordId, t.site, t.topicId, t.keyword, t.country, t.language, t.wordLanguage ?? null, t.languageStatus, t.publishedUrls, t.plannedUrls]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
function freezeTarget(target: GrowthTarget): GrowthBaselineTarget {
  return { id: target.id, keywordId: target.keywordId, site: target.site, topicId: target.topicId, keyword: target.keyword, country: target.country, language: target.language, publishedUrls: [...target.publishedUrls], plannedUrls: [...target.plannedUrls], pageState: target.pageState, reason: target.reason, languageStatus: target.languageStatus };
}
function resolveTargets(ids: string[], workspace: GrowthWorkspace, requireIdentity = true): GrowthBaselineTarget[] {
  if (new Set(ids).size !== ids.length) throw new GrowthStrategyError("duplicate_target", "目标身份不可重复");
  return ids.map(targetId => {
    const target = workspace.targets.find(row => row.id === targetId);
    if (!target || target.membership !== "formal" || !GROWTH_EXECUTION_SITES.some(site => site === target.site) || !target.topicId || !workspace.topics.some(topic => topic.site === target.site && topic.topicId === target.topicId) || requireIdentity && (!target.country || !target.language || target.languageStatus !== "match")) throw new GrowthStrategyError("ineligible_target", `目标 ${targetId} 的正式话题或国家语言尚未核定`);
    return freezeTarget(target);
  });
}
const originalWord = (word: string) => word.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const wordIndexKey = (site: string, word: string) => `${site}\u0000${originalWord(word)}`;
function indexGrowthWords(rows: GrowthTarget[]) {
  const index = new Map<string, GrowthTarget[]>();
  for (const row of rows) { const key = wordIndexKey(row.site, row.keyword); const values = index.get(key) ?? []; values.push(row); index.set(key, values); }
  return index;
}
function sameSourceWord(frozen: GrowthBaselineTarget, current: GrowthTarget) {
  return frozen.site === current.site && originalWord(frozen.keyword) === originalWord(current.keyword) && (frozen.keywordId ? current.keywordId === frozen.keywordId || Boolean(current.aliasKeywordIds?.includes(frozen.keywordId)) : current.id === frozen.id);
}
const samePlanningWord = (frozen: GrowthBaselineTarget, current: GrowthTarget) => sameSourceWord(frozen, current) && frozen.topicId === current.topicId;
export function growthResolvedIdentity(state: GrowthStrategy, target: GrowthBaselineTarget, asOf = new Date()): { country: string | null; language: string | null; revision: number } {
  const mapped = [...(state.identityRevisions ?? [])].filter(row => Date.parse(row.approvedAt) <= asOf.getTime()).sort((a, b) => b.revision - a.revision).find(row => row.mappings.some(item => item.targetId === target.id));
  const scope = mapped?.mappings.find(item => item.targetId === target.id);
  return scope ? { country: scope.country, language: scope.language, revision: mapped!.revision } : { country: target.country, language: target.language, revision: 0 };
}
export type GrowthBaselineIdentityReview = { targetId: string; site: string; keyword: string; country: string | null; language: string | null; wordLanguage: string | null; revision: number; confirmed: boolean; canSupplement: boolean };
export function growthBaselineIdentityReview(state: GrowthStrategy, workspace: GrowthWorkspace, now = new Date()): GrowthBaselineIdentityReview[] {
  const index = indexGrowthWords(workspace.targets.filter(row => row.membership === "formal"));
  return (state.baseline?.targets ?? []).map(target => {
    const scope = growthResolvedIdentity(state, target, now), current = index.get(wordIndexKey(target.site, target.keyword))?.find(row => samePlanningWord(target, row));
    const wordLanguage = current?.wordLanguage ?? (current?.languageStatus === "match" ? current.language : null);
    const confirmed = Boolean(scope.country && scope.language && (scope.revision > 0 || target.languageStatus === "match" || target.languageStatus === undefined || current?.country === scope.country && current?.language === scope.language && current?.languageStatus === "match"));
    return { targetId: target.id, site: target.site, keyword: target.keyword, ...scope, wordLanguage, confirmed, canSupplement: Boolean((!scope.country || !scope.language) && wordLanguage) };
  });
}
export type GrowthPublicationReference = { id: string; taskId: string; siteDomain: string; pageUrl: string; contentVersion: string; publishedAt: string; status: string; kind: string; country?: string | null; language?: string; keyword?: string | null };
export type GrowthTaskReference = { id: string; siteDomain: string; pageUrl: string | null; keyword: string | null; keywordId?: string | null; country: string | null; language: string | null; deletedAt?: string | null };
export function growthBatchDeadline(admittedAt: Date): string {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(admittedAt);
  const [year, month, day] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month + 3, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + 3, Math.min(day, lastDay))).toISOString().slice(0, 10);
}
export type GrowthMutationContext = { routineApprovedTargetIds?: string[]; taskReferences?: GrowthTaskReference[]; siteTimezones?: Record<string, string | null>; siteProperties?: Record<string, string | null> };
export function prepareGrowthStrategyMutation(state: GrowthStrategy, raw: unknown, actor: "human" | "collector", workspace: GrowthWorkspace, publications: GrowthPublicationReference[], taskIds: string[], now = new Date(), context: GrowthMutationContext = {}): GrowthStrategy {
  const command = growthStrategyCommandSchema.parse(raw);
  if (command.expectedVersion !== state.version) throw new GrowthStrategyError("version_conflict", "方向与目标已更新，请刷新后重试");
  const next: GrowthStrategy = structuredClone(state);
  next.identityRevisions ??= [];
  if (["decide_direction", "freeze_baseline", "resolve_baseline_identities", "approve_quarter_plan"].includes(command.action) && actor !== "human") throw new GrowthStrategyError("human_required", "方向决定、季度清单与身份补充须由已登录用户确认", 403);
  if (command.action === "save_quarter_plan") {
    const plan = command.plan;
    if (plan.sourceVersion !== growthWorkspaceIdentity(workspace)) throw new GrowthStrategyError("source_changed", "季度方案需绑定完整当前候选底账");
    const formal = state.baseline ? state.baseline.targets.map(row => row.id).sort() : workspace.targets.filter(row => row.membership === "formal").map(row => row.id).sort();
    if (!state.baseline && plan.targetUnit === "normalized_original_word") {
      const selected = workspace.targets.filter(row => plan.targetIds.includes(row.id));
      const words = new Set(selected.map(row => originalWord(row.keyword)));
      const formalWords = new Set(workspace.targets.filter(row => row.membership === "formal").map(row => originalWord(row.keyword)));
      if (selected.length !== 1600 || words.size !== 1600 || selected.some(row => row.membership !== "formal" || !row.topicId)
        || plan.version === "quarter-planning-v1" && (words.size !== formalWords.size || [...formalWords].some(word => !words.has(word)))) throw new GrowthStrategyError("quarter_inventory_incomplete", "季度清单须是实际TopicMap正式词中的1600个唯一原词；历史未入选词及跨站别名保留，不重复计数");
    } else if (JSON.stringify([...plan.targetIds].sort()) !== JSON.stringify(formal)) throw new GrowthStrategyError("quarter_inventory_incomplete", "季度方案保留完整底账；不能因没有排名而移出成员");
    for (const stream of plan.workstreams) {
      if (stream.topicIds.some(topicId => !workspace.topics.some(topic => topic.topicId === topicId)) || stream.taskIds.some(id => !taskIds.includes(id))) throw new GrowthStrategyError("quarter_reference_missing", "方向须关联真实本站话题和原任务");
    }
    if (plan.reservedOriginalTaskIds.some(id => !taskIds.includes(id))) throw new GrowthStrategyError("quarter_reference_missing", "原保留任务须来自真实工作台");
    if (now.getTime() > Date.parse(GROWTH_DEADLINE_CUTOFF)) throw new GrowthStrategyError("quarter_closed", "本季已截止，不再变更季度执行方案");
    if (state.quarterPlanning?.approval) next.quarterPlanningHistory = [...(state.quarterPlanningHistory ?? []).filter(plan => plan.hash !== state.quarterPlanning!.hash), structuredClone(state.quarterPlanning)];
    next.quarterPlanning = { revision: (state.quarterPlanning?.revision ?? 0) + 1, plan, hash: growthHash(plan), submittedAt: now.toISOString(), approval: null };
  } else if (command.action === "approve_quarter_plan") {
    const draft = state.quarterPlanning;
    if (!draft || draft.hash !== command.hash || growthHash(draft.plan) !== command.hash || command.sourceVersion !== draft.plan.sourceVersion || command.sourceVersion !== growthWorkspaceIdentity(workspace)) throw new GrowthStrategyError("quarter_plan_changed", "须审阅当前确切季度方案，源或方案已变化时重审");
    if (draft.plan.version === "quarter-planning-v2" && !state.baseline) resolveTargets(draft.plan.targetIds, workspace, true);
    if (now.getTime() > Date.parse(GROWTH_DEADLINE_CUTOFF)) throw new GrowthStrategyError("quarter_closed", "本季已截止，不能事后批准新方案");
    next.quarterPlanning = { ...draft, approval: { actor: "human", approvedAt: now.toISOString(), hash: command.hash, reason: command.reason } };
    if (!state.baseline) next.baseline = { frozenAt: now.toISOString(), actor: "human", sourceVersion: command.sourceVersion, targets: resolveTargets(draft.plan.targetIds, workspace, false), reason: command.reason };
  } else if (command.action === "freeze_baseline") {
    if (now.getTime() > Date.parse(GROWTH_DEADLINE_CUTOFF)) throw new GrowthStrategyError("quarter_closed", "本季已截止，不能事后冻结新的有利分母冒充原季度目标");
    if (state.baseline) throw new GrowthStrategyError("baseline_frozen", "季度基线已冻结；新词请进入新增批次");
    if (now >= new Date("2026-11-24T04:00:00Z")) throw new GrowthStrategyError("quarter_plan_required", "先审阅完整季度方向、市场研究预算及实际投入方案，再一次确认并冻结；词库汇总不等于季度规划");
    if (command.sourceVersion !== growthWorkspaceIdentity(workspace)) throw new GrowthStrategyError("source_changed", "词库身份已变化，请重新核对完整清单");
    const formalIds = workspace.targets.filter(t => t.membership === "formal" && GROWTH_EXECUTION_SITES.some(site => site === t.site)).map(t => t.id).sort();
    if (JSON.stringify([...command.targetIds].sort()) !== JSON.stringify(formalIds)) throw new GrowthStrategyError("baseline_incomplete", "冻结须覆盖全部正式目标；不能移出未获排名词缩小分母");
    next.baseline = { frozenAt: now.toISOString(), actor: "human", sourceVersion: command.sourceVersion, targets: resolveTargets(command.targetIds, workspace, false), reason: command.reason };
  } else if (command.action === "resolve_baseline_identities") {
    if (!state.baseline) throw new GrowthStrategyError("baseline_required", "先由用户核定稳定季度清单，再补足目标身份");
    if (now.getTime() > Date.parse(GROWTH_DEADLINE_CUTOFF)) throw new GrowthStrategyError("quarter_closed", "本季已截止，不能事后补身份改变原季度验收");
    if (command.sourceVersion !== growthWorkspaceIdentity(workspace)) throw new GrowthStrategyError("source_changed", "词库身份已变化，请重新核对确切身份补充清单");
    if (new Set(command.mappings.map(row => row.targetId)).size !== command.mappings.length) throw new GrowthStrategyError("duplicate_target", "同一稳定季度目标不可重复补身份");
    const resolved = new Map(state.baseline.targets.map(target => [target.id, growthResolvedIdentity(state, target, now)]));
    const index = indexGrowthWords(workspace.targets.filter(row => row.membership === "formal"));
    for (const mapping of command.mappings) {
      const target = state.baseline.targets.find(row => row.id === mapping.targetId);
      if (!target) throw new GrowthStrategyError("identity_outside_baseline", "身份补充只能对应原冻结目标，新增词须另入批次");
      const prior = resolved.get(target.id)!;
      if (prior.country && prior.language) throw new GrowthStrategyError("identity_already_confirmed", "原已核身份不可在补充入口换国；需另审目标版本");
      if (target.country && target.country !== mapping.country || target.language && target.language !== mapping.language) throw new GrowthStrategyError("original_scope_changed", "不能覆盖原来已明确的国家或语言");
      const expected = GROWTH_MARKET_LANGUAGES[mapping.country as keyof typeof GROWTH_MARKET_LANGUAGES];
      const native = index.get(wordIndexKey(target.site, target.keyword))?.some(current => samePlanningWord(target, current) && (current.wordLanguage ? current.wordLanguage === mapping.language : current.country === mapping.country && current.language === mapping.language && current.languageStatus === "match"));
      if (expected !== mapping.language || !native) throw new GrowthStrategyError("identity_language_pending", "须保留原词库身份并有明确原词语种证据；页面或诊断locale不能赋语种");
      resolved.set(target.id, { country: mapping.country, language: mapping.language, revision: (state.identityRevisions ?? []).length + 1 });
    }
    const keys = state.baseline.targets.map(target => { const scope = resolved.get(target.id)!; return growthHash([target.site, originalWord(target.keyword), scope.country, scope.language]); });
    if (new Set(keys).size !== keys.length) throw new GrowthStrategyError("duplicate_baseline_identity", "补身份会与原目标重复，须先审明确目标版本，不能暗缩或扩分母");
    next.identityRevisions.push({ revision: (state.identityRevisions ?? []).length + 1, approvedAt: now.toISOString(), actor: "human", sourceVersion: command.sourceVersion, reason: command.reason, mappings: structuredClone(command.mappings) });
  } else if (command.action === "admit_batch") {
    if (!state.baseline) throw new GrowthStrategyError("baseline_required", "先核定季度基线，再接纳增量批次");
    if (next.batches.some(batch => batch.id === command.batchId)) throw new GrowthStrategyError("batch_exists", "该批次已存在，不能重写首次接纳记录");
    const admitted = new Set([...state.baseline.targets, ...state.batches.flatMap(batch => batch.targets)].map(t => t.id));
    const duplicatesOriginalMember = (current: GrowthTarget) => state.baseline!.targets.some(target => {
      if (!samePlanningWord(target, current)) return false;
      const scope = growthResolvedIdentity(state, target, now);
      return !scope.country || !scope.language || scope.country === current.country && scope.language === current.language;
    });
    if (command.targetIds.some(targetId => admitted.has(targetId) || workspace.targets.some(current => current.id === targetId && duplicatesOriginalMember(current)))) throw new GrowthStrategyError("already_admitted", "已有目标或身份补充不能重复计入新批次");
    if (command.deadline !== growthBatchDeadline(now)) throw new GrowthStrategyError("invalid_deadline", "新批次须按北京时间首次接纳日独立计算三个月，不改变季度截止日");
    const targets = resolveTargets(command.targetIds, workspace);
    if (actor === "collector") for (const target of targets) {
      const routine = context.routineApprovedTargetIds?.includes(target.id);
      const approvedDirection = state.directions.some(direction => direction.decision?.actor === "human" && direction.decision.decision === "approve" && direction.decision.revision === direction.revision && Date.parse(direction.expiresAt) > now.getTime() && direction.decision.scope.some(scope => scope.site === target.site && scope.topicId === target.topicId && scope.country === target.country && scope.language === target.language && Date.parse(scope.validUntil) > now.getTime()));
      if (!routine && !approvedDirection) throw new GrowthStrategyError("batch_scope_pending", `目标 ${target.id} 尚无已批准方向或原正式任务范围；先提交完整机会卡待审`, 403);
    }
    next.batches.push({ id: command.batchId, admittedAt: now.toISOString(), actor, targets, deadline: command.deadline, reason: command.reason });
  } else if (command.action === "save_direction") {
    const card = command.direction;
    if (card.taskIds.some(taskId => !taskIds.includes(taskId))) throw new GrowthStrategyError("task_missing", "方向卡须关联真实原任务");
    if (Date.parse(card.expiresAt) <= now.getTime() || card.scope.some(scope => Date.parse(scope.validUntil) <= now.getTime() || GROWTH_MARKET_LANGUAGES[scope.country as keyof typeof GROWTH_MARKET_LANGUAGES] !== scope.language || !workspace.topics.some(topic => topic.topicId === scope.topicId && topic.site === scope.site))) throw new GrowthStrategyError("invalid_scope", "方向范围须对应真实站点话题、匹配的国家语种并保留有效期限");
    for (const driver of card.drivers) {
      if (driver.taskIds.some(taskId => !taskIds.includes(taskId)) || driver.publicationIds.some(publicationId => !publications.some(p => p.id === publicationId && p.pageUrl === driver.url))) throw new GrowthStrategyError("driver_reference_missing", "涨跌分析须关联真实页面和原任务回执");
      if (driver.current === driver.previous) throw new GrowthStrategyError("no_change", "涨跌贡献不能使用持平页面");
    }
    const current = next.directions.find(direction => direction.id === card.id);
    const direction: GrowthDirection = { ...card, revision: (current?.revision ?? 0) + 1, preparedBy: actor, updatedAt: now.toISOString(), decisions: current?.decisions ?? [], decision: null };
    next.directions = [...next.directions.filter(d => d.id !== card.id), direction];
  } else if (command.action === "decide_direction") {
    const direction = next.directions.find(d => d.id === command.directionId);
    if (!direction || direction.revision !== command.revision) throw new GrowthStrategyError("direction_changed", "方向方案已变化，请审阅当前版本");
    if (Date.parse(direction.expiresAt) <= now.getTime()) throw new GrowthStrategyError("direction_expired", "机会已过期，需要重新核验");
    const decision: GrowthDecision = { decision: command.decision, reason: command.reason, decidedAt: now.toISOString(), actor: "human", revision: direction.revision, scope: structuredClone(direction.scope) };
    direction.decision = decision; direction.decisions.push(decision);
  } else if (command.action === "record_traffic") {
    const row = command.evidence;
    if (!growthTrafficHasCompleteHostScope(row)) throw new GrowthStrategyError("traffic_host_scope_incomplete", "Flatkey目标须包含官网与控制台的完整生产主机范围；窄范围旧证据不能代替全目标");
    if (context.siteProperties?.[row.site] !== row.propertyId || Date.parse(row.observedAt) > now.getTime()) throw new GrowthStrategyError("traffic_property_mismatch", "会话证据须对应已登记真实GA4属性及实际采集时刻");
    const original = next.trafficEvidence.find(item => item.id === row.id);
    if (original && growthHash(original) !== growthHash(row)) throw new GrowthStrategyError("traffic_immutable", "原会话证据不可覆盖；更正须保存新ID并保留旧版本");
    if (!original) next.trafficEvidence.push(row);
  } else {
    const observation = command.observation;
    const publication = publications.find(p => p.id === observation.publicationId);
    if (!publication || publication.status !== "verified" || publication.taskId !== observation.taskId || !taskIds.includes(observation.taskId) || publication.siteDomain !== observation.site || publication.pageUrl !== observation.pageUrl || publication.contentVersion !== observation.contentVersion || publication.publishedAt !== observation.publishedAt || !["source_blog", "translation", "backfill_translation", "landing", "cluster", "optimization"].includes(publication.kind)) throw new GrowthStrategyError("publication_mismatch", "效果复查须绑定已验收原任务、实际页面和内容版本");
    if (observation.checkpoint === 56 && !state.observations.some(row => row.id === observation.id && row.checkpoint === 56)) throw new GrowthStrategyError("legacy_window_only", "新效果复查使用7/14/28天；历史56天记录只保留");
    const sourceTimezone = observation.windowSource === "GSC" ? "America/Los_Angeles" : context.siteTimezones?.[publication.siteDomain] ?? (publication.siteDomain === "flatkey.ai" ? "America/Los_Angeles" : null);
    if (!sourceTimezone || observation.timezone !== sourceTimezone) throw new GrowthStrategyError("source_timezone_unknown", "观察窗口须遵循真实来源属性时区；时区未核定时保留待补");
    const publishedDay = new Intl.DateTimeFormat("en-CA", { timeZone: sourceTimezone }).format(new Date(observation.publishedAt));
    const windowStart = new Date(Date.parse(publishedDay + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
    const dueDay = new Date(Date.parse(publishedDay + "T00:00:00Z") + observation.checkpoint * 86400000).toISOString().slice(0, 10);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: observation.timezone }).format(now);
    if (observation.windowStart !== windowStart || observation.windowEnd !== dueDay || observation.windowEnd >= today || Date.parse(observation.checkedAt) > now.getTime()) throw new GrowthStrategyError("window_not_closed", "效果窗口须为上线后首个完整日起连续7/14/28天，尚未完整结束或日期不符时保留待补");
    if (observation.indexing !== "unknown" && (!observation.indexingEvidence || observation.indexingEvidence.url !== publication.pageUrl || Date.parse(observation.indexingEvidence.checkedAt) > now.getTime() || Date.parse(observation.indexingEvidence.checkedAt) < Date.parse(publication.publishedAt))) throw new GrowthStrategyError("indexing_evidence_missing", "收录判断须有该原页面的独立GSC证据");
    const rankedTarget = observation.rankingEvidence ? workspace.targets.find(target => target.id === observation.rankingEvidence!.targetId) : null;
    if (observation.rank !== null || observation.rankingEvidence) {
      const originalTask = context.taskReferences?.find(task => task.id === publication.taskId && !task.deletedAt);
      const word = (value: string | null | undefined) => value?.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase() ?? "";
      const sampledAt = Date.parse(observation.rankingEvidence?.checkedAt ?? "");
      const identityMatches = Boolean(originalTask && word(publication.keyword) && word(originalTask.keyword) === word(publication.keyword)
        && originalTask.siteDomain === publication.siteDomain && originalTask.pageUrl === publication.pageUrl
        && originalTask.country === publication.country && originalTask.language === publication.language
        && rankedTarget?.taskIds.includes(publication.taskId) && word(rankedTarget.keyword) === word(publication.keyword)
        && (!originalTask.keywordId || originalTask.keywordId === rankedTarget.keywordId));
      if (!observation.rankingEvidence || !rankedTarget?.observationEligible || rankedTarget.rankSource !== "serp" || rankedTarget.languageStatus !== "match"
        || !identityMatches || rankedTarget.site !== publication.siteDomain || rankedTarget.country !== publication.country || rankedTarget.language !== publication.language
        || rankedTarget.checkedAt !== observation.rankingEvidence.checkedAt || rankedTarget.rank !== observation.rank || !rankedTarget.publishedUrls.includes(publication.pageUrl)
        || observation.rank !== null && rankedTarget.rankUrl !== publication.pageUrl
        || !Number.isFinite(sampledAt) || sampledAt < Date.parse(publication.publishedAt) || sampledAt > Date.parse(observation.checkedAt)) {
        throw new GrowthStrategyError("ranking_evidence_missing", "排名判断须绑定原任务、原词、原市场语言及该页面的真实SERP；采样不得早于实际发布或晚于本次检查。缺身份或合格采样时保留排名待补，不能借用同页其他词或GSC平均位置");
      }
    }
    if (observation.sessions !== null && (!observation.trafficEvidence || observation.trafficEvidence.propertyId !== context.siteProperties?.[publication.siteDomain] || observation.trafficEvidence.sourceTimezone !== sourceTimezone || observation.trafficEvidence.sourceTimezone !== context.siteTimezones?.[publication.siteDomain] || observation.trafficEvidence.start !== windowStart || observation.trafficEvidence.end !== dueDay)) throw new GrowthStrategyError("traffic_evidence_missing", "页面自然流量须有真实属性及同一完整窗口的独立GA4证据");
    const comparisonResult = prepareGrowthObservationComparison(observation.comparison, publication, observation.checkpoint, { sourceTimezone, propertyId: context.siteProperties?.[publication.siteDomain] ?? null, now, sessions: observation.sessions });
    if (comparisonResult.issues.length) throw new GrowthStrategyError("comparison_invalid", comparisonResult.issues.join("；"), 400);
    const old = next.observations.find(row => row.id === observation.id);
    if (old && [old.publicationId, old.taskId, old.contentVersion, old.checkpoint].join() !== [observation.publicationId, observation.taskId, observation.contentVersion, observation.checkpoint].join()) throw new GrowthStrategyError("observation_identity_changed", "不能改写原观察身份或重置上线周期");
    const sameWindow = next.observations.find(row => row.publicationId === observation.publicationId && row.checkpoint === observation.checkpoint);
    if (sameWindow && sameWindow.id !== observation.id) throw new GrowthStrategyError("duplicate_observation", "此原任务窗口已有记录，请沿原观察ID补齐");
    next.observations = [...next.observations.filter(row => row.id !== observation.id), { ...observation, comparison: comparisonResult.comparison, coverage: { indexing: observation.indexing !== "unknown" ? "verified" : "missing", ranking: observation.rankingEvidence ? "verified" : "missing", traffic: observation.sessions !== null ? "verified" : "missing" } }];
  }
  next.version++; next.updatedAt = now.toISOString();
  return next;
}

export function assertGrowthDirectionScope(state: GrowthStrategy, task: { directionId?: string | null; experimentId?: string | null; siteDomain: string; topicId?: string | null; country?: string | null; language?: string | null; kind: string }, now = new Date()) {
  if (!task.directionId) { if (task.experimentId) throw new GrowthStrategyError("direction_required", "实验任务须关联方向卡"); return; }
  const direction = state.directions.find(row => row.id === task.directionId), decision = direction?.decision;
  if (!direction || decision?.decision !== "approve" || decision.actor !== "human" || decision.revision !== direction.revision || task.experimentId !== direction.experimentId || Date.parse(direction.expiresAt) <= now.getTime()) throw new GrowthStrategyError("direction_not_approved", "新方向任务须在已登录用户批准的当前方案内", 403);
  const taskKind = ["cluster", "landing"].includes(task.kind) ? "cluster_landing" : task.kind;
  const scope = decision.scope.find(row => row.site === task.siteDomain && row.topicId === task.topicId && row.country === task.country && row.language === task.language && row.kinds.some(kind => kind === taskKind) && Date.parse(row.validUntil) > now.getTime());
  if (!scope) throw new GrowthStrategyError("outside_direction_scope", "任务超出已批准的站点、话题、市场语言、类型或有效期", 403);
  return scope;
}

export type GrowthTrafficEvidence = { site: string; start: string; end: string; timezone: string; sessions: number | null; complete: boolean; observedAt: string | null; reason: string };
export type GrowthGoalEvaluation = {
  deadline: string; daysRemaining: number; baselineFrozen: boolean; baselineCount: number | null; rankedCount: number | null; top50Count: number | null;
  coverage: number | null; quality: number | null; coverageRequired: number | null; qualityRequired: number | null; coverageGap: number | null; qualityGap: number | null; latestRankAt: string | null; rankingComplete: boolean;
  weeklySessions: number | null; knownSessions: number | null; trafficGap: number | null; trafficComplete: boolean; traffic: GrowthTrafficEvidence[]; rankingReasons: string[];
  cohorts: GrowthCohortEvaluation[];
  evaluationMode: "live" | "final"; rankingAsOf: string; deadlineCutoff: string; trafficPeriod: { start: string; end: string; timezone: "America/Los_Angeles" };
  rolling: { period: { start: string; end: string }; weeklySessions: number | null; knownSessions: number | null; trafficComplete: boolean };
  finalAcceptance: { cutoff: string; status: "not_due" | "incomplete" | "achieved" | "not_achieved"; achieved: boolean | null; reason: string; trafficPeriod: { start: string; end: string } };
  /** Absent on historical four-site snapshots; never relabel those as Flatkey-only. */
  trafficScope?: { version: "flatkey-only-v3"; sites: string[]; label: string; goal: 3000 };
  identityCompleteCount?: number | null; identityPendingCount?: number | null; identityVersion?: number;
};
export type GrowthCohortEvaluation = { id: string; label: string; kind: "quarter" | "weekly" | "platform"; deadline: string; targetCount: number; rankedCount: number; top50Count: number; verifiedCount: number; coverage: number | null; quality: number | null; coverageRequired: number; coverageGap: number; qualityRequired: number | null; qualityGap: number | null; latestRankAt: string | null; complete: boolean; identityCompleteCount?: number; identityPendingCount?: number };
function evaluateCohort(targets: GrowthBaselineTarget[], workspace: GrowthWorkspace, now: Date, identity: Pick<GrowthCohortEvaluation, "id" | "label" | "kind" | "deadline">, state?: GrowthStrategy): GrowthCohortEvaluation {
  const pool = [...workspace.targets, ...(workspace.opportunities ?? [])];
  const index = indexGrowthWords(pool);
  const scoped = targets.map(target => ({ target, scope: state ? growthResolvedIdentity(state, target, now) : { country: target.country, language: target.language, revision: 0 } }));
  const fresh = (row: GrowthTarget) => row.rankSource === "serp" && row.languageStatus === "match" && Boolean(row.checkedAt) && Date.parse(row.checkedAt!) <= now.getTime() && now.getTime() - Date.parse(row.checkedAt!) <= 14 * 86400000;
  const rows = scoped.map(({ target, scope }) => {
    if (!scope.country || !scope.language) return undefined;
    const candidates = (index.get(wordIndexKey(target.site, target.keyword)) ?? []).filter(row => sameSourceWord(target, row) && row.country === scope.country && row.language === scope.language && (!row.checkedAt || Date.parse(row.checkedAt) <= now.getTime())).sort((a, b) => (Date.parse(b.checkedAt ?? "") || 0) - (Date.parse(a.checkedAt ?? "") || 0));
    return candidates.find(row => fresh(row) && row.observationEligible) ?? candidates[0];
  });
  const identityCompleteCount = scoped.filter(({ target, scope }, index) => scope.country && scope.language && (scope.revision > 0 || target.languageStatus === "match" || target.languageStatus === undefined || rows[index]?.languageStatus === "match")).length;
  const verified = rows.filter((row): row is GrowthTarget => Boolean(row && fresh(row) && row.observationEligible));
  const ranked = verified.filter(row => row.rankEligible && row.rank !== null && row.rank >= 1 && row.rank <= 100), top50 = ranked.filter(row => row.rank! <= 50);
  return { ...identity, targetCount: targets.length, rankedCount: ranked.length, top50Count: top50.length, verifiedCount: verified.length, identityCompleteCount, identityPendingCount: targets.length - identityCompleteCount, coverage: targets.length ? ranked.length / targets.length : null, quality: ranked.length ? top50.length / ranked.length : null, coverageRequired: Math.ceil(targets.length * .6), coverageGap: Math.max(0, Math.ceil(targets.length * .6) - ranked.length), qualityRequired: ranked.length ? Math.ceil(ranked.length * .8) : null, qualityGap: ranked.length ? Math.max(0, Math.ceil(ranked.length * .8) - top50.length) : null, latestRankAt: verified.map(row => row.checkedAt!).sort().at(-1) ?? null, complete: targets.length > 0 && verified.length === targets.length };
}
export function evaluateGrowthGoals(state: GrowthStrategy, workspace: GrowthWorkspace, traffic: GrowthTrafficEvidence[], period: { start: string; end: string }, now = new Date(), finalEvidence?: { workspace: GrowthWorkspace; traffic: GrowthTrafficEvidence[] }): GrowthGoalEvaluation {
  const baseline = state.baseline;
  const closed = now.getTime() > Date.parse(GROWTH_DEADLINE_CUTOFF), rankingAsOf = closed ? new Date(GROWTH_DEADLINE_CUTOFF) : now;
  const quarter = baseline ? evaluateCohort(baseline.targets, closed ? finalEvidence?.workspace ?? workspace : workspace, rankingAsOf, { id: state.id, label: "冻结季度目标", kind: "quarter", deadline: state.deadline }, state) : null;
  const complete = quarter?.complete ?? false;
  const platformTargets = workspace.targets.filter(target => target.membership === "formal" && GROWTH_EXECUTION_SITES.some(site => site === target.site)).map(freezeTarget);
  const cohorts = [...(quarter ? [quarter] : []), ...state.batches.map(batch => evaluateCohort(batch.targets, workspace, now, { id: batch.id, label: `周新增批次 ${batch.id}`, kind: "weekly", deadline: batch.deadline })), evaluateCohort(platformTargets, workspace, now, { id: "platform", label: "全平台正式目标", kind: "platform", deadline: state.deadline })];
  const trafficFor = (rows: GrowthTrafficEvidence[], window: { start: string; end: string }) => {
    const selected = GROWTH_TRAFFIC_SITES.map(site => rows.find(row => row.site === site && row.start === window.start && row.end === window.end) ?? { site, ...window, timezone: "America/Los_Angeles", sessions: null, complete: false, observedAt: null, reason: "缺少同一完整洛杉矶周的可核实会话来源" });
    const valid = selected.filter(row => row.complete && row.sessions !== null && row.timezone === "America/Los_Angeles");
    const complete = valid.length === GROWTH_TRAFFIC_SITES.length, known = valid.length ? valid.reduce((sum, row) => sum + row.sessions!, 0) : null;
    return { rows: selected, complete, known, total: complete ? known : null };
  };
  const trafficPeriod = closed ? GROWTH_FINAL_TRAFFIC_PERIOD : period;
  const currentTraffic = trafficFor(closed ? finalEvidence?.traffic ?? traffic : traffic, trafficPeriod), rollingTraffic = trafficFor(traffic, period);
  const { rows: trafficRows, complete: trafficComplete, known: knownSessions } = currentTraffic;
  const n = baseline?.targets.length ?? null, r = quarter?.rankedCount ?? null, f = quarter?.top50Count ?? null;
  const finalReady = Boolean(baseline && Date.parse(baseline.frozenAt) <= Date.parse(GROWTH_DEADLINE_CUTOFF) && trafficComplete);
  const finalPass = Boolean(finalReady && quarter!.coverage! >= .6 && quarter!.quality !== null && quarter!.quality >= .8 && currentTraffic.total! >= 3000);
  const finalStatus = !closed ? "not_due" : !finalReady ? "incomplete" : finalPass ? "achieved" : complete ? "not_achieved" : "incomplete";
  return { deadline: state.deadline, daysRemaining: Math.max(0, Math.ceil((Date.parse(state.deadline + "T23:59:59+08:00") - now.getTime()) / 86400000)), baselineFrozen: Boolean(baseline), baselineCount: n, rankedCount: r, top50Count: f,
    coverage: n ? r! / n : null, quality: r ? f! / r : null, coverageRequired: n ? Math.ceil(n * state.coverageGoal) : null, qualityRequired: r ? Math.ceil(r * state.qualityGoal) : null,
    coverageGap: n ? Math.max(0, Math.ceil(n * state.coverageGoal) - r!) : null, qualityGap: r ? Math.max(0, Math.ceil(r * state.qualityGoal) - f!) : null,
    latestRankAt: quarter?.latestRankAt ?? null, rankingComplete: complete, cohorts, identityCompleteCount: quarter?.identityCompleteCount ?? null, identityPendingCount: quarter?.identityPendingCount ?? null, identityVersion: (state.identityRevisions ?? []).filter(row => Date.parse(row.approvedAt) <= rankingAsOf.getTime()).length,
    trafficScope: { ...GROWTH_TRAFFIC_SCOPE, sites: [...GROWTH_TRAFFIC_SITES] },
    weeklySessions: currentTraffic.total, knownSessions, trafficGap: trafficComplete ? Math.max(0, 3000 - knownSessions!) : null, trafficComplete, traffic: trafficRows,
    evaluationMode: closed ? "final" : "live", rankingAsOf: rankingAsOf.toISOString(), deadlineCutoff: GROWTH_DEADLINE_CUTOFF, trafficPeriod: { ...trafficPeriod, timezone: "America/Los_Angeles" },
    rolling: { period, weeklySessions: rollingTraffic.total, knownSessions: rollingTraffic.known, trafficComplete: rollingTraffic.complete },
    finalAcceptance: { cutoff: GROWTH_DEADLINE_CUTOFF, status: finalStatus, achieved: finalStatus === "achieved" ? true : finalStatus === "not_achieved" ? false : null, reason: !closed ? "季末验收尚未到截止时刻，当前为日常进度" : "季末排名仅使用北京时间2月5日结束前有效采样，鲜度相对截止时刻；流量固定LA 1/28—2/3。截止后新排名或有利新周不补入本季成绩。待核项留N、不计R，按已证实R/N、F/R及Flatkey流量判定；采集覆盖率另行提示。", trafficPeriod: { ...GROWTH_FINAL_TRAFFIC_PERIOD } },
    rankingReasons: !baseline ? ["季度稳定目标清单尚未由用户核定，基线未冻结"] : complete ? [] : [`稳定清单N保留；${quarter?.identityPendingCount ?? 0}项身份待核不计R，部分目标缺少14天内原词原市场同语言实测，当前数量为已确认部分`],
  };
}

export type GrowthReportSnapshot = { version: "growth-v1.5"; strategyVersion: number; sourceVersion: string; generatedAt: string; period: { start: string; end: string; timezone: "America/Los_Angeles" }; goals: GrowthGoalEvaluation; directions: { id: string; title: string; experimentId: string; recommendation: string; decision: string; taskIds: string[]; drivers: GrowthDriver[]; kind?: "decision" | "attribution"; scope?: GrowthDirectionInput["scope"] }[]; observations: GrowthObservation[] };
/** A decision card is not a historic traffic driver. Keep valid real scopes in
 * the decision summary, while every numeric driver still belongs to its window. */
export function growthReportDirections(state: GrowthStrategy, workspace: GrowthWorkspace, period: { start: string; end: string }, now = new Date()): GrowthReportSnapshot["directions"] {
  const scoped = (direction: GrowthDirection) => Date.parse(direction.expiresAt) > now.getTime() && direction.scope.some(scope => Date.parse(scope.validUntil) > now.getTime() && GROWTH_MARKET_LANGUAGES[scope.country as keyof typeof GROWTH_MARKET_LANGUAGES] === scope.language && workspace.topics.some(topic => topic.site === scope.site && topic.topicId === scope.topicId));
  const driversFor = (direction: GrowthDirection) => direction.drivers.filter(driver => driver.window.start === period.start && driver.window.end === period.end && driver.window.timezone === "America/Los_Angeles");
  return state.directions.filter(direction => Date.parse(direction.updatedAt) <= now.getTime() && (scoped(direction) || driversFor(direction).length > 0))
    .sort((a, b) => Number(Boolean(a.decision)) - Number(Boolean(b.decision)) || b.updatedAt.localeCompare(a.updatedAt)).map(direction => ({ id: direction.id, title: direction.title, experimentId: direction.experimentId, recommendation: direction.proposedAction, decision: !scoped(direction) ? "历史方向归因，当前范围已失效" : direction.decision?.decision === "approve" ? "已由用户批准当前范围" : direction.decision?.decision === "reject" ? "用户未采纳" : direction.decision?.decision === "hold" ? "用户决定继续观察" : "待用户判断方向", taskIds: [...direction.taskIds], kind: scoped(direction) ? "decision" : "attribution", scope: structuredClone(direction.scope), drivers: driversFor(direction) }));
}
export function unavailableGrowthReportSnapshot(period: { start: string; end: string }, now = new Date(), reason = "季度及方向来源读取失败，保留原结构等待补齐"): GrowthReportSnapshot {
  const workspace: GrowthWorkspace = { version: "growth-v1.5", generatedAt: now.toISOString(), sites: [], markets: [], topics: [], targets: [], opportunities: [], reconciliation: { formalCount: 0, opportunityCount: 0, reviewCount: 0, totalCount: 0, uniqueKeywordCount: 0, rankedCount: 0, top50Count: 0, publishedCount: 0, countryCounts: [], historicalLanguageReview: { version: "unavailable", rawSnapshotsPreserved: true, rows: 0, matched: 0, mismatched: 0, unknown: 0, comparableTrend: false, reason }, sources: [{ name: "growth", available: false, reason }], notes: [reason] }, monitoringQuote: { approved: false, paidRequests: 0, queryCount: 0, reusedCount: 0, heldCount: 0, maxCostMicros: null, queries: [], reason } };
  const goals = evaluateGrowthGoals(emptyGrowthStrategy(), workspace, [], period, now);
  goals.cohorts = []; goals.rankingReasons = [reason];
  return { version: "growth-v1.5", strategyVersion: 0, sourceVersion: "unavailable", generatedAt: now.toISOString(), period: { ...period, timezone: "America/Los_Angeles" }, goals, directions: [], observations: [] };
}
export function growthReportLines(snapshot: GrowthReportSnapshot, includeObservations = true) {
  const g = snapshot.goals;
  return [
    `季度目标（截至${g.deadline}）：${g.trafficScope?.label ?? "四站完整周自然会话"} ${g.weeklySessions === null ? g.knownSessions === null ? "同窗口来源未齐" : `同窗口数据未齐，已核实部分${g.knownSessions}` : `${g.weeklySessions}/3000，差${g.trafficGap}`}。${g.evaluationMode === "final" ? `季末固定LA窗口${g.trafficPeriod.start}—${g.trafficPeriod.end}；排名截止${g.rankingAsOf}，验收${g.finalAcceptance.status}，不采用截止后的有利新周或新排名。` : ""}`,
    `前100覆盖 ${g.baselineCount === null ? "基线待核定" : `${g.rankedCount}/${g.baselineCount}（${((g.coverage ?? 0) * 100).toFixed(1)}%），目标60%，差${g.coverageGap}词`}；已有排名中前50 ${g.quality === null ? "待有效排名" : `${g.top50Count}/${g.rankedCount}（${(g.quality * 100).toFixed(1)}%），目标80%，差${g.qualityGap}词`}。${g.latestRankAt ? `最近有效采样${g.latestRankAt}。` : "尚无本轮有效实测。"}${g.rankingComplete ? "" : g.trafficScope ? "证据覆盖未齐；待核项留N、不计R，达标按已证实比例核算。" : "未完成全量可比核验，暂不判定达标。"}`,
    ...(typeof g.identityPendingCount === "number" ? [`稳定季度清单 N=${g.baselineCount}；身份已核${g.identityCompleteCount}，待核${g.identityPendingCount}；身份版本${g.identityVersion ?? 0}，补身份不增减原成员或分母；复用原采样日期，补计不代表新获排名。`] : []),
    ...growthCohortFactLines(snapshot),
    ...snapshot.directions.slice(0, 3).flatMap(growthDirectionFactLines),
    ...(includeObservations ? growthObservationFactLines(snapshot) : []),
  ];
}
const growthFactText = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[[\]`*_<>]/g, "");
export function growthDirectionFactLines(direction: GrowthReportSnapshot["directions"][number]) {
  return [`方向「${growthFactText(direction.title)}」：${growthFactText(direction.recommendation)}；${direction.decision}。`,
    ...(direction.kind === "decision" && !direction.drivers.length ? ["本期尚无该方向的可比流量归因；保留范围与机会决定，不将方向卡作为涨跌事实。"] : []),
    ...direction.drivers.slice(0, 3).map(driver => `• [${growthFactText(driver.title)}](${driver.url}) · ${driver.country}/${driver.language} · ${driver.source} ${driver.metric} ${driver.previous} → ${driver.current}（${driver.current > driver.previous ? "+" : ""}${driver.current - driver.previous}） · ${driver.window.previousStart}—${driver.window.previousEnd} → ${driver.window.start}—${driver.window.end}（${driver.window.timezone}）。${growthFactText(driver.explanation)} ${growthFactText(driver.limitation)} 下一步：${growthFactText(driver.nextAction)}。`),
    `原任务：${direction.taskIds.length ? direction.taskIds.map(id => `[${growthFactText(id)}](https://flatkey-seo-roadmap.vercel.app/work/${encodeURIComponent(id)})`).join("、") : "尚未关联制作任务，先保留研究/观察"}。`,
  ];
}
export function growthCohortFactLines(snapshot: GrowthReportSnapshot) {
  return (snapshot.goals.cohorts ?? []).map(cohort => `${cohort.label}（截至${cohort.deadline}）：目标${cohort.targetCount}，已核验${cohort.verifiedCount}；前100 ${cohort.rankedCount}/${cohort.targetCount}，前50 ${cohort.top50Count}/${cohort.rankedCount}；距60%差${cohort.coverageGap}词、距80%${cohort.qualityGap === null ? "待有效排名" : `差${cohort.qualityGap}词`}；${cohort.complete ? "同口径核验完整" : typeof cohort.identityPendingCount === "number" ? `身份待核${cohort.identityPendingCount}项留N不计R，证据覆盖另列` : "证据未齐，不判定达标"}。`);
}
export function growthObservationFactLines(snapshot: GrowthReportSnapshot) {
  return (snapshot.observations ?? []).slice(0, 5).map(observation => `• [${growthFactText(observation.taskId)}](${observation.pageUrl}) · ${observation.checkpoint}天：${growthFactText(growthObservationComparisonText(observation.comparison, observation.checkpoint))} ${growthFactText(observation.conclusion)}；${growthFactText(observation.nextAction)}。`);
}
/** Text approval and the frozen structured rendering must describe the same
 * facts. Changing a value/link/action requires another source snapshot. */
export function growthReportMissingFactLines(snapshot: GrowthReportSnapshot, text: string) {
  return growthReportLines(snapshot).filter(line => !text.includes(line));
}
