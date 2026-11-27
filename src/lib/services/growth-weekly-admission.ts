import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { flatkeyBlogSourceUrl, weeklyGrowthDeliveryWeek, weeklyGrowthTaskProblem, type WeeklyGrowthReport } from "../growth-weekly-admission";
import { hotspotPlanMutation, preservedHotspotPlan, rawWorkflowRecord } from "../growth-hotspot-admission";
import { growthWebsitePageUrl } from "../growth-live-page";
import { growthWordKey } from "../growth-workspace";
import type { GrowthDirection } from "../growth-strategy";
import { WEEKLY_GROWTH_EXTRA } from "../seo-extra-capacity";
import { isExecutableWorkflowPlan, type WorkflowHistoricalImport, type WorkflowPlan, type WorkflowPublication, type WorkflowTask } from "../seo-workflow";
import { workflowHash, WorkflowError, type WorkflowActor, type WorkflowStoredRow } from "../seo-workflow-state";
import { readGrowthStrategy } from "./growth-strategy";
import { saveWorkflowMutation } from "./seo-workflow";
import { assertPublishedMaintenanceTasks } from "./seo-published-maintenance";

type ReportReader = Pick<Prisma.TransactionClient, "seoReportVersion">;
export async function readWeeklyGrowthReport(db: ReportReader, reportId?: string): Promise<WeeklyGrowthReport | null> {
  if (!reportId) return null;
  const row = await db.seoReportVersion.findUnique({ where: { id: reportId }, select: { kind: true, payload: true, siteDomain: true } });
  return row?.kind === "SEO_DIGEST" && row.siteDomain === "flatkey.ai" ? row.payload as unknown as WeeklyGrowthReport : null;
}

function plansForWeek(plans: WorkflowPlan[], report: WeeklyGrowthReport) {
  const range = weeklyGrowthDeliveryWeek(report);
  return plans.filter(plan => isExecutableWorkflowPlan(plan.status) && "executionRange" in plan.targets
    && plan.targets.executionRange.start === range.start && plan.targets.executionRange.end === range.end);
}

function pageVariants(url: string) {
  const www = new URL(url);
  www.hostname = "www." + www.hostname;
  return [url, url + "/", www.href, www.href + "/"];
}

async function publishedArticleAnchors(db: Pick<Prisma.TransactionClient, "siteKeyword">, task: WorkflowTask, direction?: GrowthDirection) {
  if (task.kind !== "blog" || task.siteDomain !== "flatkey.ai" || !task.topicId || !direction) return [];
  const candidates = direction.drivers.flatMap(driver => {
    if (driver.country !== "ALL" || driver.topicId !== task.topicId) return [];
    const source = flatkeyBlogSourceUrl(driver.url), page = growthWebsitePageUrl(driver.url, task.siteDomain);
    return source && page ? [...pageVariants(source), ...pageVariants(page)] : [];
  });
  if (!candidates.length) return [];
  const members = await db.siteKeyword.findMany({
    where: { siteDomain: task.siteDomain, active: true, pool: "FORMAL", keyword: { active: true },
      OR: [{ topicId: task.topicId }, { topicAssignments: { some: { topicId: task.topicId } } }],
      targetUrls: { hasSome: [...new Set(candidates)] } },
    select: { targetUrls: true },
  });
  return members.flatMap(member => member.targetUrls.filter(url => candidates.includes(url))
    .map(pageUrl => ({ siteDomain: task.siteDomain, topicId: task.topicId, pageUrl })));
}

async function assertUniqueGrowthBlog(db: Prisma.TransactionClient, task: WorkflowTask, rows: WorkflowStoredRow[]) {
  const page = growthWebsitePageUrl(task.pageUrl, task.siteDomain);
  if (!page || !task.keywordId || !task.keyword) throw new WorkflowError("weekly_growth_blog_identity", "新增加推博客须保存拟发规范地址和正式原词", 422);
  const samePage = (url: string | null) => growthWebsitePageUrl(url, task.siteDomain) === page;
  const sameIntent = (row: WorkflowTask) => row.country === task.country && row.language === task.language && row.keyword
    && growthWordKey(row.keyword) === growthWordKey(task.keyword!);
  const duplicate = rows.some(row => {
    if (row.kind === "task") {
      const other = row.record as WorkflowTask;
      return other.id !== task.id && !other.deletedAt && other.siteDomain === task.siteDomain
        && ["blog", "optimization", "landing", "cluster"].includes(other.kind) && (samePage(other.pageUrl) || sameIntent(other));
    }
    if (row.kind === "publication") {
      const publication = row.record as WorkflowPublication;
      return publication.siteDomain === task.siteDomain && ["published", "verified"].includes(publication.status) && samePage(publication.pageUrl);
    }
    return row.kind === "historical_import" && (row.record as WorkflowHistoricalImport).publications
      .some(publication => publication.verificationState === "live_verified" && samePage(publication.pageUrl));
  });
  if (duplicate) throw new WorkflowError("weekly_growth_blog_duplicate", "拟发博客或同市场原词已有交付任务，请先核对复用", 422);
  const known = await db.seoPageInventory.findFirst({ where: { url: { in: pageVariants(page) } }, select: { url: true } });
  if (known) throw new WorkflowError("weekly_growth_blog_duplicate", "拟发博客规范地址已在线上页面库登记，请沿原页处理", 422);
}

export async function assertWeeklyGrowthAdmission(db: Prisma.TransactionClient, tasks: WorkflowTask[], rows: WorkflowStoredRow[], plan: WorkflowPlan | undefined, now: Date) {
  if (!tasks.length) return;
  await assertPublishedMaintenanceTasks(db, tasks.filter(task => task.kind === "optimization"), rows, now);
  const state = await readGrowthStrategy(db);
  const plans = rows.filter(row => row.kind === "plan").map(row => row.record as WorkflowPlan);
  for (const task of tasks) {
    const direction = state.directions.find(row => row.id === task.directionId);
    const report = await readWeeklyGrowthReport(db, direction?.weeklyGrowth?.reportId);
    const anchors = await publishedArticleAnchors(db, task, direction);
    const problem = weeklyGrowthTaskProblem(state, task, report, now, anchors);
    if (problem) throw new WorkflowError("weekly_growth_evidence_required", problem, 422);
    if (task.kind === "blog") await assertUniqueGrowthBlog(db, task, rows);
    if (plan && report) {
      const candidates = plansForWeek(plans, report);
      if (candidates.length !== 1 || candidates[0].id !== plan.id || !preservedHotspotPlan(candidates[0], plan, task.id)) {
        throw new WorkflowError("weekly_growth_original_plan_required", "上涨加推须追加到该周唯一正式原计划并保留原目标、任务及已承诺交付", 422);
      }
    }
  }
}

export async function admitApprovedWeeklyGrowthDirection(directionId: string, revision: number, actor: WorkflowActor, localPreview = false) {
  if (actor !== "human") throw new WorkflowError("weekly_growth_human_required", "上涨加推须经原人审方向入口确认", 403);
  if (localPreview) return { status: "pending", reason: "此预览缺少生产周报与原计划" };
  const state = await readGrowthStrategy(), direction = state.directions.find(row => row.id === directionId && row.revision === revision);
  if (!direction?.weeklyGrowth || direction.decision?.actor !== "human" || direction.decision.decision !== "approve" || direction.decision.revision !== revision)
    return { status: "not_applicable", reason: "原方向或该版本的明确加推决定不可用" };
  const report = await readWeeklyGrowthReport(prisma, direction.weeklyGrowth.reportId);
  if (!report) return { status: "pending", reason: "缺少方向指向的生产周报" };
  const taskIds = direction.taskIds;
  const results: { taskId: string; status: "scheduled" | "reused" | "pending"; reason?: string; planId?: string }[] = [];
  const readPlans = async () => (await prisma.seoWorkflowRecord.findMany({
    where: { kind: "plan", status: { in: ["scheduled", "reviewed"] } }, select: { payload: true },
  })).map(row => row.payload as unknown as WorkflowPlan);
  const readTask = async (taskId: string) => {
    const row = await prisma.seoWorkflowRecord.findUnique({ where: { key: `task:${taskId}` }, select: { payload: true } });
    return row ? row.payload as unknown as WorkflowTask : null;
  };
  for (const taskId of taskIds) {
    const pending = (reason: string) => results.push({ taskId, status: "pending", reason });
    try {
      const [task, originalPlans] = await Promise.all([readTask(taskId), readPlans()]);
      if (!task || task.deletedAt || !["optimization", "blog"].includes(task.kind) || task.directionId !== directionId) {
        pending("缺少绑定此方向的原页优化或新增博客任务"); continue;
      }
      const existing = originalPlans.find(plan => plan.taskIds.includes(taskId));
      if (existing) { results.push({ taskId, status: "reused", planId: existing.id }); continue; }
      const candidates = plansForWeek(originalPlans, report);
      if (candidates.length !== 1) { pending("周报对应业务周缺少唯一可追加的正式原计划"); continue; }
      const extra = { ...task, capacityClass: WEEKLY_GROWTH_EXTRA, weeklyGrowthRevision: revision } as const;
      const problem = weeklyGrowthTaskProblem(state, extra, report, new Date(), await publishedArticleAnchors(prisma, extra, direction));
      if (problem || task.status !== "ready") { pending(problem ?? "原任务尚未完成研究并进入可执行状态"); continue; }
      const record = rawWorkflowRecord(extra);
      if (task.capacityClass !== WEEKLY_GROWTH_EXTRA) {
        let writeError: unknown;
        try {
          await saveWorkflowMutation({ action: "save_task", expectedVersion: task.version,
            requestId: `weekly-growth-task:${workflowHash([task.version, record])}`, record }, actor);
        } catch (error) { writeError = error; }
        const saved = await readTask(taskId);
        if (!saved || workflowHash(rawWorkflowRecord(saved)) !== workflowHash(record)) {
          pending(writeError instanceof WorkflowError ? writeError.message : "原任务登记后读回未对平"); continue;
        }
      }
      const plan = candidates[0];
      const change = hotspotPlanMutation(plan, taskId, { directionId, revision, taskIds: [taskId] });
      let writeError: unknown;
      try { await saveWorkflowMutation({ ...change, requestId: `weekly-growth-plan:${workflowHash([plan.version, change.record, revision])}` }, actor); }
      catch (error) { writeError = error; }
      const savedPlan = (await readPlans()).find(row => row.id === plan.id);
      if (!savedPlan || !preservedHotspotPlan(plan, savedPlan, taskId)) { pending(writeError instanceof WorkflowError ? writeError.message : "原计划追加后读回未对平"); continue; }
      results.push({ taskId, status: "scheduled", planId: savedPlan.id });
    } catch {
      pending("生产读回或原任务保存暂未完成，可沿原方向版本重试");
    }
  }
  return { status: results.some(row => row.status === "pending") || !results.length ? "pending" : "registered", reportId: report.id, revision, results };
}
