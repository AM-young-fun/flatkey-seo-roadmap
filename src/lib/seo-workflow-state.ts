import { approvalReviewReadiness } from "./seo-workflow";
import { createHash } from "node:crypto";
import { ACTION_KIND, WORKFLOW_SCHEMAS, workflowMutationSchema, workflowWeek, shiftWorkflowDay, type WorkflowKind, type WorkflowRecord, type WorkflowTask, type WorkflowPlan, type WorkflowPublication, type WorkflowOptimization, type WorkflowSnapshot, type WorkflowRun, type WorkflowIssue, type WorkflowHistoricalImport, type WorkflowApproval, type WorkflowApprovalCheck, workflowApprovalEffectiveItemStatus, workflowApprovalItemStatus } from "./seo-workflow";
import { optimizationComparisonProblems } from "./seo-workflow-comparison";

export class WorkflowError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
export type WorkflowStoredRow = { kind: WorkflowKind; record: WorkflowRecord };
export type WorkflowActor = "human" | "collector";
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)])) : value;
export const workflowHash = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value)) ?? "undefined").digest("hex");
export const workflowKey = (kind: WorkflowKind, id: string) => `${kind}:${id}`;
function reject(code: string, message: string): never { throw new WorkflowError(code, message); }
const same = (a: unknown, b: unknown) => workflowHash(a) === workflowHash(b);
const contentKinds = new Set(["blog", "landing", "optimization", "cluster"]);
const beforePublication = new Set(["planned", "researching", "ready", "drafting", "review_pending", "approved", "blocked", "failed"]);
const productionStates = new Set(["ready", "drafting", "review_pending", "approved", "published", "verified", "observing"]);

function assertTask(task: WorkflowTask, previous: WorkflowTask | undefined, all: WorkflowStoredRow[], actor: WorkflowActor) {
  if (previous && (previous.channel === "product" || task.channel === "product") && previous.channel !== task.channel) reject("product_task_channel_immutable", "产品技术任务不能更换渠道；请新建独立任务");
  const tasks = all.filter(row => row.kind === "task").map(row => row.record as WorkflowTask);
  const lookup = new Map(tasks.map(row => [row.id, row])); lookup.set(task.id, task);
  if (task.keyword && contentKinds.has(task.kind)) {
    const word = (value: string | null) => value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    if (tasks.some(other => other.id !== task.id && !["published", "verified", "observing"].includes(other.status) && other.weekStart === task.weekStart && other.kind === task.kind && other.siteDomain === task.siteDomain && other.country === task.country && other.language === task.language && other.pageUrl === task.pageUrl && word(other.keyword) === word(task.keyword))) reject("duplicate_content_task", "同周、同页面及国家的相同关键词已有任务；请续跑已有任务");
  }
  for (const dependency of task.dependencies) if (!lookup.has(dependency)) reject("dependency_missing", `依赖任务不存在：${dependency}`);
  const visit = (id: string, path: Set<string>) => { if (path.has(id)) reject("dependency_cycle", "任务依赖构成循环"); const next = new Set(path).add(id); for (const dep of lookup.get(id)?.dependencies ?? []) visit(dep, next); };
  visit(task.id, new Set());
  if (["drafting", "approved", "published", "verified", "observing"].includes(task.status)) {
    for (const dependency of task.dependencies) if (!["verified", "observing"].includes(lookup.get(dependency)!.status)) reject("dependency_incomplete", `前置任务尚未验收：${dependency}`);
  }
  if (previous && actor === "collector" && (previous.source === "human" || previous.approval?.kind === "explicit")) {
    for (const key of ["title", "keyword", "keywordId", "country", "language", "business", "pageType", "pageUrl", "owner", "dueAt", "dependencies", "acceptanceCriteria", "contentVersion", "artifactUrl"] as const) {
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
}

function assertPlan(plan: WorkflowPlan, previous: WorkflowPlan | undefined, all: WorkflowStoredRow[]) {
  if (previous && previous.weekStart !== plan.weekStart) reject("identity_changed", "计划不能改变所属工作周");
  const tasks = plan.taskIds.map(id => all.find(row => row.kind === "task" && row.record.id === id)?.record as WorkflowTask | undefined);
  if (tasks.some(task => !task || task.weekStart !== plan.weekStart)) reject("plan_task_missing", "计划只能引用同一工作周已有任务");
  if (plan.status !== "reviewed") return;
  if (!plan.targets.blogLanguages) reject("plan_language_targets_required", "新正式计划须明确 en14、ja7、pt-BR7、es-ES7 源文额度；旧计划仅保留历史读取");
  const ready = tasks.filter((task): task is WorkflowTask => Boolean(task && !["planned", "researching", "blocked", "failed"].includes(task.status)));
  const counts = {
    landing: ready.filter(task => task.kind === "landing" && task.siteDomain === "flatkey.ai").length,
    apiBlogs: ready.filter(task => task.kind === "blog" && task.siteDomain === "flatkey.ai" && task.business === "API").length,
    gpuBlogs: ready.filter(task => task.kind === "blog" && task.siteDomain === "flatkey.ai" && task.business === "GPU").length,
    optimizedPages: new Set(ready.filter(task => task.kind === "optimization" && task.pageUrl).map(task => task.pageUrl)).size,
  };
  const languageCategories = { en: "blogEn", ja: "blogJa", "pt-BR": "blogPt", "es-ES": "blogEs" } as const;
  const dailyQuota = { en: 2, ja: 1, "pt-BR": 1, "es-ES": 1 };
  const blogs = ready.filter(task => task.kind === "blog" && task.siteDomain === "flatkey.ai");
  for (const language of Object.keys(languageCategories) as (keyof typeof languageCategories)[]) {
    const selected = blogs.filter(task => task.language === language);
    const gap = Math.max(0, plan.targets.blogLanguages[language] - selected.length);
    if (gap > plan.gaps.filter(row => row.category === languageCategories[language]).reduce((sum, row) => sum + row.count, 0)) reject("plan_language_gap_unrecorded", `${language} 还缺 ${gap} 篇源文；需登记国家语言缺口`);
    const days = new Map<string, number>();
    for (const task of selected) { const day = new Date(task.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }); days.set(day, (days.get(day) ?? 0) + 1); }
    if ([...days.values()].some(count => count > dailyQuota[language])) reject("plan_daily_language_quota", `${language} 单日源文不能超过 ${dailyQuota[language]} 篇；翻译另记`);
  }
  for (const category of Object.keys(counts) as (keyof typeof counts)[]) {
    const gap = Math.max(0, plan.targets[category] - counts[category]);
    const recorded = plan.gaps.filter(row => row.category === category).reduce((sum, row) => sum + row.count, 0);
    if (gap > recorded) reject("plan_gap_unrecorded", `${category} 还缺 ${gap} 项；不能把空位或待研究关键词当作已排定产能`);
  }
}

const approvalRows = (all: WorkflowStoredRow[]) => all.filter(row => row.kind === "approval").map(row => row.record as WorkflowApproval);
const decisionInput = (decision: WorkflowApproval["decisions"][number]) => Object.fromEntries(Object.entries(decision).filter(([key]) => key !== "recordedAt"));

function checkApprovalItemContext(item: WorkflowApproval["items"][number], siteDomain: string, all: WorkflowStoredRow[], currentPublicationId?: string) {
  const task = all.find(row => row.kind === "task" && row.record.id === item.taskId)?.record as WorkflowTask | undefined;
  if (!task || task.siteDomain !== siteDomain || !["blog", "landing", "optimization", "cluster", "technical"].includes(task.kind)) reject("approval_task_missing", "审批项必须关联同站点真实页面任务，历史归档不能提供发布授权");
  if (contentKinds.has(task.kind) && ["planned", "researching"].includes(task.status)) reject("approval_task_not_ready", "先完成关键词研究并进入制作或待审阶段，再提交页面审批");
  const translation = task.kind === "blog" && item.language !== task.language;
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
      const others = approvalRows(all).filter(other => other.id !== value.id && other.status !== "draft");
      for (const priorId of value.supersedesApprovalIds) {
        const prior = others.find(other => other.id === priorId);
        if (!prior || prior.siteDomain !== value.siteDomain || !prior.items.some(old => value.items.some(item => item.pageUrl === old.pageUrl && item.language === old.language))) reject("approval_supersession_invalid", "替换关系必须指向同站点、同页面语言的已有审批单");
      }
      for (const item of value.items) for (const other of others) {
        const priorItem = other.items.find(old => old.pageUrl === item.pageUrl && old.language === item.language);
        if (!priorItem) continue;
        if (priorItem.contentVersion === item.contentVersion) reject("approval_version_reused", "该页面语言版本已有审批；改稿必须新版本，不能重建审批绕过决定");
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
  if (workflowApprovalEffectiveItemStatus(approval, item.id, approvals) !== "approved") reject("publication_unapproved", "该页面版本尚未批准，或审批已撤回、要求修改、被新稿替换");
  const decision = [...approval.decisions].reverse().find(decision => decision.itemIds.includes(item.id))!;
  if (!decision.recordedAt) reject("publication_approval_unverified", "审批缺少服务器记录的决定时刻");
  const readiness = approvalReviewReadiness(item);
  if (!readiness.ready) reject("approval_preview_missing", "发布前须补齐：" + readiness.missing.join("、"));
  checkApprovalItemContext(item, approval.siteDomain, all);
  const task = all.find(row => row.kind === "task" && row.record.id === item.taskId)?.record as WorkflowTask;
  for (const dependency of task.dependencies) if (!all.some(row => row.kind === "task" && row.record.id === dependency && ["verified", "observing"].includes(row.record.status))) reject("dependency_incomplete", "前置任务尚未验收，不能发布");
  return { allowed: true as const, request: { ...input }, approvalId: approval.id, itemId: item.id, decisionId: decision.id, decisionVersion: approval.version, decisionRecordedAt: decision.recordedAt, checkedAt: now.toISOString() };
}

function assertPublication(value: WorkflowPublication, previous: WorkflowPublication | undefined, all: WorkflowStoredRow[]) {
  const task = all.find(row => row.kind === "task" && row.record.id === value.taskId)?.record as WorkflowTask | undefined;
  if (!task || task.siteDomain !== value.siteDomain || task.weekStart !== value.weekStart) reject("publication_task_missing", "发布记录需要对应同站点工作任务");
  // A previous accepted live receipt can finish verification after withdrawal;
  // withdrawal does not erase a real earlier delivery. New deliveries always recheck.
  if (!previous || !["published", "verified"].includes(previous.status)) {
    const allowed = checkWorkflowApproval({ approvalId: value.approvalId, itemId: value.approvalItemId, taskId: value.taskId, pageUrl: value.pageUrl, language: value.language, contentVersion: value.contentVersion }, all);
    if (Date.parse(value.publishedAt) < Date.parse(allowed.decisionRecordedAt)) reject("publication_before_approval", "实际发布时间不能早于服务器保存的负责人审批决定");
  }
  const isTranslation = ["translation", "backfill_translation"].includes(value.kind);
  const expectedKind = isTranslation || value.kind === "source_blog" ? "blog" : value.kind;
  if (task.kind !== expectedKind && !(task.kind === "technical" && ["optimization", "landing"].includes(value.kind))) reject("publication_kind_mismatch", "发布类型与任务不符；源文、落地页和优化不能混计");
  const approvedItem = approvalRows(all).find(row => row.id === value.approvalId)?.items.find(item => item.id === value.approvalItemId);
  if (approvedItem?.operation !== (value.kind === "optimization" ? "update" : "new")) reject("publication_operation_mismatch", "新页面须按新增交付记录，修改旧页才按优化记录");
  if (!isTranslation && task.contentVersion !== value.contentVersion) reject("publication_version_mismatch", "发布版本不属于已批准内容");
  if (!isTranslation && task.pageUrl && task.pageUrl !== value.pageUrl) reject("publication_page_mismatch", "正式页面与批准任务的 URL 不一致");
  if (!isTranslation && (value.country !== task.country || (task.language !== null && value.language !== task.language) || value.keyword !== task.keyword)) reject("publication_market_mismatch", "发布国家、语言或主词与任务不一致");
  if (isTranslation) {
    const source = all.find(row => row.kind === "publication" && row.record.id === value.sourcePublicationId)?.record as WorkflowPublication | undefined;
    if (!source || source.kind !== "source_blog" || source.siteDomain !== value.siteDomain || source.taskId !== task.id) reject("translation_source_missing", "翻译必须关联同任务真实源文");
  }
  for (const row of all.filter(row => row.kind === "publication" && row.record.id !== value.id)) {
    const other = row.record as WorkflowPublication;
    if (other.pageUrl === value.pageUrl && other.contentVersion === value.contentVersion) reject("duplicate_publication", "同一规范页面及版本已有发布记录，请续写原记录");
  }
  if (all.some(row => row.kind === "historical_import" && (row.record as WorkflowHistoricalImport).publications.some(item => item.pageUrl === value.pageUrl && item.contentVersion === value.contentVersion))) reject("duplicate_historical_publication", "该页面版本已有历史归档，不能作为本次新增发布重复计数");
  if (previous) {
    for (const key of ["taskId", "approvalId", "approvalItemId", "siteDomain", "pageUrl", "country", "language", "keyword", "contentVersion", "kind", "sourcePublicationId", "publishedAt"] as const) if (!same(previous[key], value[key])) reject("publication_identity_changed", "已有发布身份和真实发布时间不可覆盖");
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
      if (["publishedAt", "verifiedAt", "firstVerifiedAt", "observedAt", "checkedAt", "capturedAt", "preparedAt", "reviewedAt", "approvedAt", "startedAt", "completedAt", "sourceStartedAt", "sourceCompletedAt", "sourceSnapshotAt", "firstSeenAt", "resolvedAt", "changedAt", "submittedAt", "decidedAt"].includes(key) && typeof entry === "string" && Date.parse(entry) > now.getTime() + 300_000) reject("future_evidence", "事实或验收时间不能在未来");
      checkTimes(entry);
    }
  };
  checkTimes(parsed);
  if (kind === "run") { const run = parsed as WorkflowRun; if (run.completedAt && Date.parse(run.completedAt) < Date.parse(run.startedAt)) reject("run_time_order", "完成时间不能早于开始时间"); }
  const previous = all.find(row => row.kind === kind && row.record.id === parsed.id)?.record;
  if ((previous?.version ?? 0) !== mutation.expectedVersion) reject("version_conflict", "记录已被其他任务修改；请重新读取并保留人工变更");
  const stamp = now.toISOString();
  const record = { ...parsed, version: (previous?.version ?? 0) + 1, recordedAt: previous?.recordedAt ?? stamp, updatedAt: stamp,
    ...(kind === "approval" ? { submittedRecordedAt: (previous as WorkflowApproval | undefined)?.submittedRecordedAt ?? ((parsed as WorkflowApproval).status !== "draft" ? stamp : null), decisions: (parsed as WorkflowApproval).decisions.map((decision, index) => ({ ...decision, recordedAt: (previous as WorkflowApproval | undefined)?.decisions[index]?.recordedAt ?? stamp })) } : {}),
    ...(kind === "publication" ? { verificationRecordedAt: (previous as WorkflowPublication | undefined)?.verificationRecordedAt ?? ((parsed as WorkflowPublication).status === "verified" ? stamp : null) } : {}),
    ...(kind === "historical_import" ? { publications: (parsed as WorkflowHistoricalImport).publications.map(item => ({ ...item, verificationRecordedAt: item.verificationState === "live_verified" ? stamp : null })) } : {}),
  } as WorkflowRecord;
  if (previous && "siteDomain" in previous && "siteDomain" in record && previous.siteDomain !== record.siteDomain) reject("identity_changed", "记录站点不能改变");
  if (kind === "approval") assertApproval(record as WorkflowApproval, previous as WorkflowApproval | undefined, all, actor);
  if (kind === "task") assertTask(record as WorkflowTask, previous as WorkflowTask | undefined, all, actor);
  if (kind === "plan") assertPlan(record as WorkflowPlan, previous as WorkflowPlan | undefined, all);
  if (kind === "publication") assertPublication(record as WorkflowPublication, previous as WorkflowPublication | undefined, all);
  if (kind === "optimization") assertOptimization(record as WorkflowOptimization, previous as WorkflowOptimization | undefined, all);
  if (kind === "run" && (previous as WorkflowRun | undefined)?.status === "completed") reject("run_completed", "已完成回执不可回退；修正请增加单独复核记录");
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

export function workflowSnapshot(all: WorkflowStoredRow[], options: { week?: string; pageUrl?: string; allHistory?: boolean }, storage: WorkflowSnapshot["storage"], now = new Date()): WorkflowSnapshot {
  const current = workflowWeek(now);
  const weekStart = options.week === "next" ? shiftWorkflowDay(current, 7) : options.week === "latest" ? all.filter(row => row.kind === "plan").map(row => row.record.weekStart).sort().at(-1) ?? current : !options.week || options.week === "current" ? current : options.week;
  const belongs = (row: WorkflowStoredRow) => options.pageUrl ? "pageUrl" in row.record && row.record.pageUrl === options.pageUrl : options.allHistory || row.record.weekStart === weekStart;
  const tasks = all.filter(row => row.kind === "task" && belongs(row)).map(row => row.record as WorkflowTask).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const taskIds = new Set(tasks.map(task => task.id));
  const plans = all.filter(row => row.kind === "plan" && row.record.weekStart === weekStart).map(row => row.record as WorkflowPlan).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const publications = all.filter(row => row.kind === "publication" && belongs(row)).map(row => row.record as WorkflowPublication).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const allApprovals = approvalRows(all);
  const approvals = allApprovals.filter(row => options.pageUrl ? row.items.some(item => item.pageUrl === options.pageUrl) : options.allHistory || row.weekStart === weekStart || row.items.some(item => workflowApprovalEffectiveItemStatus(row, item.id, allApprovals) === "pending"));
  const historicalImports = all.filter(row => row.kind === "historical_import" && (options.pageUrl ? (row.record as WorkflowHistoricalImport).publications.some(item => item.pageUrl === options.pageUrl) : belongs(row))).map(row => row.record as WorkflowHistoricalImport);
  const optimizations = all.filter(row => row.kind === "optimization" && belongs(row)).map(row => row.record as WorkflowOptimization);
  const issues = all.filter(row => row.kind === "issue" && (belongs(row) || !options.pageUrl && (row.record as WorkflowIssue).status !== "resolved")).map(row => row.record as WorkflowIssue);
  const runs = all.filter(row => row.kind === "run" && (options.pageUrl ? (row.record as WorkflowRun).taskIds.some(id => taskIds.has(id)) : belongs(row))).map(row => row.record as WorkflowRun).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const verified = publications.filter(row => row.status === "verified");
  return { weekStart, weekEnd: shiftWorkflowDay(weekStart, 6), plan: plans[0] ?? null, approvals, tasks, publications, historicalImports, optimizations, issues, runs, storage, generatedAt: now.toISOString(), summary: {
    tasks: tasks.length, blocked: tasks.filter(task => ["blocked", "failed"].includes(task.status)).length, reviewPending: tasks.filter(task => task.status === "review_pending").length,
    pendingApprovalItems: approvals.reduce((sum, row) => sum + row.items.filter(item => workflowApprovalEffectiveItemStatus(row, item.id, allApprovals) === "pending").length, 0),
    pendingApprovals: approvals.filter(row => row.items.some(item => workflowApprovalEffectiveItemStatus(row, item.id, allApprovals) === "pending")).length,
    verifiedSourceBlogs: verified.filter(row => row.kind === "source_blog").length, verifiedTranslations: verified.filter(row => ["translation", "backfill_translation"].includes(row.kind)).length,
    verifiedLandingPages: verified.filter(row => row.kind === "landing").length, optimizedPages: new Set(verified.filter(row => row.kind === "optimization").map(row => row.pageUrl)).size,
    openIssues: issues.filter(issue => issue.status !== "resolved").length, lastRunAt: runs[0]?.startedAt ?? null,
  } };
}
