import { GROWTH_EXECUTION_SITES, GROWTH_LANGUAGES } from "./seo-growth-markets";
import { workWeekDateRange, shiftDay } from "./seo-date-range";
import { isSeoWorkday } from "./seo-workday";
import { workflowWeek, isExecutableWorkflowPlan, type WorkflowPlan, type WorkflowTask } from "./seo-workflow";
import { WorkflowError, type WorkflowStoredRow } from "./seo-workflow-state";

function fail(code: string, message: string): never { throw new WorkflowError(code, message); }
const day = (task: WorkflowTask) => new Date(task.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const content = new Set(["blog", "landing", "optimization", "cluster"]);
/** New plans count one Friday–Thursday window across both stable Monday buckets.
 * Market proportions apply to admitted keywords, never mechanical source-post quotas. */
export function assertGrowthPlan(plan: WorkflowPlan, previous: WorkflowPlan | undefined, all: WorkflowStoredRow[]) {
  const targets = plan.targets;
  if (!("cadence" in targets) || targets.cadence !== "growth") return;
  const range = targets.executionRange;
  const expected = workWeekDateRange(range.start);
  if (range.start !== expected.start || range.end !== expected.end || ![workflowWeek(new Date(range.start + "T12:00:00+08:00")), workflowWeek(new Date(range.end + "T12:00:00+08:00"))].includes(plan.weekStart)) fail("growth_plan_window", "新计划须覆盖完整北京时间周五至周四，Monday存储桶保持原值");
  const workingDays = Array.from({ length: 7 }, (_, index) => shiftDay(range.start, index)).filter(date => isSeoWorkday(new Date(date + "T00:00:00+08:00"))).length;
  const maintenance = targets.maintenanceVersion === "seo-maintenance-v1";
  if (maintenance !== (targets.contentRefreshPages !== undefined) || maintenance && targets.contentRefreshPages !== 2 * workingDays) fail("growth_refresh_capacity", "新维护契约须独立按工作日安排每天2篇翻新，不扣原优化及新增额度");
  if (previous && "maintenanceVersion" in previous.targets && previous.targets.maintenanceVersion && !maintenance) fail("growth_refresh_contract_immutable", "保留已启用的维护容量契约");
  if (targets.apiBlogs + targets.gpuBlogs !== 5 * workingDays || targets.optimizedPages !== 2 * workingDays || targets.clusterLanding !== workingDays + Math.min(2, workingDays) || GROWTH_LANGUAGES.reduce((sum, language) => sum + targets.blogLanguages[language], 0) !== workingDays * 5) fail("growth_plan_capacity", "业务周源文、优化与两站落地页容量须按真实工作日一次核算，不能按两个Monday桶翻倍");
  const lookup = new Map(all.filter(row => row.kind === "task").map(row => [row.record.id, row.record as WorkflowTask]));
  const tasks = plan.taskIds.map(id => lookup.get(id));
  for (const task of tasks) {
    if (!task || task.deletedAt || day(task) < range.start || day(task) > range.end) fail("growth_plan_task_window", "计划须引用业务周内真实原任务，不能改任务交付日或丢失旧ID");
    if (!GROWTH_EXECUTION_SITES.some(site => site === task.siteDomain) || task.channel === "product") fail("growth_plan_scope", "数据观察站点及产品后台不进入制作排期");
    if (content.has(task.kind) && !isSeoWorkday(new Date(task.dueAt))) fail("growth_plan_nonworkday", "制作与发布仍按实际工作日执行");
    if (task.kind === "landing" && task.siteDomain === "flatkey.ai") fail("flatkey_new_landing_stopped", "Flatkey新落地页暂停");
    if (task.kind === "blog" && !["flatkey.ai", "modelfit.cc"].includes(task.siteDomain)) fail("growth_plan_blog_scope", "博客仅限Flatkey和ModelFit");
    if (task.workClass === "content_refresh" && !maintenance) fail("growth_refresh_contract_required", "翻新须进入独立维护容量计划，不挤占旧优化额度");
    if (isExecutableWorkflowPlan(plan.status) && content.has(task.kind) && ["planned", "researching", "blocked", "failed"].includes(task.status)) fail("growth_plan_task_not_ready", "正式计划须引用研究已完成且可执行的原任务");
  }
  if (!isExecutableWorkflowPlan(plan.status)) return;
  // Other plans can still use their original Monday keys. Count their task IDs once.
  const selected = new Set(plan.taskIds);
  for (const row of all) if (row.kind === "plan" && row.record.id !== plan.id && isExecutableWorkflowPlan(row.record.status)) {
    for (const id of (row.record as WorkflowPlan).taskIds) { const task = lookup.get(id); if (task && day(task) >= range.start && day(task) <= range.end) selected.add(id); }
  }
  const routine = [...selected].map(id => lookup.get(id)).filter((task): task is WorkflowTask => Boolean(task && !task.deletedAt && task.capacityClass !== "authorized_hotspot_extra"));
  const flatkeyBlogs = routine.filter(task => task.siteDomain === "flatkey.ai" && task.kind === "blog");
  const modelFitBlogs = routine.filter(task => task.siteDomain === "modelfit.cc" && task.kind === "blog");
  const landings = routine.filter(task => task.kind === "landing");
  const optimizations = routine.filter(task => task.siteDomain === "flatkey.ai" && task.kind === "optimization" && task.workClass !== "content_refresh");
  const refreshes = routine.filter(task => task.workClass === "content_refresh");
  if (refreshes.length > 2 * workingDays) fail("growth_refresh_shared_capacity", "Flatkey与ModelFit合计翻新每天2篇，不能跨站或跨桶重复排额");
  if (new Set(refreshes.map(task => task.pageUrl)).size !== refreshes.length || refreshes.some(task => routine.some(other => other.id !== task.id && other.pageUrl === task.pageUrl && other.kind === "optimization"))) fail("growth_refresh_duplicate_page", "同一页面本期翻新与普通优化须复用一次交付，不重复建单计数");
  if (flatkeyBlogs.length > 5 * workingDays || modelFitBlogs.length > workingDays || landings.length > targets.clusterLanding || optimizations.length > 2 * workingDays) fail("growth_plan_shared_capacity", "跨计划业务周总量超出原额度，不能在另一个存储桶重复排产");
  for (const language of GROWTH_LANGUAGES) if (flatkeyBlogs.filter(task => task.language === language).length > targets.blogLanguages[language]) fail("growth_plan_language_capacity", "国家语言源文数量超出本期已确认分配，关键词比例不等于逐日发文配额");
  const other = flatkeyBlogs.filter(task => !["en", "ja", "pt-BR", "zh-CN"].includes(task.language ?? ""));
  if (other.length > 2) fail("growth_plan_secondary_markets", "低优先市场合计每周最多2篇源文，翻译另记");
  for (const [site, rows, quota] of [["flatkey.ai", flatkeyBlogs, 5], ["modelfit.cc", modelFitBlogs, 1], ["flatkey.ai", optimizations, 2]] as const) {
    const counts = new Map<string, number>();
    for (const task of rows) counts.set(day(task), (counts.get(day(task)) ?? 0) + 1);
    if ([...counts.values()].some(count => count > quota)) fail("growth_plan_daily_capacity", `${site}单日排期超出既有容量`);
  }
  for (const date of Array.from({ length: 7 }, (_, index) => shiftDay(range.start, index)).filter(date => isSeoWorkday(new Date(date + "T00:00:00+08:00")))) {
    const refreshCount = refreshes.filter(task => day(task) === date).length;
    if (refreshCount > 2) fail("growth_refresh_daily_capacity", "两站单日翻新总量不可超过2篇源文");
    if (maintenance && refreshCount + plan.gaps.filter(gap => gap.category === "contentRefreshPages" && gap.date === date).reduce((sum, gap) => sum + gap.count, 0) < 2) fail("growth_refresh_daily_gap", `翻新${date}须有原任务或逐日真实缺口，不能强行凑数`);
    const count = modelFitBlogs.filter(task => day(task) === date && task.country === "US" && task.language === "en").length;
    const gap = plan.gaps.filter(gap => gap.category === "modelFitBlogs" && gap.date === date && gap.siteDomain === "modelfit.cc").reduce((sum, gap) => sum + gap.count, 0);
    if (count + gap < 1) fail("growth_plan_modelfit_gap", `ModelFit ${date} US/en源文须有原任务或逐日真实缺口`);
  }
  const gaps = (category: string) => plan.gaps.filter(gap => gap.category === category).reduce((sum, gap) => sum + gap.count, 0);
  const own = tasks.filter((task): task is WorkflowTask => Boolean(task && task.capacityClass !== "authorized_hotspot_extra"));
  for (const [category, count, target] of [
    ["apiBlogs", own.filter(task => task.siteDomain === "flatkey.ai" && task.kind === "blog" && task.business === "API").length, targets.apiBlogs],
    ["gpuBlogs", own.filter(task => task.siteDomain === "flatkey.ai" && task.kind === "blog" && task.business === "GPU").length, targets.gpuBlogs],
    ["optimizedPages", own.filter(task => task.siteDomain === "flatkey.ai" && task.kind === "optimization" && task.workClass !== "content_refresh").length, targets.optimizedPages],
    ["contentRefreshPages", own.filter(task => task.workClass === "content_refresh").length, targets.contentRefreshPages ?? 0],
    ["clusterLanding", own.filter(task => task.kind === "landing").length, targets.clusterLanding],
  ] as const) if (target - count > gaps(category)) fail("growth_plan_gap", `${category}缺口须如实保存，不用未研究任务补足`);
  // Existing tasks and deliveries are never replaced as a consequence of this plan.
  if (previous && isExecutableWorkflowPlan(previous.status)) for (const id of previous.taskIds) {
    const task = lookup.get(id);
    if (task && !task.deletedAt && !plan.taskIds.includes(id)) fail("growth_plan_preserve_tasks", "计划修订保留已排原任务及其交付日，新增结论沿原ID增补");
  }
}
