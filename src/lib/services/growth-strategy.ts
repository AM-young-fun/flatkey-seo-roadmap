import "server-only";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { analyticsObservationSchema, analyticsSiteForProperty, scopedAnalytics } from "../seo-analytics";
import { CLUSTER_SITES } from "../seo-cluster-sites";
import { weeklyReportRange } from "../seo-date-range";
import { loadWorkflowSnapshot } from "./seo-workflow";
import { loadGrowthWorkspace } from "./growth-workspace";
import { growthPageContributionDirections } from "../growth-report-attribution";
import { assertGrowthDirectionScope, emptyGrowthStrategy, evaluateGrowthGoals, GROWTH_QUARTER_ID, GROWTH_STRATEGY_KIND, GROWTH_TRAFFIC_SITES, GROWTH_EXECUTION_SITES, GROWTH_DEADLINE_CUTOFF, GROWTH_FINAL_TRAFFIC_PERIOD, growthHash, growthBaselineIdentityReview, growthReportDirections, growthStrategyCommandSchema, growthStrategyStoredSchema, growthWorkspaceIdentity, GrowthStrategyError, prepareGrowthStrategyMutation, type GrowthStrategy, type GrowthReportSnapshot, type GrowthTrafficEvidence } from "../growth-strategy";
import type { GrowthWorkspace } from "../growth-types";
import { workflowSnapshot, type WorkflowStoredRow } from "../seo-workflow-state";
import type { WorkflowTask, WorkflowSnapshot } from "../seo-workflow";
import { growthExactTrafficSchema, growthTrafficHasCompleteHostScope } from "../growth-exact-traffic";
import { growthDueObservationInventory } from "../growth-due-observations";

const key = `${GROWTH_STRATEGY_KIND}:${GROWTH_QUARTER_ID}`;
type Reader = Pick<Prisma.TransactionClient, "seoWorkflowRecord">;
type LocalState = { state: GrowthStrategy; events: { requestId: string; requestHash: string; state: GrowthStrategy }[] };
const json = (value: unknown) => value as Prisma.InputJsonValue;
function routineApprovedTargetIds(workspace: GrowthWorkspace, tasks: WorkflowTask[], state: GrowthStrategy, now: Date) {
  return workspace.targets.filter(target => target.membership === "formal" && tasks.some(task => {
    if (!target.taskIds.includes(task.id) || !["ready", "drafting", "review_pending", "approved", "published", "verified", "observing"].includes(task.status) || task.siteDomain !== target.site || task.country !== target.country || task.language !== target.language || task.keyword?.trim().toLowerCase() !== target.keyword.trim().toLowerCase()) return false;
    try { assertGrowthDirectionScope(state, task, now); return true; } catch { return false; }
  })).map(target => target.id);
}
function previewDirectory(localPreview: boolean) {
  if (!localPreview) return null;
  const directory = process.env.SEO_WORKFLOW_PREVIEW_DIR ?? join(process.cwd(), ".local", "seo-workflow");
  if (!isAbsolute(directory)) throw new GrowthStrategyError("configuration", "本地预览目录必须是绝对路径", 503);
  return directory;
}
async function readLocal(directory: string): Promise<LocalState> {
  try { const stored = JSON.parse(await readFile(join(directory, "growth-strategy.json"), "utf8")) as LocalState; return { state: growthStrategyStoredSchema.parse(stored.state), events: stored.events }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: emptyGrowthStrategy(), events: [] }; throw error; }
}
/** Caller may pass the existing workflow transaction, keeping scope checks and task writes under the same advisory lock. */
export async function readGrowthStrategy(db: Reader = prisma): Promise<GrowthStrategy> {
  const row = await db.seoWorkflowRecord.findUnique({ where: { key }, select: { payload: true } });
  return row ? growthStrategyStoredSchema.parse(row.payload) : emptyGrowthStrategy();
}
export async function loadGrowthStrategy(localPreview = false) {
  const directory = previewDirectory(localPreview);
  return directory ? (await readLocal(directory)).state : readGrowthStrategy();
}
export async function saveGrowthStrategy(raw: unknown, actor: "human" | "collector", localPreview = false, now = new Date()) {
  const command = growthStrategyCommandSchema.parse(raw), requestHash = growthHash({ actor, command });
  if (command.action === "save_quarter_plan" && command.plan.version !== "quarter-planning-v2") throw new GrowthStrategyError("legacy_allocation_read_only", "新季度方案统一GPU/API/其他70/25/5；旧版本仅保留历史，不再提交两套投入比例", 422);
  const assertApprovalContract = (state: GrowthStrategy) => {
    if (command.action === "approve_quarter_plan" && state.quarterPlanning?.plan.version !== "quarter-planning-v2") throw new GrowthStrategyError("legacy_approval_read_only", "旧待审草稿不能作为新季度基座；请先保存本轮GPU优先的1600词确切方案，旧已审历史保留", 422);
  };
  if (actor === "collector" && ["decide_direction", "freeze_baseline", "resolve_baseline_identities", "approve_quarter_plan"].includes(command.action)) throw new GrowthStrategyError("human_required", "方向决定、季度清单与身份补充须由已登录用户确认", 403);
  const requestId = `growth:${command.requestId}`;
  // Evidence references are read from the real sources; caller-supplied target
  // identities, page versions or task IDs cannot become the source of truth.
  const [workspace, workflow, sites] = await Promise.all([loadGrowthWorkspace(localPreview, now), loadWorkflowSnapshot({ allHistory: true }, localPreview), localPreview ? Promise.resolve([]) : prisma.seoSite.findMany({ where: { domain: { in: [...GROWTH_EXECUTION_SITES] } }, select: { domain: true, ga4PropertyId: true } })]);
  const contextFor = (state: GrowthStrategy, tasks: WorkflowTask[]) => ({ routineApprovedTargetIds: routineApprovedTargetIds(workspace, tasks, state, now),
    // Trusted task identities are loaded from the original workflow records,
    // never accepted from a caller's observation payload.
    taskReferences: tasks.map(({ id, siteDomain, pageUrl, keyword, keywordId, country, language, deletedAt }) => ({ id, siteDomain, pageUrl, keyword, keywordId, country, language, deletedAt })),
    siteProperties: Object.fromEntries(sites.map(site => [site.domain, site.ga4PropertyId])), siteTimezones: growthSourceTimezones(state) });
  const prepare = (state: GrowthStrategy) => { assertApprovalContract(state); return growthStrategyStoredSchema.parse(prepareGrowthStrategyMutation(state, command, actor, workspace, workflow.publications, workflow.tasks.map(task => task.id), now, contextFor(state, workflow.tasks))); };
  const directory = previewDirectory(localPreview);
  if (directory) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lock = join(directory, "growth-strategy.lock"), temporary = join(directory, `.growth-${randomUUID()}.json`);
    try { await mkdir(lock); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new GrowthStrategyError("preview_busy", "目标与方向预览正在保存，请稍后重试"); throw error; }
    try {
      const local = await readLocal(directory), replay = local.events.find(event => event.requestId === requestId);
      if (replay) { if (replay.requestHash !== requestHash) throw new GrowthStrategyError("idempotency_conflict", "同一请求编号已用于不同内容或身份"); return { state: replay.state, replay: true, storage: "local_preview" }; }
      const state = prepare(local.state); local.state = state; local.events.push({ requestId, requestHash, state });
      await writeFile(temporary, JSON.stringify(local), { flag: "wx", mode: 0o600 }); await rename(temporary, join(directory, "growth-strategy.json"));
      const readback = (await readLocal(directory)).state;
      if (growthHash(readback) !== growthHash(state)) throw new GrowthStrategyError("readback_failed", "方向记录读回不一致", 503);
      return { state: readback, replay: false, storage: "local_preview" };
    } finally { await rm(temporary, { force: true }); await rm(lock, { recursive: true, force: true }); }
  }
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-v1'))`;
    const replay = await tx.seoWorkflowEvent.findUnique({ where: { requestId } });
    if (replay) { if (replay.requestHash !== requestHash) throw new GrowthStrategyError("idempotency_conflict", "同一请求编号已用于不同内容或身份"); return { state: growthStrategyStoredSchema.parse(replay.payload), replay: true, storage: "database" }; }
    const current = await readGrowthStrategy(tx);
    assertApprovalContract(current);
    // Re-read original publication/task records inside the task-write lock.
    const references = await tx.seoWorkflowRecord.findMany({ where: { kind: { in: ["task", "publication", "plan", "historical_import"] } }, select: { kind: true, recordId: true, payload: true } });
    const publications = references.filter(row => row.kind === "publication").map(row => row.payload as unknown as import("../growth-strategy").GrowthPublicationReference);
    const tasks = references.filter(row => row.kind === "task").map(row => row.payload as unknown as WorkflowTask);
    // Approval reads identities, TopicMap and task/page sources from the same
    // repeatable-read transaction snapshot. This does not lock future Topic edits.
    const identityCommands = ["save_quarter_plan", "approve_quarter_plan", "freeze_baseline", "resolve_baseline_identities"];
    const transactionWorkspace = identityCommands.includes(command.action)
      ? await loadGrowthWorkspace(false, now, undefined, { db: tx, workflow: workflowSnapshot(references.map(row => ({ kind: row.kind, record: row.payload })) as unknown as WorkflowStoredRow[], { allHistory: true }, "database", now) })
      : workspace;
    const state = growthStrategyStoredSchema.parse(prepareGrowthStrategyMutation(current, command, actor, transactionWorkspace, publications, tasks.map(task => task.id), now, contextFor(current, tasks)));
    const data = { kind: GROWTH_STRATEGY_KIND, recordId: GROWTH_QUARTER_ID, weekStart: "2026-11-23", siteDomain: null, status: state.baseline ? "frozen" : "draft", version: state.version, payload: json(state) };
    if (current.version === 0) await tx.seoWorkflowRecord.create({ data: { key, ...data } });
    else { const saved = await tx.seoWorkflowRecord.updateMany({ where: { key, version: command.expectedVersion }, data }); if (saved.count !== 1) throw new GrowthStrategyError("version_conflict", "方向与目标已更新，请刷新后重试"); }
    await tx.seoWorkflowEvent.create({ data: { requestId, requestHash, recordKey: key, kind: GROWTH_STRATEGY_KIND, version: state.version, payload: json(state) } });
    const readback = await readGrowthStrategy(tx);
    if (growthHash(readback) !== growthHash(state)) throw new GrowthStrategyError("readback_failed", "方向记录读回不一致", 503);
    return { state: readback, replay: false, storage: "database" };
  }, { maxWait: 10_000, timeout: 90_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

function growthSourceTimezones(state: GrowthStrategy): Record<string, string | null> {
  const result: Record<string, string | null> = { "flatkey.ai": "America/Los_Angeles", ...Object.fromEntries(CLUSTER_SITES.map(site => [site.domain, site.ga4TimeZone])) };
  for (const row of [...state.trafficEvidence].sort((a, b) => a.metadata.observedAt.localeCompare(b.metadata.observedAt))) result[row.site] = row.sourceTimezone;
  return result;
}
export async function loadGrowthTraffic(period: { start: string; end: string }, now = new Date(), state = emptyGrowthStrategy()): Promise<GrowthTrafficEvidence[]> {
  const [rows, weekly, sites] = await Promise.all([
    prisma.seoAnalyticsDay.findMany({ where: { kind: "ga4-site", date: { gte: period.start, lte: period.end } }, select: { payload: true } }),
    prisma.weeklyTraffic.findMany({ where: { siteDomain: { in: [...GROWTH_TRAFFIC_SITES] }, periodStart: new Date(period.start), periodEnd: new Date(period.end) }, select: { siteDomain: true, ga4PropertyId: true, analysis: true } }),
    prisma.seoSite.findMany({ where: { domain: { in: [...GROWTH_TRAFFIC_SITES] } }, select: { domain: true, ga4PropertyId: true } }),
  ]);
  const imported = weekly.flatMap(row => {
    const analysis = row.analysis && typeof row.analysis === "object" && !Array.isArray(row.analysis) ? row.analysis : {};
    const parsed = growthExactTrafficSchema.safeParse("exactOrganicSessions" in analysis ? analysis.exactOrganicSessions : null);
    return parsed.success && parsed.data.site === row.siteDomain && parsed.data.propertyId === row.ga4PropertyId ? [parsed.data] : [];
  });
  const exact = [...state.trafficEvidence, ...imported].filter(row => row.start === period.start && row.end === period.end && growthTrafficHasCompleteHostScope(row) && Date.parse(row.observedAt) <= now.getTime() && sites.some(site => site.domain === row.site && site.ga4PropertyId === row.propertyId)).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const parsed = rows.flatMap(({ payload }) => { const row = analyticsObservationSchema.safeParse(payload); return row.success ? scopedAnalytics([row.data]) : []; });
  const count = Math.round((Date.parse(period.end) - Date.parse(period.start)) / 86400000) + 1;
  return GROWTH_TRAFFIC_SITES.map(site => {
    const exactPeriod = exact.find(row => row.site === site);
    if (exactPeriod) return { site, ...period, timezone: "America/Los_Angeles", sessions: exactPeriod.sessions, complete: true, observedAt: exactPeriod.observedAt, reason: `真实属性${exactPeriod.propertyId}，原metadata ${exactPeriod.sourceTimezone}，${exactPeriod.method === "utc_hours" ? "完整UTC小时重聚" : "完整原生日桶"}；证据${exactPeriod.id}` };
    const days = new Map(parsed.filter(row => row.kind === "ga4-site" && !row.country && analyticsSiteForProperty(row.property) === site && Date.parse(row.observedAt) <= now.getTime()).sort((a, b) => a.observedAt.localeCompare(b.observedAt)).map(row => [row.date, row]));
    const values = [...days.values()].filter(row => row.kind === "ga4-site" && row.sessions !== null);
    return { site, ...period, timezone: "unknown", sessions: null, complete: false,
      observedAt: values.map(row => row.observedAt).sort().at(-1) ?? null,
      reason: values.length === count && count === 7 ? "已有7日日桶，但缺原metadata时区、完整官网/控制台范围及整周exact证据包；保留原档，不硬编码齐全" : "完整周exact来源未齐，不填0；须复用原metadata与完整日桶/小时证据包" };
  });
}

export async function loadGrowthReportSnapshot(date: string, localPreview = false, now = new Date(), provided: { state?: GrowthStrategy; workspace?: GrowthWorkspace; workflow?: WorkflowSnapshot } = {}): Promise<GrowthReportSnapshot> {
  const period = weeklyReportRange(date);
  const previousStart = new Date(Date.parse(period.start + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
  const [state, workspace, workflow, archive] = await Promise.all([provided.state ?? loadGrowthStrategy(localPreview), provided.workspace ?? loadGrowthWorkspace(localPreview, now), provided.workflow ?? loadWorkflowSnapshot({ allHistory: true }, localPreview), localPreview ? Promise.resolve([]) : prisma.seoAnalyticsDay.findMany({ where: { OR: [{ kind: { startsWith: "ga4-pages" } }, { kind: { startsWith: "gsc-pages" } }], date: { gte: previousStart, lte: period.end } }, select: { payload: true } })]);
  const traffic = localPreview ? [] : await loadGrowthTraffic(period, now, state);
  const observations = archive.flatMap(({ payload }) => { const row = analyticsObservationSchema.safeParse(payload); return row.success ? scopedAnalytics([row.data]) : []; });
  const contributions = growthPageContributionDirections(workspace, workflow.publications, observations, period, now, workflow.tasks);
  const finalEvidence = now.getTime() > Date.parse(GROWTH_DEADLINE_CUTOFF) ? await Promise.all([
    loadGrowthWorkspace(localPreview, new Date(GROWTH_DEADLINE_CUTOFF)), localPreview ? Promise.resolve([]) : loadGrowthTraffic(GROWTH_FINAL_TRAFFIC_PERIOD, now, state),
  ]).then(([workspace, traffic]) => ({ workspace, traffic })) : undefined;
  const goals = evaluateGrowthGoals(state, workspace, traffic, period, now, finalEvidence);
  return { version: "growth-v1.5", strategyVersion: state.version, sourceVersion: growthWorkspaceIdentity(workspace), generatedAt: now.toISOString(), period: { ...period, timezone: "America/Los_Angeles" }, goals,
    directions: [...growthReportDirections(state, workspace, period, now), ...contributions],
    observations: state.observations.filter(row => row.windowEnd >= period.start && row.windowEnd <= period.end) };
}
export async function loadGrowthStrategyView(localPreview = false, now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  const [state, workspace, workflow] = await Promise.all([loadGrowthStrategy(localPreview), loadGrowthWorkspace(localPreview, now), loadWorkflowSnapshot({ allHistory: true }, localPreview)]);
  const snapshot = await loadGrowthReportSnapshot(date, localPreview, now, { state, workspace, workflow });
  const inventory = growthDueObservationInventory(workflow, state.observations, growthSourceTimezones(state), now);
  return { state, snapshot, identityReview: growthBaselineIdentityReview(state, workspace, now), sourceVersion: growthWorkspaceIdentity(workspace), formalTargets: workspace.targets.filter(row => row.membership === "formal"), ...inventory };
}
