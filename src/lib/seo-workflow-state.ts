import { GROWTH_EXECUTION_SITES, GROWTH_BLOG_SITES } from "./seo-growth-markets";
import { assertGrowthPlan } from "./seo-growth-plan";
import { taskNeedsChineseBrief, workflowTaskBriefProblems } from "./seo-task-brief";
import { isSeoWorkday, seoCatchUpDate } from "./seo-workday";
import { seoToday, workWeekDateRange } from "./seo-date-range";
import { approvalReviewReadiness, automaticTaskPolicy, approvalItemNeedsHuman, isExecutableWorkflowPlan, pageBelongsToSite, workflowClusterRollbackCandidates } from "./seo-workflow";
import { createHash } from "node:crypto";
import { ACTION_KIND, WORKFLOW_SCHEMAS, workflowMutationSchema, workflowWeek, shiftWorkflowDay, type WorkflowKind, type WorkflowRecord, type WorkflowTask, type WorkflowPlan, type WorkflowPublication, type WorkflowOptimization, type WorkflowSnapshot, type WorkflowRun, type WorkflowIssue, type WorkflowHistoricalImport, type WorkflowApproval, type WorkflowApprovalCheck, workflowApprovalEffectiveItemStatus, workflowApprovalItemStatus } from "./seo-workflow";
import { optimizationComparisonProblems } from "./seo-workflow-comparison";
import { maintenanceTaskProblems, maintenancePublicationProblems, maintenanceHistoryProblems } from "./seo-maintenance";

export class WorkflowError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
export type WorkflowStoredRow = { kind: WorkflowKind; record: WorkflowRecord };
export type WorkflowActor = "human" | "collector";
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)])) : value;
export const workflowHash = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value)) ?? "undefined").digest("hex");
export const workflowKey = (kind: WorkflowKind, id: string) => `${kind}:${id}`;
/** Completed deliveries may append effect evidence after a direction expires.
 * This never authorizes a new page/version, schedule or production transition. */
export function isCompletedGrowthEvidenceAppend(task: WorkflowTask, previous: WorkflowTask | undefined) {
  const completed = new Set(["published", "verified", "observing"]);
  if (!previous || !completed.has(previous.status) || !completed.has(task.status)) return false;
  return ["kind", "workClass", "maintenance", "siteDomain", "topicId", "keywordId", "keyword", "country", "language", "pageUrl", "contentVersion", "artifactUrl", "dueAt", "weekStart", "directionId", "experimentId", "codeSource"].every(key => workflowHash(task[key as keyof WorkflowTask]) === workflowHash(previous[key as keyof WorkflowTask]));
}

function reject(code: string, message: string): never { throw new WorkflowError(code, message); }
const same = (a: unknown, b: unknown) => workflowHash(a) === workflowHash(b);
const contentKinds = new Set(["blog", "landing", "optimization", "cluster"]);
const beforePublication = new Set(["planned", "researching", "ready", "drafting", "review_pending", "approved", "blocked", "failed"]);
const productionStates = new Set(["ready", "drafting", "review_pending", "approved", "published", "verified", "observing"]);
// 2026-11-19 user decision: transfer the existing total landing capacity to the two satellite sites.
const clusterOnlyLandingWeek = "2026-11-23";

function tasksUsingBranch(all: WorkflowStoredRow[], task: WorkflowTask) {
  return all.some(({ kind, record }) => {
    if (kind !== "task" || record.id === task.id) return false;
    const other = record as WorkflowTask;
    return other.codeSource?.repository.toLowerCase() === task.codeSource?.repository.toLowerCase() && other.codeSource?.branch === task.codeSource?.branch;
  });
}

function maintenanceHistory(all: WorkflowStoredRow[]): Parameters<typeof maintenanceHistoryProblems>[1] {
  return [
    ...all.filter(row => row.kind === "publication").map(row => row.record as WorkflowPublication),
    ...all.filter(row => row.kind === "historical_import").flatMap(row => {
      const archive = row.record as WorkflowHistoricalImport;
      return archive.publications.filter(publication => ["live_verified", "artifact_verified"].includes(publication.verificationState))
        .map(publication => ({ ...publication, taskId: publication.sourceTaskId, siteDomain: archive.siteDomain, status: "published" as const }));
    }),
  ];
}

function assertTask(task: WorkflowTask, previous: WorkflowTask | undefined, all: WorkflowStoredRow[], actor: WorkflowActor, now: Date) {
  const changingExecution = !previous || task.status !== previous.status;
  if (changingExecution && (task.channel === "product" || task.channel !== "github" && !GROWTH_EXECUTION_SITES.some(site => site === task.siteDomain))) reject("task_scope_excluded", "该站点或产品渠道仅保留历史，不进入SEO执行队列");
  if (changingExecution && task.kind === "blog" && !GROWTH_BLOG_SITES.some(site => site === task.siteDomain)) reject("blog_scope_excluded", "博客制作仅限 Flatkey 和 ModelFit");
  if (task.capacityClass === "authorized_hotspot_extra" && previous?.capacityClass !== task.capacityClass && actor !== "human") reject("human_extra_work_required", "额外热点须由真实用户登记授权，不能由采集器扩大常规容量");
  if (previous && previous.kind !== task.kind) reject("task_kind_immutable", "原任务类型保持不变，研究与制作按依赖关联相应原任务，不转换类型绕过资格");
  if (previous?.workClass && previous.workClass !== task.workClass || previous && !previous.workClass && task.workClass && !["planned", "researching"].includes(previous.status)) reject("maintenance_class_immutable", "保留原维护分类，不能将已排或在途交付改类重复占用额度");
  if (previous?.maintenance && !same(previous.maintenance, task.maintenance) && ["published", "verified", "observing"].includes(previous.status)) reject("maintenance_plan_immutable", "已上线维护计划和基线不可覆盖");
  const maintenanceProblems = maintenanceTaskProblems(task);
  if (maintenanceProblems.length) reject("maintenance_incomplete", maintenanceProblems.join("；"));
  if (task.workClass && productionStates.has(task.status) && task.maintenance?.refresh) {
    const refresh = task.maintenance.refresh;
    const baseline = all.find(row => row.kind === "optimization" && row.record.id === refresh.baselineId)?.record as WorkflowOptimization | undefined;
    if (!baseline || baseline.taskId !== task.id || baseline.pageUrl !== task.pageUrl || baseline.siteDomain !== task.siteDomain || baseline.country !== task.country || baseline.language !== task.language || Date.parse(baseline.baseline.capturedAt) > now.getTime()) reject("refresh_baseline_missing", "翻新开始前须保存同原任务、页面及市场的真实优化基线，缺数如实保留");
    if (["ready", "drafting", "review_pending", "approved"].includes(task.status)) {
      const problems = maintenanceHistoryProblems(task, maintenanceHistory(all));
      if (problems.length) reject("refresh_history_mismatch", problems.join("；"));
    }
  }
  if (previous?.workflowContract === "growth-v1.5") for (const key of ["siteDomain", "keywordId", "keyword", "country", "language", "topicId"] as const) {
    if (previous[key] != null && previous[key] !== task[key]) reject("growth_target_identity_immutable", "原词、国家语言、站点和话题身份保持不变，不能通过改任务迁移目标");
  }
  if (previous?.workflowContract && previous.workflowContract !== task.workflowContract) reject("growth_contract_immutable", "请保留任务执行契约和研究门槛");
  if (previous?.directionId && previous.directionId !== task.directionId || previous?.experimentId && previous.experimentId !== task.experimentId) reject("direction_identity_immutable", "保留原方向与实验身份，不能省略字段绕过批准范围");
  if (previous?.problemKey && previous.problemKey !== task.problemKey) reject("problem_identity_immutable", "同一问题须保留稳定身份");
  if (previous?.deletedAt) reject("task_deleted", "该任务已删除。");
  if (task.deletedAt) {
    if (actor !== "human" || !previous) reject("human_task_delete_required", "请登录后删除现有任务。");
    return;
  }
  if (task.weekStart >= clusterOnlyLandingWeek && task.siteDomain === "flatkey.ai" && task.kind === "landing"
    && productionStates.has(task.status) && previous?.status !== task.status) {
    reject("flatkey_new_landing_stopped", "Flatkey 暂停新建落地页；保留原任务历史，不能换站点或新建替代任务");
  }
  if (actor !== "human" && task.source === "human" && previous?.source !== "human") reject("human_task_source_required", "只有用户操作可创建明确人工目标，采集器不能伪造人工来源");
  if (previous?.branchObservation && (!task.branchObservation || Date.parse(task.branchObservation.observedAt) < Date.parse(previous.branchObservation.observedAt))) reject("branch_observation_stale", "请保留最近一次分支核对结果");
  if (previous?.codeSource && (!task.codeSource || previous.codeSource.repository !== task.codeSource.repository || previous.codeSource.branch !== task.codeSource.branch)) reject("page_branch_immutable", "同一页面任务沿用原工作分支");
  if (task.codeSource && tasksUsingBranch(all, task)) reject("page_branch_in_use", "该分支已关联另一页面任务，请使用独立分支");
  if (previous?.changeScope === "search_intent" && task.changeScope !== previous.changeScope) reject("intent_scope_immutable", "搜索意图整改需保留逐页审批");
  if (previous && (previous.channel === "product" || task.channel === "product") && previous.channel !== task.channel) reject("product_task_channel_immutable", "产品技术任务不能更换渠道；请新建独立任务");
  const tasks = all.filter(row => row.kind === "task").map(row => row.record as WorkflowTask).filter(task => !task.deletedAt);
  const lookup = new Map(tasks.map(row => [row.id, row])); lookup.set(task.id, task);
  if (!previous && task.workClass === "content_refresh") {
    const observed = tasks.filter(other => other.id !== task.id && other.pageUrl === task.pageUrl && other.siteDomain === task.siteDomain && ["published", "verified", "observing"].includes(other.status));
    if (observed.some(other => other.problemKey && other.problemKey === task.problemKey)) reject("refresh_problem_already_delivered", "同一原问题已交付，继续原任务效果复查，不能跨周重建翻新");
    const inWindow = observed.filter(other => all.some(row => row.kind === "publication" && (row.record as WorkflowPublication).taskId === other.id && ["published", "verified"].includes(row.record.status) && now.getTime() - Date.parse((row.record as WorkflowPublication).publishedAt) < 28 * 86400000));
    if (inWindow.length && (!task.maintenance?.refresh?.previousTaskId || !inWindow.some(other => other.id === task.maintenance?.refresh?.previousTaskId) || !task.maintenance.refresh.evidence.length)) reject("refresh_observation_in_progress", "页面仍在28天观察期，新问题须保留原交付关联及独立新事实，不重复翻新凑数");
  }
  if (task.keyword && contentKinds.has(task.kind)) {
    const word = (value: string | null) => value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    if (tasks.some(other => other.id !== task.id && !["published", "verified", "observing"].includes(other.status) && other.weekStart === task.weekStart && other.kind === task.kind && other.siteDomain === task.siteDomain && other.country === task.country && other.language === task.language && other.pageUrl === task.pageUrl && word(other.keyword) === word(task.keyword))) reject("duplicate_content_task", "同周、同页面及国家的相同关键词已有任务；请续跑已有任务");
  }
  if (task.problemKey && tasks.some(other => other.id !== task.id && other.problemKey === task.problemKey && other.siteDomain === task.siteDomain && other.country === task.country && other.language === task.language && !["published", "verified", "observing"].includes(other.status))) reject("duplicate_problem_task", "已有跨周原任务处理此问题，请沿原ID续跑");
  if (task.workflowContract === "growth-v1.5" && contentKinds.has(task.kind) && productionStates.has(task.status)) {
    const review = task.researchReview;
    if (!task.keywordId || !task.topicId) reject("growth_target_identity_required", "正式内容任务须关联本站原关键词及真实话题");
    if (!review || review.country !== task.country || review.language !== task.language || review.keyword !== task.keyword || new Set(review.serpResults).size !== 10 || new Set(review.openedResults).size < 5 || review.openedResults.some(url => !review.serpResults.includes(url)) || review.serpResults.slice(0, 5).some(url => !review.openedResults.includes(url))) reject("growth_research_incomplete", "需保存原词原市场Top10、实际打开前5页及六项质量与E-E-A-T补证");
    if (Date.parse(review.reviewedAt) > Date.now() + 300_000 || Date.parse(review.duplicateCheckedAt) > Date.now() + 300_000) reject("growth_research_future", "研究与去重证据不能来自未来");
  }
  for (const dependency of task.dependencies) if (!lookup.has(dependency)) reject("dependency_missing", `依赖任务不存在：${dependency}`);
  const visit = (id: string, path: Set<string>) => { if (path.has(id)) reject("dependency_cycle", "任务依赖构成循环"); const next = new Set(path).add(id); for (const dep of lookup.get(id)?.dependencies ?? []) visit(dep, next); };
  visit(task.id, new Set());
  if (["drafting", "approved", "published", "verified", "observing"].includes(task.status)) {
    for (const dependency of task.dependencies) if (!["verified", "observing"].includes(lookup.get(dependency)!.status)) reject("dependency_incomplete", `前置任务尚未验收：${dependency}`);
  }
  if (previous && actor === "collector" && (previous.source === "human" || previous.approval?.kind === "explicit")) {
    for (const key of ["title", "keyword", "keywordId", "country", "language", "business", "pageType", "pageUrl", "owner", "dueAt", "dependencies", "acceptanceCriteria", "contentVersion", "artifactUrl", "codeSource"] as const) {
      if (!same(previous[key], task[key])) reject("human_field_conflict", `人工确认字段发生冲突：${key}；请保留双方版本供审核`);
    }
  }
  if (contentKinds.has(task.kind) && productionStates.has(task.status)) {
    if (!task.research || !task.research.evidence.length || task.research.businessValue === null) reject("research_missing", "开始制作前需要真实关键词研究、业务价值及证据");
    const normal = task.research.volume !== null && task.research.volume >= 10 && task.research.kd !== null && task.research.kd < 30;
    if (!normal && !task.research.exceptionReason) reject("keyword_threshold", "默认优先搜索量 ≥10、KD＜30；例外须记录业务理由");
  }
  if (["review_pending", "approved", "published", "verified", "observing"].includes(task.status) && contentKinds.has(task.kind) && (!task.contentVersion || !task.evidence.length)) reject("content_version_missing", "审核及上线必须对应内容版本和产物证据");
  if (["verified", "observing"].includes(task.status) && !task.evidence.length) reject("verification_evidence_missing", "完成任务必须保留可追溯的验收证据");
  // Legacy task-level approvals are historical context, never new authority.
  if (!same(previous?.approval ?? null, task.approval)) reject("legacy_approval_readonly", "旧任务批准字段只保留历史原值；请使用平台逐页审批单");
  if (task.status === "approved" && (contentKinds.has(task.kind) || task.kind === "technical")) {
    const approvals = approvalRows(all);
    const canonicalApproved = approvals.some(approval => approval.items.some(item => item.taskId === task.id && item.contentVersion === task.contentVersion && (!task.language || item.language === task.language) && (!task.pageUrl || item.pageUrl === task.pageUrl) && workflowApprovalEffectiveItemStatus(approval, item.id, approvals) === "approved"));
    const legacyUnchanged = previous?.status === "approved" && Boolean(previous.approval) && ["contentVersion", "pageUrl", "country", "language", "keyword"].every(key => same(previous[key as keyof WorkflowTask], task[key as keyof WorkflowTask]));
    if (!canonicalApproved && !legacyUnchanged) reject("page_approval_required", "任务标记已批准前必须取得对应版本的逐页审批，旧授权不能代替");
  }
  if (previous && ["published", "verified", "observing"].includes(previous.status) && beforePublication.has(task.status)) reject("published_task_immutable", "已上线任务不得退回草稿；后续修改请创建新任务关联原页面");
  if (["published", "verified", "observing"].includes(task.status) && contentKinds.has(task.kind)) {
    const publications = all.filter(row => row.kind === "publication").map(row => row.record as WorkflowPublication).filter(row => row.taskId === task.id && row.contentVersion === task.contentVersion && !["translation", "backfill_translation"].includes(row.kind));
    if (!publications.some(row => ["published", "verified"].includes(row.status))) reject("publication_missing", "上线状态必须关联真实发布记录");
    if (["verified", "observing"].includes(task.status) && !publications.some(row => row.status === "verified")) reject("verification_missing", "已验收状态需要正式页验收回执");
  }
  const enteringReady = previous && ["planned", "researching"].includes(previous.status) && productionStates.has(task.status);
  const rescheduled = previous && (previous.dueAt !== task.dueAt || previous.weekStart !== task.weekStart);
  const briefChanged = previous && !same(previous.brief, task.brief);
  if (actor === "collector" && taskNeedsChineseBrief(task) && (!previous || enteringReady || rescheduled || briefChanged)) {
    const problems = workflowTaskBriefProblems(task);
    if (problems.length) reject("task_brief_incomplete", problems.join("；"));
  }
}

function assertPlan(plan: WorkflowPlan, previous: WorkflowPlan | undefined, all: WorkflowStoredRow[], now: Date) {
  if (previous && "cadence" in previous.targets && previous.targets.cadence === "growth") {
    if (!("cadence" in plan.targets) || plan.targets.cadence !== "growth" || !same(plan.targets.executionRange, previous.targets.executionRange)) reject("growth_plan_contract_immutable", "保留原growth业务窗口和合同，不能换旧cadence绕过原ID及投入校验");
    if (previous.targets.maintenanceVersion && plan.targets.maintenanceVersion !== previous.targets.maintenanceVersion) reject("maintenance_plan_contract_immutable", "保留原独立翻新契约");
  }
  for (const taskId of plan.committedTaskIds ?? []) if (!plan.taskIds.includes(taskId) && all.some(row => row.kind === "task" && row.record.id === taskId && !(row.record as WorkflowTask).deletedAt)) reject("plan_preserve_committed", "已排原任务不可经降级草稿再移除，保留原ID与排期");

  if (!previous && now >= new Date("2026-11-24T03:00:50.616894Z") && (!("maintenanceVersion" in plan.targets) || plan.targets.maintenanceVersion !== "seo-maintenance-v1")) reject("maintenance_plan_contract_required", "本轮新计划须带独立翻新目标及逐日真实缺口；历史原计划不迁移");
  if (!previous && now >= new Date("2026-11-23T00:00:00Z") && (!("cadence" in plan.targets) || plan.targets.cadence !== "growth")) reject("growth_plan_contract_required", "新计划须按完整业务周growth契约核算，历史原计划保持原身份");
  if (previous && previous.weekStart !== plan.weekStart) reject("identity_changed", "计划不能改变所属工作周");
  const tasks = plan.taskIds.map(id => all.find(row => row.kind === "task" && row.record.id === id)?.record as WorkflowTask | undefined);
  const growth = "cadence" in plan.targets && plan.targets.cadence === "growth";
  if (tasks.some(task => !task || !growth && task.weekStart !== plan.weekStart)) reject("plan_task_missing", "计划只能引用同一工作周已有任务");
  if (growth) { assertGrowthPlan(plan, previous, all); return; }
  if ("cadence" in plan.targets && plan.targets.cadence === "workdays") {
    const targets = plan.targets;
    const workdayCount = Array.from({ length: 7 }, (_, index) => shiftWorkflowDay(plan.weekStart, index))
      .filter(day => isSeoWorkday(new Date(day + "T00:00:00+08:00"))).length;
    const expectedLanguages = { en: workdayCount * 2, ja: workdayCount, "pt-BR": workdayCount, "es-ES": workdayCount };
    const clusterOnly = plan.weekStart >= clusterOnlyLandingWeek;
    const expectedLanding = clusterOnly ? 0 : workdayCount;
    const expectedClusterLanding = Math.min(2, workdayCount) + (clusterOnly ? workdayCount : 0);
    if (!same(targets.blogLanguages, expectedLanguages) || targets.apiBlogs + targets.gpuBlogs !== workdayCount * 5
      || targets.landing !== expectedLanding || targets.optimizedPages !== workdayCount * 2 || targets.clusterLanding !== expectedClusterLanding) {
      reject("plan_workday_targets", "排期额度必须与本周法定工作日和补班日一致");
    }
    for (const task of tasks) {
      if (!task || task.deletedAt) reject("plan_task_deleted", "计划不能引用已删除任务");
      if (task.siteDomain === "jev-llm.com" || task.siteDomain === "mochichatbot.com") {
        reject("plan_monitor_only_site", "JEV 与 Mochi 仅做流量观察");
      }
      if (clusterOnly && task.kind === "landing" && !["rackrate.org", "modelfit.cc"].includes(task.siteDomain)) {
        reject("plan_landing_site", "新落地页额度仅分配 RackRate 和 ModelFit；Flatkey 原任务保留待研究历史，不转移身份");
      }
      if (contentKinds.has(task.kind) && !isSeoWorkday(new Date(task.dueAt))) reject("plan_content_nonworkday", "内容制作及优化只安排在法定工作日或官方补班日");
    }
  }
  if (!isExecutableWorkflowPlan(plan.status)) return;
  const previousIds = new Set(previous && isExecutableWorkflowPlan(previous.status) ? previous.taskIds : []);
  for (const task of tasks) {
    if (!task || previousIds.has(task.id) || !taskNeedsChineseBrief(task)) continue;
    const problems = workflowTaskBriefProblems(task);
    if (problems.length) reject("plan_task_brief_incomplete", `任务「${task.title}」不能正式排期：${problems.join("；")}`);
  }
  if (plan.status === "scheduled" && tasks.some(task => task && contentKinds.has(task.kind) && ["planned", "researching"].includes(task.status))) reject("plan_task_not_ready", "自动排期只能领取已具备研究证据的内容任务；未完成研究的候选留在工作台");
  const cadence = "cadence" in plan.targets ? plan.targets.cadence : null;
  const workdays = cadence === "workdays";
  const daily = cadence === "daily" || cadence === "weekday_pages" || workdays;
  const focused = cadence !== null;
  const localDay = (task: WorkflowTask) => new Date(task.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  if (!plan.targets.blogLanguages) reject("plan_language_targets_required", "正式计划须明确四国源文额度");
  // Legacy plans keep their original targets. Hotspots still pass every task
  // qualification above, but do not consume or fill ordinary quota/gaps.
  const ready = tasks.filter((task): task is WorkflowTask => Boolean(task && task.capacityClass !== "authorized_hotspot_extra" && !["planned", "researching", "blocked", "failed"].includes(task.status)));
  const optimized = ready.filter(task => task.kind === "optimization" && task.pageUrl && (daily ? task.siteDomain === "flatkey.ai" : !focused || automaticTaskPolicy(task) === "auto_blog"));
  if (focused) {
    const perDay = new Map<string, Set<string>>();
    for (const task of optimized) {
      const day = localDay(task);
      const pages = perDay.get(day) ?? new Set<string>();
      pages.add(task.pageUrl!);
      perDay.set(day, pages);
    }
    if ([...perDay.values()].some(pages => pages.size > 2)) reject("plan_daily_blog_optimization_quota", daily ? "Flatkey 每天最多安排2个优化页面" : "每天最多安排2篇常规博客优化");
  }
  const landings = ready.filter(task => task.kind === "landing");
  if (cadence === "weekday_pages" && tasks.some(task => task && ["optimization", "landing", "cluster"].includes(task.kind)
    && [0, 6].includes(new Date(localDay(task) + "T00:00:00Z").getUTCDay()))) {
    reject("plan_page_weekend", "页面制作与优化只可排在北京时间周一至周五");
  }
  const flatkeyLandings = landings.filter(task => task.siteDomain === "flatkey.ai");
  if (daily && new Set(flatkeyLandings.map(localDay)).size !== flatkeyLandings.length) reject("plan_daily_landing_quota", "Flatkey 每天最多安排1个新落地页");
  if (plan.targets && "clusterLanding" in plan.targets) {
    const count = landings.length - flatkeyLandings.length;
    if (count > plan.targets.clusterLanding) reject("plan_cluster_landing_quota", `集群站新落地页不能超过本周 ${plan.targets.clusterLanding} 个额度`);
    const gap = plan.gaps.filter(row => row.category === "clusterLanding").reduce((sum, row) => sum + row.count, 0);
    if (plan.targets.clusterLanding - count > gap) reject("plan_cluster_landing_gap_unrecorded", "集群落地页缺口须写入计划");
  }
  const counts = {
    landing: flatkeyLandings.length,
    apiBlogs: ready.filter(task => task.kind === "blog" && task.siteDomain === "flatkey.ai" && task.business === "API").length,
    gpuBlogs: ready.filter(task => task.kind === "blog" && task.siteDomain === "flatkey.ai" && task.business === "GPU").length,
    optimizedPages: new Set(optimized.map(task => task.pageUrl)).size,
  };
  const languageCategories = { en: "blogEn", ja: "blogJa", "pt-BR": "blogPt", "es-ES": "blogEs" } as const;
  const dailyQuota = { en: 2, ja: 1, "pt-BR": 1, "es-ES": 1 };
  const blogs = ready.filter(task => task.kind === "blog" && task.siteDomain === "flatkey.ai");
  for (const language of Object.keys(languageCategories) as (keyof typeof languageCategories)[]) {
    const selected = blogs.filter(task => task.language === language);
    if (focused && selected.length > plan.targets.blogLanguages[language]) reject("plan_weekly_language_quota", `${language} 每周最多安排 ${plan.targets.blogLanguages[language]} 个源文关键词`);
    const gap = Math.max(0, plan.targets.blogLanguages[language] - selected.length);
    if (gap > plan.gaps.filter(row => row.category === languageCategories[language]).reduce((sum, row) => sum + row.count, 0)) reject("plan_language_gap_unrecorded", `${language} 还缺 ${gap} 篇源文；需登记国家语言缺口`);
    const days = new Map<string, number>();
    for (const task of selected) { const day = localDay(task); days.set(day, (days.get(day) ?? 0) + 1); }
    if (cadence !== "focused" && [...days.values()].some(count => count > dailyQuota[language])) reject("plan_daily_language_quota", `${language} 单日源文不能超过 ${dailyQuota[language]} 篇；翻译另记`);
  }
  for (const category of Object.keys(counts) as (keyof typeof counts)[]) {
    if (focused && counts[category] > plan.targets[category]) reject("plan_weekly_quota", `${category} 超过周计划额度`);
    const gap = Math.max(0, plan.targets[category] - counts[category]);
    const recorded = plan.gaps.filter(row => row.category === category).reduce((sum, row) => sum + row.count, 0);
    if (gap > recorded) reject("plan_gap_unrecorded", `${category} 还缺 ${gap} 项；不能把空位或待研究关键词当作已排定产能`);
  }
}

const approvalRows = (all: WorkflowStoredRow[]) => all.filter(row => row.kind === "approval").map(row => row.record as WorkflowApproval);
const decisionInput = (decision: WorkflowApproval["decisions"][number]) => Object.fromEntries(Object.entries(decision).filter(([key]) => key !== "recordedAt"));

function checkApprovalItemContext(item: WorkflowApproval["items"][number], siteDomain: string, all: WorkflowStoredRow[], currentPublicationId?: string) {
  const task = all.find(row => row.kind === "task" && row.record.id === item.taskId)?.record as WorkflowTask | undefined;
  if (!task || task.deletedAt || task.siteDomain !== siteDomain || !["blog", "landing", "optimization", "cluster", "technical"].includes(task.kind)) reject("approval_task_missing", "审批项必须关联同站点真实页面任务，历史归档不能提供发布授权");
  if (contentKinds.has(task.kind) && ["planned", "researching"].includes(task.status)) reject("approval_task_not_ready", "先完成关键词研究并进入制作或待审阶段，再提交页面审批");
  if (item.postPublicationId) {
    const live = all.find(row => row.kind === "publication" && row.record.id === item.postPublicationId)?.record as WorkflowPublication | undefined;
    if (siteDomain === "flatkey.ai" || !live || live.publicationPolicy !== "cluster_post_review" || live.status !== "verified"
      || live.siteDomain !== siteDomain || live.taskId !== task.id || live.pageUrl !== item.pageUrl || live.language !== item.language
      || live.contentVersion !== item.contentVersion || !same(live.clusterRelease?.codeSource, item.codeSource))
      reject("post_publication_unverified", "集群站上线后审核需要同站、同页面和同提交的真实生产发布回执");
    return task;
  }
  const translation = task.kind === "blog" && item.language !== task.language;
  if (!translation && (task.codeSource || item.codeSource) && (!same(task.codeSource, item.codeSource) || item.previewUrl !== task.artifactUrl)) reject("approval_branch_mismatch", "审批须绑定当前页面工作分支、提交和同版本测试链接");
  if (!translation && task.contentVersion !== item.contentVersion) reject("approval_task_version_mismatch", "审批稿件版本与当前任务不一致；请先保留新稿版本");
  if (!translation && task.language && task.language !== item.language || !translation && task.pageUrl && task.pageUrl !== item.pageUrl) reject("approval_task_page_mismatch", "审批页面或语言与任务不一致");
  const known = all.filter(row => row.kind === "publication" && row.record.id !== currentPublicationId).map(row => row.record as WorkflowPublication)
    .filter(row => row.pageUrl === item.pageUrl && row.language === item.language && ["published", "verified"].includes(row.status)).sort((a,b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  const legacy = all.filter(row => row.kind === "historical_import").flatMap(row => (row.record as WorkflowHistoricalImport).publications)
    .filter(row => row.pageUrl === item.pageUrl && row.language === item.language).sort((a,b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  const baseline = known && legacy ? (known.publishedAt >= legacy.publishedAt ? known : legacy) : known ?? legacy;
  if (baseline && (item.operation !== "update" || item.baseContentVersion !== baseline.contentVersion)) reject("approval_baseline_changed", "页面已有上线版本或改前版本已变化；需重新提交具体变更审批");
  if (task.kind === "optimization" && item.operation !== "update") reject("approval_operation_mismatch", "优化旧页面必须按修改提单");
  if (["blocked", "failed"].includes(task.status)) reject("approval_task_blocked", "任务阻塞或失败，先完成排查再申请发布");
  return task;
}

function assertApproval(value: WorkflowApproval, previous: WorkflowApproval | undefined, all: WorkflowStoredRow[], actor: WorkflowActor) {
  for (const item of value.items) {
    const task = all.find(row => row.kind === "task" && row.record.id === item.taskId)?.record as WorkflowTask | undefined;
    if ((!previous || previous.status === "draft") && value.status !== "draft" && value.siteDomain !== "flatkey.ai" && value.channel !== "github" && !item.postPublicationId) reject("cluster_review_after_release", "集群站先发布并验证，再提交上线后审核");
    if ((!previous || previous.status === "draft") && value.status !== "draft" && task && !approvalItemNeedsHuman(item, [task]))
      reject("approval_not_needed", "关键词研究和常规博客不需要提交页面审批");
    if ((value.channel === "product" || task?.channel === "product") && (value.channel !== "product" || task?.channel !== "product" || task.kind !== "technical")) reject("approval_product_task_required", "产品渠道审批必须关联同渠道技术任务");
  }
  if (!previous && value.decisions.length) reject("approval_submission_required", "先保存待审单，再由负责人追加逐项审批决定");
  if (previous && previous.status !== "draft") {
    for (const key of ["weekStart", "title", "channel", "requestedBy", "submittedAt", "items", "supersedesApprovalIds", "evidence"] as const) if (!same(previous[key], value[key])) reject("approval_content_immutable", "已提交审批内容不可改写；改稿需新版本和新审批单");
    if (value.status === "draft") reject("approval_content_immutable", "已提交审批不能退回草稿");
  }
  const oldDecisions = previous?.decisions ?? [];
  if (value.decisions.length < oldDecisions.length || !same(oldDecisions.map(decisionInput), value.decisions.slice(0, oldDecisions.length).map(decisionInput))) reject("approval_decision_immutable", "审批决定及证据只能追加，不能删除或改写");
  const appended = value.decisions.slice(oldDecisions.length);
  if (appended.length && actor !== "human") reject("human_approval_required", "只有负责人登录平台后才能批准、拒绝、要求修改或撤回审批");
  if (appended.length && (!previous || previous.status === "draft")) reject("approval_submission_required", "必须先正式提交待审单，再作审批决定");
  const decided = [...oldDecisions];
  for (const decision of appended) {
    if (!value.submittedAt || Date.parse(decision.decidedAt) < Date.parse(value.submittedAt) || decided.length && Date.parse(decision.decidedAt) < Date.parse(decided.at(-1)!.decidedAt)) reject("approval_decision_time", "审批决定时间不能早于提交或之前决定");
    for (const itemId of decision.itemIds) {
      const before = workflowApprovalItemStatus({ decisions: decided }, itemId);
      if (before !== "pending" && !(before === "approved" && ["withdrawn", "superseded"].includes(decision.decision))) reject("approval_decision_transition", "已拒绝、要求修改、撤回或替换的稿件不能重新批准；请新建稿件版本审批");
      if (decision.decision === "approved") {
        if (workflowApprovalEffectiveItemStatus({ ...value, decisions: decided }, itemId, approvalRows(all)) === "superseded") reject("approval_superseded", "此稿件已有替换审批，旧稿不能再批准");
        const item = value.items.find(item => item.id === itemId)!;
        const task = all.find(row => row.kind === "task" && row.record.id === item.taskId)?.record as WorkflowTask | undefined;
        if (task && !approvalItemNeedsHuman(item, [task])) reject("approval_not_needed", "关键词研究和常规博客不需要页面审批");
        const readiness = approvalReviewReadiness(item);
        if (!readiness.ready) reject("approval_preview_missing", "批准前须补齐：" + readiness.missing.join("、"));
        checkApprovalItemContext(item, value.siteDomain, all);
      }
    }
    decided.push(decision);
  }
  if (!previous || previous.status === "draft") {
    for (const item of value.items) checkApprovalItemContext(item, value.siteDomain, all);
    if (value.status !== "draft") {
      if (value.items.some(item => item.postPublicationId) && !value.items.every(item => item.postPublicationId)) reject("approval_mode_mixed", "上线前和上线后审核不能混用同一单");
      const tasks = all.filter(row => row.kind === "task").map(row => row.record as WorkflowTask).filter(task => !task.deletedAt);
      for (const item of value.items.filter(item => approvalItemNeedsHuman(item, tasks))) {
        const readiness = approvalReviewReadiness(item);
        if (!readiness.ready) reject("approval_preview_missing", "送审前须补齐：" + readiness.missing.join("、"));
      }
      const others = approvalRows(all).filter(other => other.id !== value.id && other.status !== "draft");
      for (const priorId of value.supersedesApprovalIds) {
        const prior = others.find(other => other.id === priorId);
        if (!prior || prior.siteDomain !== value.siteDomain || !prior.items.some(old => value.items.some(item => item.pageUrl === old.pageUrl && item.language === old.language))) reject("approval_supersession_invalid", "替换关系必须指向同站点、同页面语言的已有审批单");
      }
      for (const item of value.items) for (const other of others) {
        const priorItem = other.items.find(old => old.pageUrl === item.pageUrl && old.language === item.language);
        if (!priorItem) continue;
        if (priorItem.contentVersion === item.contentVersion) {
          const postReleaseReplacement = Boolean(item.postPublicationId && !priorItem.postPublicationId && value.supersedesApprovalIds.includes(other.id) && same(priorItem.codeSource, item.codeSource));
          const materialOnly = value.supersedesApprovalIds.includes(other.id)
            && workflowApprovalEffectiveItemStatus(other, priorItem.id, others) === "pending"
            && !approvalReviewReadiness(priorItem).ready
            && (["taskId", "operation", "baseContentVersion", "reviewContent", "reviewFormat", "beforeContent", "codeSource"] as const)
              .every(key => same(priorItem[key], item[key]));
          if (!materialOnly && !postReleaseReplacement) reject("approval_version_reused", "该页面语言版本已有审批；改稿必须新版本，不能重建审批绕过决定");
        }
        if (workflowApprovalEffectiveItemStatus(other, priorItem.id, others) !== "superseded" && !value.supersedesApprovalIds.includes(other.id)) reject("approval_supersession_required", "同页面语言已有审批单；新稿须明确替换旧单以阻止旧稿并发发布");
      }
    }
  }
}

export function checkWorkflowApproval(input: WorkflowApprovalCheck, all: WorkflowStoredRow[], now = new Date()) {
  const approvals = approvalRows(all), approval = approvals.find(row => row.id === input.approvalId);
  if (!approval || approval.status === "draft") reject("publication_unapproved", "缺少已提交并经负责人批准的逐页审批单");
  const item = approval.items.find(item => item.id === input.itemId);
  if (!item || item.taskId !== input.taskId || item.pageUrl !== input.pageUrl || item.language !== input.language || item.contentVersion !== input.contentVersion) reject("publication_approval_mismatch", "审批项与待发布 URL、语言、任务或内容版本不匹配");
  if (item.postPublicationId || approval.siteDomain !== "flatkey.ai" && approval.channel !== "github") reject("post_publication_only", "上线后审核不会提供生产发布授权");
  if (workflowApprovalEffectiveItemStatus(approval, item.id, approvals) !== "approved") reject("publication_unapproved", "该页面版本尚未批准，或审批已撤回、要求修改、被新稿替换");
  const decision = [...approval.decisions].reverse().find(decision => decision.itemIds.includes(item.id))!;
  if (!decision.recordedAt) reject("publication_approval_unverified", "审批缺少服务器记录的决定时刻");
  const readiness = approvalReviewReadiness(item);
  if (!readiness.ready) reject("approval_preview_missing", "发布前须补齐：" + readiness.missing.join("、"));
  const task = checkApprovalItemContext(item, approval.siteDomain, all);
  if (!approvalItemNeedsHuman(item, [task])) reject("approval_not_needed", "常规博客按 CMS 自动发布流程执行");
  for (const dependency of task.dependencies) if (!all.some(row => row.kind === "task" && row.record.id === dependency && ["verified", "observing"].includes(row.record.status))) reject("dependency_incomplete", "前置任务尚未验收，不能发布");
  return { allowed: true as const, request: { ...input }, approvalId: approval.id, itemId: item.id, decisionId: decision.id, decisionVersion: approval.version, decisionRecordedAt: decision.recordedAt, checkedAt: now.toISOString() };
}

function assertPublication(value: WorkflowPublication, previous: WorkflowPublication | undefined, all: WorkflowStoredRow[]) {
  const task = all.find(row => row.kind === "task" && row.record.id === value.taskId)?.record as WorkflowTask | undefined;
  if (!task || (task.deletedAt && !previous) || task.siteDomain !== value.siteDomain || task.weekStart !== value.weekStart) reject("publication_task_missing", "发布记录需要对应同站点工作任务");
  const originalVerifiedQa = previous?.status === "verified" && same(previous.maintenanceQa, value.maintenanceQa);
  const maintenanceProblems = originalVerifiedQa ? [] : [...maintenancePublicationProblems(task, value), ...maintenanceHistoryProblems(task, maintenanceHistory(all), value)];
  if (maintenanceProblems.length) reject("maintenance_qa_incomplete", maintenanceProblems.join("；"));
  const automatic = value.publicationPolicy;
  // A first-delivery CMS correction belongs to the original blog task. Keep
  // its initial source receipt immutable and record the correction as an
  // optimization, without creating another source or changing task identity.
  const accepted = all.filter(row => row.kind === "publication" && row.record.id !== value.id)
    .map(row => row.record as WorkflowPublication)
    .filter(row => row.pageUrl === value.pageUrl && ["published", "verified"].includes(row.status));
  const deliveryBaseline = [...accepted].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
  const firstPageReceipt = accepted.find(row => row.taskId === task.id
    && ["source_blog", "translation", "backfill_translation"].includes(row.kind));
  const correctingTranslation = Boolean(firstPageReceipt
    && ["translation", "backfill_translation"].includes(firstPageReceipt.kind));
  const correctionSource = correctingTranslation ? all.find(row => row.kind === "publication"
    && row.record.id === firstPageReceipt?.sourcePublicationId)?.record as WorkflowPublication | undefined : firstPageReceipt;
  const firstDeliveryCorrection = automatic === "auto_blog" && value.kind === "optimization"
    && task.kind === "blog" && task.status === "published"
    && firstPageReceipt?.status === "published"
    && correctionSource?.taskId === task.id && correctionSource.kind === "source_blog"
    && ["published", "verified"].includes(correctionSource.status)
    && correctionSource.siteDomain === task.siteDomain && correctionSource.pageUrl === task.pageUrl
    && correctionSource.country === task.country && correctionSource.language === task.language
    && correctionSource.keyword === task.keyword
    && deliveryBaseline?.taskId === task.id && deliveryBaseline.status === "published"
    && deliveryBaseline.siteDomain === task.siteDomain && deliveryBaseline.country === value.country
    && deliveryBaseline.language === value.language && deliveryBaseline.keyword === value.keyword
    && value.sourcePublicationId === null
    && value.automaticWrite?.operation === "update"
    && deliveryBaseline.contentVersion === value.automaticWrite.baseContentVersion
    && Date.parse(value.publishedAt) >= Date.parse(deliveryBaseline.publishedAt)
    && (correctingTranslation || task.contentVersion === value.automaticWrite.baseContentVersion
      || Boolean(previous && previous.contentVersion === value.contentVersion && task.contentVersion === value.contentVersion))
    && Boolean(deliveryBaseline.automaticWrite?.sourceId)
    && value.automaticWrite.sourceId === deliveryBaseline.automaticWrite?.sourceId;
  if (automatic === "cluster_post_review") {
    if (!value.clusterRelease || !same(task.codeSource, value.clusterRelease.codeSource) || task.channel && task.channel !== "website" || !["landing", "optimization", "cluster", "technical"].includes(task.kind) || ["planned", "researching", "blocked", "failed"].includes(task.status) || (task.branchObservation && task.branchObservation.headSha !== value.contentVersion)) reject("cluster_release_context", "集群站发布必须绑定可执行的逐页任务、独立分支和准确提交");
  } else if (automatic) {
    if (automaticTaskPolicy(task, value.pageUrl) !== automatic) reject("automatic_policy_context", "自动发布必须匹配真实页面模块与任务类型");
    if (["planned", "researching", "blocked", "failed"].includes(task.status)) reject("automatic_task_not_ready", "任务须完成内容准备与质量检查");
    if (automatic === "auto_blog") {
      const plan = all.filter(row => row.kind === "plan" && row.record.weekStart === value.weekStart).map(row => row.record as WorkflowPlan)
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
      if (task.source !== "human" && (!plan || !isExecutableWorkflowPlan(plan.status) || !plan.taskIds.includes(task.id))) reject("automatic_blog_plan_required", "博客自动执行只消费本周最新计划已排期的任务或用户明确设置的任务");
      const prior = all.filter(row => row.kind === "publication" && row.record.id !== value.id).map(row => row.record as WorkflowPublication).filter(row => row.pageUrl === value.pageUrl && ["published", "verified"].includes(row.status));
      const history = all.filter(row => row.kind === "historical_import").flatMap(row => (row.record as WorkflowHistoricalImport).publications).filter(row => row.pageUrl === value.pageUrl);
      const baseline = [...prior, ...history].sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
      if (!previous && baseline && (value.automaticWrite?.operation !== "update" || value.automaticWrite.baseContentVersion !== baseline.contentVersion)) reject("automatic_baseline_changed", "页面已有上线版本；必须对最新版本比较后更新，不能冒称新增");
      if (value.automaticWrite?.operation === "update" && !firstDeliveryCorrection && !all.some(row => row.kind === "optimization" && (row.record as WorkflowOptimization).taskId === task.id && (row.record as WorkflowOptimization).pageUrl === value.pageUrl && Date.parse((row.record as WorkflowOptimization).baseline.capturedAt) <= Date.parse(value.publishedAt))) reject("automatic_baseline_missing", "旧博客更新前必须先保存该页面任务的真实基线，缺数如实保留");
    }
  }
  // A previous accepted live receipt can finish verification after withdrawal;
  // withdrawal does not erase a real earlier delivery. New deliveries always recheck.
  if (!automatic && (!previous || !["published", "verified"].includes(previous.status))) {
    const allowed = checkWorkflowApproval({ approvalId: value.approvalId!, itemId: value.approvalItemId!, taskId: value.taskId, pageUrl: value.pageUrl, language: value.language, contentVersion: value.contentVersion }, all);
    if (Date.parse(value.publishedAt) < Date.parse(allowed.decisionRecordedAt)) reject("publication_before_approval", "实际发布时间不能早于服务器保存的负责人审批决定");
  }
  const isTranslation = ["translation", "backfill_translation"].includes(value.kind);
  const expectedKind = isTranslation || value.kind === "source_blog" ? "blog" : value.kind;
  if (task.kind !== expectedKind && !firstDeliveryCorrection && !(task.kind === "technical" && ["optimization", "landing", "prompt"].includes(value.kind))) reject("publication_kind_mismatch", "发布类型与任务不符；源文、落地页和优化不能混计");
  const approvedItem = approvalRows(all).find(row => row.id === value.approvalId)?.items.find(item => item.id === value.approvalItemId);
  if (!automatic && approvedItem?.operation !== (value.kind === "optimization" ? "update" : "new")) reject("publication_operation_mismatch", "新页面须按新增交付记录，修改旧页才按优化记录");
  if (!isTranslation && !firstDeliveryCorrection && task.contentVersion !== value.contentVersion) reject("publication_version_mismatch", "发布版本不属于已批准内容");
  if (!isTranslation && !(firstDeliveryCorrection && correctingTranslation) && task.pageUrl && task.pageUrl !== value.pageUrl) reject("publication_page_mismatch", "正式页面与批准任务的 URL 不一致");
  if (!isTranslation && !(firstDeliveryCorrection && correctingTranslation) && (value.country !== task.country || (task.language !== null && value.language !== task.language) || value.keyword !== task.keyword)) reject("publication_market_mismatch", "发布国家、语言或主词与任务不一致");
  if (isTranslation) {
    const source = all.find(row => row.kind === "publication" && row.record.id === value.sourcePublicationId)?.record as WorkflowPublication | undefined;
    if (!source || source.kind !== "source_blog" || source.siteDomain !== value.siteDomain || source.taskId !== task.id) reject("translation_source_missing", "翻译必须关联同任务真实源文");
  }
  for (const row of all.filter(row => row.kind === "publication" && row.record.id !== value.id)) {
    const other = row.record as WorkflowPublication;
    // A mistakenly classified, still-unverified translation can be retained as
    // failed audit history. Its exact CMS hash may then be recorded correctly
    // as a first-delivery update, never as another source/translation create.
    const quarantinedTranslation = firstDeliveryCorrection && correctingTranslation
      && other.status === "failed" && !other.verificationRecordedAt && other.verifiedAt === null
      && ["translation", "backfill_translation"].includes(other.kind)
      && other.taskId === value.taskId && other.siteDomain === value.siteDomain
      && other.country === value.country && other.language === value.language && other.keyword === value.keyword
      && other.sourcePublicationId === firstPageReceipt?.sourcePublicationId
      && other.publicationPolicy === "auto_blog" && other.automaticWrite?.operation === "create"
      && other.automaticWrite.sourceId === value.automaticWrite?.sourceId
      && Boolean(other.failureReason?.trim()) && other.evidence.length > 0;
    if (other.pageUrl === value.pageUrl && other.contentVersion === value.contentVersion && !quarantinedTranslation) reject("duplicate_publication", "同一规范页面及版本已有发布记录，请续写原记录");
  }
  if (all.some(row => row.kind === "historical_import" && (row.record as WorkflowHistoricalImport).publications.some(item => item.pageUrl === value.pageUrl && item.contentVersion === value.contentVersion))) reject("duplicate_historical_publication", "该页面版本已有历史归档，不能作为本次新增发布重复计数");
  if (previous) {
    if (previous.maintenanceQa && !same(previous.maintenanceQa, value.maintenanceQa)) reject("maintenance_qa_immutable", "实际维护验收证据不可撤写");
    for (const key of ["taskId", "approvalId", "approvalItemId", "publicationPolicy", "automaticWrite", "clusterRelease", "siteDomain", "pageUrl", "country", "language", "keyword", "contentVersion", "kind", "sourcePublicationId", "publishedAt"] as const) if (!same(previous[key], value[key])) reject("publication_identity_changed", "已有发布身份和真实发布时间不可覆盖");
    if (previous.status === "verified" && (!same(previous.liveCheck, value.liveCheck) || previous.verifiedAt !== value.verifiedAt || value.status !== "verified")) reject("verification_immutable", "已验收事实不可撤写；新增问题或新版本保留审计历史");
  }
}

function assertOptimization(value: WorkflowOptimization, previous: WorkflowOptimization | undefined, all: WorkflowStoredRow[]) {
  const task = all.find(row => row.kind === "task" && row.record.id === value.taskId)?.record as WorkflowTask | undefined;
  if (!task || task.kind !== "optimization" || task.pageUrl !== value.pageUrl || task.country !== value.country || task.siteDomain !== value.siteDomain) reject("optimization_task_missing", "优化必须关联同页面、国家的旧页任务");
  if (previous) {
    if (!same(previous.baseline, value.baseline)) reject("baseline_immutable", "优化前基线不可覆盖；追加变更和观察版本");
    if (!same(previous.changes, value.changes.slice(0, previous.changes.length)) || !same(previous.observations, value.observations.slice(0, previous.observations.length))) reject("history_immutable", "变更和观察记录只能追加");
  }
  const verifiedPublicationTimes = new Map<string, string>();
  for (const change of value.changes) {
    if (!change.publicationId) continue;
    const publication = all.find(row => row.kind === "publication" && row.record.id === change.publicationId)?.record as WorkflowPublication | undefined;
    if (!publication || publication.taskId !== value.taskId || publication.pageUrl !== value.pageUrl || publication.contentVersion !== change.contentVersion || publication.kind !== "optimization") reject("optimization_publication_missing", "优化版本需要对应已批准的发布记录");
    if (Date.parse(value.baseline.capturedAt) > Date.parse(publication.publishedAt)) reject("baseline_after_publication", "发布后不能补造优化前基线");
    if (publication.status === "verified") verifiedPublicationTimes.set(change.id, publication.publishedAt);
  }
  const comparisonProblems = optimizationComparisonProblems(value, verifiedPublicationTimes, previous);
  if (comparisonProblems.length) reject("invalid_optimization_comparison", comparisonProblems.join("；"));
  if (["published", "verified", "observing"].includes(value.status)) {
    const publications = value.changes.flatMap(change => all.filter(row => row.kind === "publication" && row.record.id === change.publicationId).map(row => row.record as WorkflowPublication));
    if (!publications.some(row => value.status === "published" ? ["published", "verified"].includes(row.status) : row.status === "verified")) reject("optimization_not_live", "草稿或未验收优化不能计为上线");
  }
}

export function prepareWorkflowMutation(input: unknown, all: WorkflowStoredRow[], actor: WorkflowActor, now = new Date()) {
  const mutation = workflowMutationSchema.parse(input), kind = ACTION_KIND[mutation.action];
  const parsed = WORKFLOW_SCHEMAS[kind].parse(mutation.record);
  const checkTimes = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (["originalPublishedAt", "preservedPublishedAt", "modifiedAt", "publishedAt", "verifiedAt", "firstVerifiedAt", "observedAt", "checkedAt", "capturedAt", "preparedAt", "reviewedAt", "approvedAt", "startedAt", "completedAt", "sourceStartedAt", "sourceCompletedAt", "sourceSnapshotAt", "firstSeenAt", "resolvedAt", "changedAt", "submittedAt", "decidedAt"].includes(key) && typeof entry === "string" && Date.parse(entry) > now.getTime() + 300_000) reject("future_evidence", "事实或验收时间不能在未来");
      checkTimes(entry);
    }
  };
  checkTimes(parsed);
  if (kind === "run") { const run = parsed as WorkflowRun; if (run.completedAt && Date.parse(run.completedAt) < Date.parse(run.startedAt)) reject("run_time_order", "完成时间不能早于开始时间"); }
  const previous = all.find(row => row.kind === kind && row.record.id === parsed.id)?.record;
  if ((previous?.version ?? 0) !== mutation.expectedVersion) reject("version_conflict", "记录已被其他任务修改；请重新读取并保留人工变更");
  const stamp = now.toISOString();
  const deletingTask = kind === "task" && Boolean((parsed as WorkflowTask).deletedAt);
  const record = { ...(deletingTask && previous ? { ...previous, deletedAt: stamp } : parsed), version: (previous?.version ?? 0) + 1, recordedAt: previous?.recordedAt ?? stamp, updatedAt: stamp,
    ...(kind === "approval" ? { submittedRecordedAt: (previous as WorkflowApproval | undefined)?.submittedRecordedAt ?? ((parsed as WorkflowApproval).status !== "draft" ? stamp : null), decisions: (parsed as WorkflowApproval).decisions.map((decision, index) => ({ ...decision, recordedAt: (previous as WorkflowApproval | undefined)?.decisions[index]?.recordedAt ?? stamp })) } : {}),
    ...(kind === "publication" ? { verificationRecordedAt: (previous as WorkflowPublication | undefined)?.verificationRecordedAt ?? ((parsed as WorkflowPublication).status === "verified" ? stamp : null) } : {}),
    ...(kind === "historical_import" ? { publications: (parsed as WorkflowHistoricalImport).publications.map(item => ({ ...item, verificationRecordedAt: item.verificationState === "live_verified" ? stamp : null })) } : {}),
  } as WorkflowRecord;
  if (previous && "siteDomain" in previous && "siteDomain" in record && previous.siteDomain !== record.siteDomain) reject("identity_changed", "记录站点不能改变");
  if (kind === "approval") assertApproval(record as WorkflowApproval, previous as WorkflowApproval | undefined, all, actor);
  if (kind === "task") {
    const task = record as WorkflowTask;
    const oldTask = previous as WorkflowTask | undefined;
    // The server selects the new contract for new content; clients cannot opt out
    // by dropping the field. Original persisted records retain their old contract.
    if ((contentKinds.has(task.kind) || task.workClass) && (!oldTask && now >= new Date("2026-11-23T00:00:00Z") || oldTask?.workflowContract === "growth-v1.5")) task.workflowContract = "growth-v1.5";
    if (task.workClass === undefined && oldTask?.workClass) task.workClass = oldTask.workClass;
    if (task.maintenance === undefined && oldTask?.maintenance) task.maintenance = oldTask.maintenance;
    // Older executors may omit the display-only Chinese brief on progress updates.
    if (!task.brief && oldTask?.brief) task.brief = oldTask.brief;
    if (task.progress?.length || oldTask?.progress?.length) {
      const progress = new Map((oldTask?.progress ?? []).map(entry => [entry.id, entry]));
      for (const entry of task.progress ?? []) {
        const saved = progress.get(entry.id);
        if (saved && !same(saved, entry)) reject("progress_conflict", "已保存的进度回执不能改写，请记录新的核对结果");
        progress.set(entry.id, entry);
      }
      task.progress = [...progress.values()]
        .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.id.localeCompare(b.id)).slice(-100);
    }
    assertTask(task, oldTask, all, actor, now);
  }
  if (kind === "plan") {
    const plan = record as WorkflowPlan, prior = previous as WorkflowPlan | undefined;
    const committed = [...new Set([...(prior?.committedTaskIds ?? []), ...(prior && isExecutableWorkflowPlan(prior.status) ? prior.taskIds : []), ...(isExecutableWorkflowPlan(plan.status) ? plan.taskIds : [])])];
    if (committed.length || prior?.committedTaskIds !== undefined || prior && isExecutableWorkflowPlan(prior.status) || isExecutableWorkflowPlan(plan.status)) plan.committedTaskIds = committed;
    else delete plan.committedTaskIds;
    assertPlan(plan, prior, all, now);
  }
  if (kind === "publication") {
    const publication = record as WorkflowPublication;
    if (publication.maintenanceQa === undefined && (previous as WorkflowPublication | undefined)?.maintenanceQa) publication.maintenanceQa = (previous as WorkflowPublication).maintenanceQa;
    assertPublication(publication, previous as WorkflowPublication | undefined, all);
  }
  if (kind === "optimization") assertOptimization(record as WorkflowOptimization, previous as WorkflowOptimization | undefined, all);
  if (kind === "run" && (previous as WorkflowRun | undefined)?.status === "completed") reject("run_completed", "已完成回执不可回退；修正请增加单独复核记录");
  if (kind === "run" && (record as WorkflowRun).stage === "CLUSTER_ROLLBACK") {
    const run = record as WorkflowRun;
    const rollback = workflowClusterRollbackCandidates({ approvals: approvalRows(all),
      publications: all.filter(row => row.kind === "publication").map(row => row.record as WorkflowPublication),
      runs: all.filter(row => row.kind === "run").map(row => row.record as WorkflowRun) })
      .find(candidate => candidate.runId === run.id);
    if (!rollback || !mutation.claim || run.taskIds.length !== 1 || run.taskIds[0] !== rollback.taskId || run.inputVersion !== rollback.contentVersion)
      reject("cluster_rollback_context", "撤销回执必须关联当前拒绝决定、线上版本和执行租约");
    if (run.status === "completed" && (!run.evidence.some(row => row.url === rollback.pageUrl) || !run.evidence.some(row => row.url?.startsWith(`https://github.com/${rollback.release.codeSource.repository}/actions/runs/`) && row.url !== rollback.release.deploymentUrl)))
      reject("cluster_rollback_unverified", "完成撤销需核验正式页面及区别于原发布的部署回执");
  }
  if (kind === "historical_import") {
    const historical = record as WorkflowHistoricalImport;
    if (previous) reject("historical_import_immutable", "历史导入是不可变证据归档，不能改写为新发布授权或覆盖原记录");
    for (const row of all) {
      if (row.kind === "historical_import") {
        const other = row.record as WorkflowHistoricalImport;
        if (other.manifestHash === historical.manifestHash || other.sourceRunId === historical.sourceRunId) reject("duplicate_historical_import", "此历史运行已有档案，重复请求请使用同一幂等编号");
        if (historical.publications.some(item => other.publications.some(existing => existing.cmsId === item.cmsId || existing.pageUrl === item.pageUrl && existing.contentVersion === item.contentVersion))) reject("duplicate_historical_publication", "历史页面及版本已有档案，不能重复计数");
      }
      if (row.kind === "publication" && historical.publications.some(item => item.pageUrl === (row.record as WorkflowPublication).pageUrl && item.contentVersion === (row.record as WorkflowPublication).contentVersion)) reject("duplicate_historical_publication", "该页面版本已在正常发布台账记录，不能再次导入");
    }
  }
  return { mutation, kind, record, key: workflowKey(kind, record.id), requestHash: workflowHash(mutation) };
}

export const FIRST_OPERATIONAL_WEEK = "2026-11-16";

function isCodexTrackedTask(task: WorkflowTask) {
  return task.kind === "technical" && task.channel === "product" && task.source === "automation" &&
    task.sourceRowId === task.id && /^codex-thread:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(task.id);
}

export function workflowSnapshot(all: WorkflowStoredRow[], options: { week?: string; pageUrl?: string; allHistory?: boolean; operational?: boolean; workList?: boolean }, storage: WorkflowSnapshot["storage"], now = new Date()): WorkflowSnapshot {
  const current = workflowWeek(now);
  const weekStart = options.week === "next" ? shiftWorkflowDay(current, 7) : options.week === "latest" ? all.filter(row => row.kind === "plan").map(row => row.record.weekStart).sort().at(-1) ?? current : !options.week || options.week === "current" ? current : options.week;
  const belongs = (row: WorkflowStoredRow) => options.pageUrl ? "pageUrl" in row.record && row.record.pageUrl === options.pageUrl : options.allHistory || row.record.weekStart === weekStart;
  const tasks = all.filter(row => row.kind === "task" && belongs(row)).map(row => row.record as WorkflowTask).filter(task => !task.deletedAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const taskIds = new Set(tasks.map(task => task.id));
  const plans = all.filter(row => row.kind === "plan" && row.record.weekStart === weekStart).map(row => row.record as WorkflowPlan).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const publications = all.filter(row => row.kind === "publication" && belongs(row)).map(row => row.record as WorkflowPublication).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const allApprovals = approvalRows(all);
  const approvalTasks = all.filter(row => row.kind === "task").map(row => row.record as WorkflowTask);
  const approvals = allApprovals.filter(row => options.pageUrl ? row.items.some(item => item.pageUrl === options.pageUrl) : options.allHistory || row.weekStart === weekStart || row.items.some(item => workflowApprovalEffectiveItemStatus(row, item.id, allApprovals) === "pending"));
  const historicalImports = all.filter(row => row.kind === "historical_import" && (options.pageUrl ? (row.record as WorkflowHistoricalImport).publications.some(item => item.pageUrl === options.pageUrl) : belongs(row))).map(row => row.record as WorkflowHistoricalImport);
  const optimizations = all.filter(row => row.kind === "optimization" && belongs(row)).map(row => row.record as WorkflowOptimization);
  const issues = all.filter(row => row.kind === "issue" && (belongs(row) || !options.pageUrl && (row.record as WorkflowIssue).status !== "resolved")).map(row => row.record as WorkflowIssue);
  const runs = all.filter(row => row.kind === "run" && (options.pageUrl ? (row.record as WorkflowRun).taskIds.some(id => taskIds.has(id)) : belongs(row))).map(row => row.record as WorkflowRun).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const verified = publications.filter(row => row.status === "verified");
  const blogTaskIds = new Set(approvalTasks.filter(task => task.kind === "blog").map(task => task.id));
  const refreshTaskIds = new Set(approvalTasks.filter(task => task.workClass === "content_refresh").map(task => task.id));
  const deliveryKey = (row: WorkflowPublication) => JSON.stringify([row.taskId, row.pageUrl]);
  const verifiedSources = new Set(verified.filter(row => row.kind === "source_blog").map(deliveryKey));
  const verifiedTranslations = new Set(verified.filter(row => ["translation", "backfill_translation"].includes(row.kind)).map(deliveryKey));
  for (const revision of verified.filter(row => row.kind === "optimization" && blogTaskIds.has(row.taskId))) {
    const original = publications.find(row => row.taskId === revision.taskId && row.pageUrl === revision.pageUrl
      && ["published", "verified"].includes(row.status) && ["source_blog", "translation", "backfill_translation"].includes(row.kind));
    if (original?.kind === "source_blog") verifiedSources.add(deliveryKey(original));
    else if (original) verifiedTranslations.add(deliveryKey(original));
  }
  const snapshot = { weekStart, weekEnd: shiftWorkflowDay(weekStart, 6), plan: plans[0] ?? null, approvals, tasks, publications, historicalImports, optimizations, issues, runs, storage, generatedAt: now.toISOString(), summary: {
    tasks: tasks.length, blocked: tasks.filter(task => ["blocked", "failed"].includes(task.status)).length, reviewPending: tasks.filter(task => task.status === "review_pending" && task.kind !== "research" && !automaticTaskPolicy(task)).length,
    pendingApprovalItems: approvals.reduce((sum, row) => sum + row.items.filter(item => workflowApprovalEffectiveItemStatus(row, item.id, allApprovals) === "pending" && approvalItemNeedsHuman(item, approvalTasks) && approvalReviewReadiness(item).ready).length, 0),
    pendingApprovals: approvals.filter(row => row.items.some(item => workflowApprovalEffectiveItemStatus(row, item.id, allApprovals) === "pending" && approvalItemNeedsHuman(item, approvalTasks) && approvalReviewReadiness(item).ready)).length,
    verifiedSourceBlogs: verifiedSources.size, verifiedTranslations: verifiedTranslations.size,
    verifiedLandingPages: verified.filter(row => row.kind === "landing").length, optimizedPages: new Set(verified.filter(row => row.kind === "optimization" && !blogTaskIds.has(row.taskId) && !refreshTaskIds.has(row.taskId)).map(row => row.pageUrl)).size,
    ...(refreshTaskIds.size ? { refreshedPages: new Set(verified.filter(row => row.kind === "optimization" && refreshTaskIds.has(row.taskId) && approvalTasks.some(task => task.id === row.taskId && task.pageUrl === row.pageUrl && task.country === row.country && task.language === row.language)).map(row => row.pageUrl)).size } : {}),
    openIssues: issues.filter(issue => issue.status !== "resolved").length, lastRunAt: runs[0]?.startedAt ?? null,
  } };
  if (!options.operational) return snapshot;
  return operationalWorkflowSnapshot(snapshot, all, options.workList === true, now);
}

function operationalWorkflowSnapshot(snapshot: WorkflowSnapshot, all: WorkflowStoredRow[], workList: boolean, now: Date): WorkflowSnapshot {
  const today = seoToday(now);
  const range = workWeekDateRange(today);
  const finalPlanWeek = workflowWeek(new Date(range.end + "T00:00:00+08:00"));
  const dueDay = (task: WorkflowTask) => seoToday(new Date(task.dueAt));
  const plansByWeek = new Map<string, WorkflowPlan>();
  for (const { kind, record } of all) {
    if (kind !== "plan" || record.weekStart < FIRST_OPERATIONAL_WEEK || !workList && record.weekStart > finalPlanWeek) continue;
    const plan = record as WorkflowPlan;
    const previous = plansByWeek.get(plan.weekStart);
    if (!previous || plan.updatedAt > previous.updatedAt || plan.updatedAt === previous.updatedAt && plan.version > previous.version) {
      plansByWeek.set(plan.weekStart, plan);
    }
  }
  const plannedIds = new Map([...plansByWeek.values()]
    .filter(plan => isExecutableWorkflowPlan(plan.status))
    .map(plan => [plan.weekStart, new Set(plan.taskIds)]));

  const tasks = all.filter(row => row.kind === "task").map(row => row.record as WorkflowTask).filter(task => !task.deletedAt);
  const issueTasks = new Set(all.filter(row => row.kind === "issue")
    .map(row => row.record as WorkflowIssue).filter(issue => issue.status !== "resolved").map(issue => issue.taskId));
  const originalApprovals = approvalRows(all);
  const originalPublications = all.filter(row => row.kind === "publication").map(row => row.record as WorkflowPublication);
  const verifiedTasks = new Set(originalPublications
    .filter(row => row.status === "verified" && !["translation", "backfill_translation"].includes(row.kind))
    .map(row => JSON.stringify([row.taskId, row.contentVersion])));
  const tasksWithPendingPostReview = new Set(originalApprovals.flatMap(approval => approval.items
    .filter(item => item.postPublicationId && workflowApprovalEffectiveItemStatus(approval, item.id, originalApprovals) === "pending")
    .map(item => JSON.stringify([item.taskId, item.contentVersion]))));
  const pendingRollbacks = new Set(workflowClusterRollbackCandidates({
    approvals: originalApprovals,
    publications: originalPublications,
    runs: all.filter(row => row.kind === "run").map(row => row.record as WorkflowRun),
  }).map(row => row.taskId));
  // The scheduling cutover must not hide an already shipped cluster version awaiting human review.
  const legacyPostReviewVersions = new Set(originalApprovals.flatMap(approval => approval.items
    .filter(item => item.postPublicationId && workflowApprovalEffectiveItemStatus(approval, item.id, originalApprovals) === "pending"
      && originalPublications.some(publication => publication.id === item.postPublicationId
        && publication.publicationPolicy === "cluster_post_review" && publication.status === "verified"
        && publication.siteDomain === approval.siteDomain
        && publication.taskId === item.taskId && publication.contentVersion === item.contentVersion
        && publication.pageUrl === item.pageUrl && publication.language === item.language))
    .map(item => JSON.stringify([item.taskId, item.contentVersion, approval.siteDomain, item.pageUrl, item.language]))));
  const scheduledTasks = tasks.filter(task => {
    if (!workList && dueDay(task) > range.end) return false;
    if (task.weekStart < FIRST_OPERATIONAL_WEEK) return ["rackrate.org", "modelfit.cc"].includes(task.siteDomain)
      && !!task.pageUrl && pageBelongsToSite(task.pageUrl, task.siteDomain)
      && legacyPostReviewVersions.has(JSON.stringify([task.id, task.contentVersion, task.siteDomain, task.pageUrl, task.language]));
    if (isCodexTrackedTask(task)) return workList;
    return task.source === "human" || plannedIds.get(task.weekStart)?.has(task.id) ||
      task.kind === "technical" && issueTasks.has(task.id);
  })
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id));
  const activeTasks = scheduledTasks.filter(task => {
    if (dueDay(task) > range.end || isCodexTrackedTask(task)) return false;
    const version = JSON.stringify([task.id, task.contentVersion]);
    return pendingRollbacks.has(task.id) || tasksWithPendingPostReview.has(version) ||
      !["verified", "observing"].includes(task.status) && !verifiedTasks.has(version);
  });
  const ids = new Set(activeTasks.map(task => task.id));
  const visibleTasks = workList ? scheduledTasks : activeTasks;
  const visibleTaskIds = new Set(visibleTasks.map(task => task.id));
  const dependencies = new Set(activeTasks.flatMap(task => task.dependencies));
  const linkedApprovals = new Set(originalApprovals.filter(approval => approval.items.some(item => ids.has(item.taskId))).map(approval => approval.id));
  const relevantApprovals = originalApprovals.filter(approval => linkedApprovals.has(approval.id)
    || approval.supersedesApprovalIds.some(id => linkedApprovals.has(id)));
  const activeById = new Map(activeTasks.map(task => [task.id, task]));
  const activeApprovalItems = Object.fromEntries(relevantApprovals.map(approval => [approval.id,
    approval.items.filter(item => {
      const task = activeById.get(item.taskId);
      if (!task || !approvalItemNeedsHuman(item, [task])) return false;
      if (!item.postPublicationId && item.codeSource && task.branchObservation && task.branchObservation.headSha !== item.codeSource.commitSha) return false;
      return task.contentVersion === item.contentVersion || task.kind === "blog" && task.language !== item.language;
    }).map(item => item.id),
  ]));
  const reviewOrReleaseTaskIds = new Set<string>();
  const pending = relevantApprovals.map(approval => approval.items.filter(item => {
    if (!activeApprovalItems[approval.id].includes(item.id) || !approvalReviewReadiness(item).ready) return false;
    const status = workflowApprovalEffectiveItemStatus(approval, item.id, originalApprovals);
    if (status === "pending" || status === "approved") reviewOrReleaseTaskIds.add(item.taskId);
    return status === "pending";
  }).length);
  const pendingCount = pending.reduce((total, count) => total + count, 0);
  return {
    ...snapshot,
    tasks: visibleTasks,
    approvals: relevantApprovals,
    publications: originalPublications.filter(row => visibleTaskIds.has(row.taskId)),
    workWeek: {
      range,
      timeZone: "Asia/Shanghai",
      asOf: now.toISOString(),
      catchUpDate: seoCatchUpDate(now),
      overdueTaskIds: activeTasks.filter(task => dueDay(task) < today).map(task => task.id),
      pendingRollbackTaskIds: activeTasks.filter(task => pendingRollbacks.has(task.id)).map(task => task.id),
      reviewOrReleaseTaskIds: [...reviewOrReleaseTaskIds],
      dependencyStatuses: Object.fromEntries(tasks.filter(task => dependencies.has(task.id)).map(task => [task.id, task.status])),
      activeApprovalItems,
    },
    summary: {
      ...snapshot.summary,
      tasks: visibleTasks.length,
      blocked: activeTasks.filter(task => ["blocked", "failed"].includes(task.status)).length,
      reviewPending: pendingCount,
      pendingApprovalItems: pendingCount,
      pendingApprovals: pending.filter(count => count > 0).length,
    },
  };
}
