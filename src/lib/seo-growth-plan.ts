import { isSeoExtraCapacity } from "./seo-extra-capacity";
import { FLATKEY_LANDING_START, FLATKEY_LANDING_WEEKLY_CAP, GROWTH_EXECUTION_SITES, GROWTH_LANGUAGES } from "./seo-growth-markets";
import { workWeekDateRange, shiftDay } from "./seo-date-range";
import { isSeoWorkday } from "./seo-workday";
import { workflowWeek, isExecutableWorkflowPlan, type WorkflowPlan, type WorkflowTask } from "./seo-workflow";
import { WorkflowError, type WorkflowStoredRow } from "./seo-workflow-state";
import { deliveryWeights, type DeliveryBucket } from "./growth-quarter-planning";
import { ROUTINE_LANGUAGE_GROUPS, ROUTINE_LANGUAGE_START, isRoutineKeywordTask, routineLanguageBudget, routineLanguageGroup, routineLanguageProblems } from "./seo-routine-languages";

function fail(code: string, message: string): never { throw new WorkflowError(code, message); }
const day = (task: WorkflowTask) => new Date(task.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const content = new Set(["blog", "landing", "optimization", "cluster"]);
const flatkeyLanding = (task: WorkflowTask) => task.kind === "landing" && task.siteDomain === "flatkey.ai";
/** New plans count one Friday–Thursday window across both stable Monday buckets. */
export function assertGrowthPlan(plan: WorkflowPlan, previous: WorkflowPlan | undefined, all: WorkflowStoredRow[]) {
  const targets = plan.targets;
  if (!("cadence" in targets) || targets.cadence !== "growth") return;
  if (targets.blogLanguages.ru > 0) fail("russian_translation_only", "俄语只做正常翻译，不安排独立关键词研究或俄语源文名额");
  const range = targets.executionRange;
  const expected = workWeekDateRange(range.start);
  if (range.start !== expected.start || range.end !== expected.end || ![workflowWeek(new Date(range.start + "T12:00:00+08:00")), workflowWeek(new Date(range.end + "T12:00:00+08:00"))].includes(plan.weekStart)) fail("growth_plan_window", "新计划须覆盖完整北京时间周五至周四，Monday存储桶保持原值");
  const dates = Array.from({ length: 7 }, (_, index) => shiftDay(range.start, index)).filter(date => isSeoWorkday(new Date(date + "T00:00:00+08:00")));
  const workingDays = dates.length;
  const flatkeyLandingCap = range.start >= FLATKEY_LANDING_START && workingDays ? FLATKEY_LANDING_WEEKLY_CAP : 0;
  if (targets.landing !== flatkeyLandingCap && (!flatkeyLandingCap || !previous || targets.landing !== previous.targets.landing)) {
    fail("flatkey_landing_capacity", "Flatkey新落地页从11月27日业务周起每周安排2页或记录真实缺口");
  }
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
    if (flatkeyLanding(task) && (!targets.landing || isSeoExtraCapacity(task.capacityClass) || task.workflowContract !== "growth-v1.5")) fail("flatkey_landing_plan_required", "Flatkey新落地页须使用新业务周正式配额及季度研究契约");
    if (task.kind === "blog" && !["flatkey.ai", "modelfit.cc"].includes(task.siteDomain)) fail("growth_plan_blog_scope", "博客仅限Flatkey和ModelFit");
    if (task.workClass === "content_refresh" && !maintenance) fail("growth_refresh_contract_required", "翻新须进入独立维护容量计划，不挤占旧优化额度");
    if (isExecutableWorkflowPlan(plan.status) && content.has(task.kind) && ["planned", "researching", "blocked", "failed"].includes(task.status)) fail("growth_plan_task_not_ready", "正式计划须引用研究已完成且可执行的原任务");
  }
  if (previous && isExecutableWorkflowPlan(previous.status)) for (const id of previous.taskIds) {
    const original = lookup.get(id);
    if (original && !original.deletedAt && !plan.taskIds.includes(id)) fail("growth_plan_preserve_tasks", "原已排任务不能因降级草稿而丢失，保留原ID与排期");
  }
  if (!isExecutableWorkflowPlan(plan.status)) return;
  const addsRoutineWork = plan.taskIds.some(id => !previous?.taskIds.includes(id) && !isSeoExtraCapacity(lookup.get(id)?.capacityClass));
  if (range.start >= "2026-11-27" && !plan.strategyAllocation && !(previous && isExecutableWorkflowPlan(previous.status) && !addsRoutineWork)) fail("quarter_allocation_required", "新增常规工作须落实已审业务投入及本地研究预算；已授权热点沿原计划额外追加，不挤占原名额");
  if (previous?.strategyAllocation && !plan.strategyAllocation) fail("quarter_allocation_immutable", "保留原季度方案与投入回执");
  // Other plans can still use their original Monday keys. Count their task IDs once.
  const selected = new Set(plan.taskIds);
  for (const row of all) if (row.kind === "plan" && row.record.id !== plan.id && (isExecutableWorkflowPlan(row.record.status) || (row.record as WorkflowPlan).committedTaskIds !== undefined)) {
    for (const id of (row.record as WorkflowPlan).taskIds) { const task = lookup.get(id); if (task && day(task) >= range.start && day(task) <= range.end) selected.add(id); }
  }
  const routine = [...selected].map(id => lookup.get(id)).filter((task): task is WorkflowTask => Boolean(task && !task.deletedAt && !isSeoExtraCapacity(task.capacityClass)));
  const allocation = plan.strategyAllocation;
  const currentLanguagePolicy = range.start >= ROUTINE_LANGUAGE_START;
  const committedIds = new Set(all.flatMap(row => {
    if (row.kind !== "plan") return [];
    const existing = row.record as WorkflowPlan;
    return isExecutableWorkflowPlan(existing.status) ? existing.taskIds : existing.committedTaskIds ?? [];
  }));
  const addedKeywordWork = tasks.some(task => task && isRoutineKeywordTask(task) && !committedIds.has(task.id));
  if (allocation) {
    if (all.some(row => row.kind === "plan" && row.record.id !== plan.id && (isExecutableWorkflowPlan(row.record.status) || (row.record as WorkflowPlan).committedTaskIds !== undefined) && (row.record as WorkflowPlan).strategyAllocation && "executionRange" in (row.record as WorkflowPlan).targets && JSON.stringify(((row.record as WorkflowPlan).targets as { executionRange: typeof range }).executionRange) === JSON.stringify(range))) fail("allocation_business_week_duplicate", "同业务周已有投入计划，沿原ID修订，不能跨Monday桶重复分配预算");
    // The new Flatkey allowance is separate from the approved quarterly delivery budget.
    const delivery = (task: WorkflowTask) => ["blog", "landing", "optimization"].includes(task.kind) && !flatkeyLanding(task) && !isSeoExtraCapacity(task.capacityClass);
    const original = new Set<string>();
    const classified = new Map<string, { bucket: DeliveryBucket; workstreamId: string }>();
    for (const row of all) if (row.kind === "plan" && (isExecutableWorkflowPlan(row.record.status) || (row.record as WorkflowPlan).committedTaskIds !== undefined)) {
      const savedPlan = row.record as WorkflowPlan;
      const futureIds = new Set(savedPlan.strategyAllocation?.tasks.map(task => task.taskId) ?? []);
      for (const id of savedPlan.taskIds) if (!futureIds.has(id)) original.add(id);
      for (const item of savedPlan.strategyAllocation?.tasks ?? []) classified.set(item.taskId, item);
    }
    const capacityStart = allocation.capacityStart ?? range.start;
    const capacityEnd = allocation.capacityEnd ?? range.end;
    if (capacityStart < range.start || capacityStart > range.end || capacityEnd < capacityStart || capacityEnd > range.end) fail("allocation_capacity_window", "剩余容量窗口须在原业务周内，不改原任务dueAt");
    const deliveredBefore = new Set(all.filter(row => row.kind === "publication" && ["published", "verified"].includes(row.record.status) && new Date((row.record as import("./seo-workflow").WorkflowPublication).publishedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) < capacityStart).map(row => (row.record as import("./seo-workflow").WorkflowPublication).taskId));
    const ownDelivery = tasks.filter((task): task is WorkflowTask => Boolean(task && delivery(task) && !deliveredBefore.has(task.id)));
    const mustPreserve = ownDelivery.filter(task => original.has(task.id)).map(task => task.id);
    if (new Set(allocation.preservedTaskIds).size !== allocation.preservedTaskIds.length || mustPreserve.some(id => !allocation.preservedTaskIds.includes(id))) fail("allocation_preserve_original", "预算须保留已排原任务；延期预留仍保留原ID，不把它挪进新日期任务列表");
    for (const id of allocation.preservedTaskIds) {
      const reserved = lookup.get(id);
      if (!reserved || reserved.deletedAt || !delivery(reserved) || deliveredBefore.has(id) || day(reserved) > range.end || !(original.has(id) || reserved.source === "human")) fail("allocation_invalid_reservation", "预留须指向真实尚需交付的原授权内容任务，不能用虚构或已释放任务挤占预算");
    }
    const future = ownDelivery.filter(task => !original.has(task.id));
    const remainingDays = Array.from({ length: 7 }, (_, index) => shiftDay(range.start, index)).filter(date => date >= capacityStart && date <= capacityEnd && isSeoWorkday(new Date(date + "T00:00:00+08:00"))).length;
    const usedLandings = new Set(all.filter(row => row.kind === "publication" && row.record.status === "verified" && (row.record as import("./seo-workflow").WorkflowPublication).kind === "landing" && ["rackrate.org", "modelfit.cc"].includes((row.record as import("./seo-workflow").WorkflowPublication).siteDomain) && new Date((row.record as import("./seo-workflow").WorkflowPublication).publishedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) >= range.start && new Date((row.record as import("./seo-workflow").WorkflowPublication).publishedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) < capacityStart).map(row => (row.record as import("./seo-workflow").WorkflowPublication).pageUrl)).size;
    const totalCapacity = remainingDays ? (targets.contentRefreshPages !== undefined ? 10 : 8) * remainingDays + Math.max(0, targets.clusterLanding - usedLandings) : 0;
    if (allocation.futureBudget.total !== Math.max(0, totalCapacity - allocation.preservedTaskIds.length)) fail("allocation_future_capacity", "未来工作包须扣除剩余业务窗口的真实原任务预留及已完成交付，不补跑过去时段");
    if (new Set(allocation.tasks.map(row => row.taskId)).size !== allocation.tasks.length || JSON.stringify(allocation.tasks.map(row => row.taskId).sort()) !== JSON.stringify(future.map(task => task.id).sort())) fail("allocation_task_coverage", "每个未来交付工作包须唯一归入主攻/基础/试验，不把研究名额或译文重复算交付");
    if (allocation.tasks.some(row => classified.has(row.taskId) && (classified.get(row.taskId)!.bucket !== row.bucket || classified.get(row.taskId)!.workstreamId !== row.workstreamId))) fail("allocation_class_immutable", "已排未来任务保留原投入分类，不能在跨桶或修订时换类凑比例");
    for (const bucket of Object.keys(deliveryWeights(allocation.version)) as DeliveryBucket[]) {
      const actual = allocation.tasks.filter(row => row.bucket === bucket).length;
      const gap = allocation.gaps.filter(row => row.bucket === bucket).reduce((n, row) => n + row.count, 0);
      if (actual + gap !== (allocation.futureBudget.counts as Record<string, number>)[bucket]) fail("allocation_bucket_gap", "投入比例须由真实原任务与明确不足对平，不能为满额造任务");
    }
    if (currentLanguagePolicy && addedKeywordWork) {
      const ownBudgetedIds = new Set(allocation.tasks.map(item => item.taskId));
      const budgeted = routine.filter(task => ownBudgetedIds.has(task.id) || task.kind === "cluster");
      const research = routine.filter(task => task.kind === "research");
      const reservedTasks = allocation.preservedTaskIds.flatMap(id => lookup.get(id) ?? []);
      const dailySlots = new Map(dates.filter(date => date >= capacityStart && date <= capacityEnd).map(date => [date,
        Math.max(0, (maintenance ? 10 : 8) + budgeted.filter(task => task.kind === "landing" && day(task) === date).length
          - reservedTasks.filter(task => task.kind !== "landing" && day(task) === date).length)]));
      const problems = [...routineLanguageProblems({ tasks: budgeted, committedIds, capacity: allocation.futureBudget.total,
        offset: allocation.futureBudget.offset, dailySlots }), ...routineLanguageProblems({ tasks: research, committedIds,
        capacity: allocation.marketResearchBudget.total, offset: allocation.marketResearchBudget.offset })];
      if (problems.length) fail(problems[0].code, problems[0].message);
    }
  }
  const flatkeyBlogs = routine.filter(task => task.siteDomain === "flatkey.ai" && task.kind === "blog");
  const modelFitBlogs = routine.filter(task => task.siteDomain === "modelfit.cc" && task.kind === "blog");
  const landings = routine.filter(task => task.kind === "landing" && !flatkeyLanding(task));
  const flatkeyLandings = routine.filter(flatkeyLanding);
  if (flatkeyLandings.length > flatkeyLandingCap || tasks.filter(task => task && flatkeyLanding(task)).length > targets.landing) fail("flatkey_landing_capacity", "Flatkey新落地页合计每业务周最多2页，跨存储桶只核一次");
  if (new Set(flatkeyLandings.map(task => task.pageUrl)).size !== flatkeyLandings.length) fail("flatkey_landing_duplicate_page", "同一Flatkey目标页只能占用一个新增落地页名额");
  const optimizations = routine.filter(task => task.siteDomain === "flatkey.ai" && task.kind === "optimization" && task.workClass !== "content_refresh");
  const refreshes = routine.filter(task => task.workClass === "content_refresh");
  if (refreshes.length > 2 * workingDays) fail("growth_refresh_shared_capacity", "Flatkey与ModelFit合计翻新每天2篇，不能跨站或跨桶重复排额");
  if (new Set(refreshes.map(task => task.pageUrl)).size !== refreshes.length || refreshes.some(task => routine.some(other => other.id !== task.id && other.pageUrl === task.pageUrl && other.kind === "optimization"))) fail("growth_refresh_duplicate_page", "同一页面本期翻新与普通优化须复用一次交付，不重复建单计数");
  if (flatkeyBlogs.length > 5 * workingDays || modelFitBlogs.length > workingDays || landings.length > targets.clusterLanding || optimizations.length > 2 * workingDays) fail("growth_plan_shared_capacity", "跨计划业务周总量超出原额度，不能在另一个存储桶重复排产");
  if (currentLanguagePolicy) {
    const flatkeyCapacity = 5 * workingDays;
    if (!previous || !isExecutableWorkflowPlan(previous.status) && previous.committedTaskIds === undefined) {
      const budget = routineLanguageBudget(flatkeyCapacity);
      for (const group of ROUTINE_LANGUAGE_GROUPS) {
        const declared = GROWTH_LANGUAGES.filter(language => routineLanguageGroup(language) === group).reduce((total, language) => total + targets.blogLanguages[language], 0);
        if (declared !== budget[group]) fail("growth_plan_language_targets", "新计划的Flatkey源文按中、日、英、西、其他已授权语种各20%分配");
      }
      for (const language of GROWTH_LANGUAGES) {
        const planned = flatkeyBlogs.filter(task => task.language === language);
        if (planned.length > Math.max(targets.blogLanguages[language], planned.filter(task => committedIds.has(task.id)).length)) {
          fail("growth_plan_language_capacity", `${language} 源文超过本期声明名额；可在同组内修正预计语种分配并保留原任务`);
        }
      }
    }
    if (addedKeywordWork) {
      const problems = routineLanguageProblems({ tasks: flatkeyBlogs, committedIds, capacity: flatkeyCapacity,
        dailySlots: new Map(dates.map(date => [date, 5])) });
      if (problems.length) fail(problems[0].code, problems[0].message);
    }
  } else {
    for (const language of GROWTH_LANGUAGES) if (flatkeyBlogs.filter(task => task.language === language).length > targets.blogLanguages[language]) fail("growth_plan_language_capacity", "国家语言源文数量超出当期已确认分配");
    const other = flatkeyBlogs.filter(task => !["en", "ja", "pt-BR", "zh-CN"].includes(task.language ?? ""));
    if (other.length > 2) fail("growth_plan_secondary_markets", "低优先市场合计每周最多2篇源文，翻译另记");
  }
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
  const own = tasks.filter((task): task is WorkflowTask => Boolean(task && !isSeoExtraCapacity(task.capacityClass)));
  for (const [category, count, target] of [
    ["apiBlogs", own.filter(task => task.siteDomain === "flatkey.ai" && task.kind === "blog" && task.business === "API").length, targets.apiBlogs],
    ["gpuBlogs", own.filter(task => task.siteDomain === "flatkey.ai" && task.kind === "blog" && task.business === "GPU").length, targets.gpuBlogs],
    ["optimizedPages", own.filter(task => task.siteDomain === "flatkey.ai" && task.kind === "optimization" && task.workClass !== "content_refresh").length, targets.optimizedPages],
    ["contentRefreshPages", own.filter(task => task.workClass === "content_refresh").length, targets.contentRefreshPages ?? 0],
    ["clusterLanding", own.filter(task => task.kind === "landing" && !flatkeyLanding(task)).length, targets.clusterLanding],
    ["landing", own.filter(flatkeyLanding).length, targets.landing],
  ] as const) if (target - count > gaps(category)) fail("growth_plan_gap", `${category}缺口须如实保存，不用未研究任务补足`);
  // Existing tasks and deliveries are never replaced as a consequence of this plan.
  if (previous && isExecutableWorkflowPlan(previous.status)) for (const id of previous.taskIds) {
    const task = lookup.get(id);
    if (task && !task.deletedAt && !plan.taskIds.includes(id)) fail("growth_plan_preserve_tasks", "计划修订保留已排原任务及其交付日，新增结论沿原ID增补");
  }
}
