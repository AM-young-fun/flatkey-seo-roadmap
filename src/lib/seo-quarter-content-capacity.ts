import { GROWTH_LANGUAGES } from "./seo-growth-markets";
import { seoToday, shiftDay } from "./seo-date-range";
import { isRoutineKeywordTask, ROUTINE_LANGUAGE_GROUPS, routineLanguageGroup, routineLanguageProblems } from "./seo-routine-languages";
import { isSeoWorkday } from "./seo-workday";
import { isSeoExtraCapacity } from "./seo-extra-capacity";
import { isExecutableWorkflowPlan, type WorkflowPlan, type WorkflowTask } from "./seo-workflow";
import { WorkflowError, workflowHash, type WorkflowStoredRow } from "./seo-workflow-state";
import { satelliteQuarterBound } from "./satellite-quarter";
import type { GrowthStrategy } from "./growth-strategy";

const workday = (date: string) => isSeoWorkday(new Date(date + "T00:00:00+08:00"));
const dueDay = (task: WorkflowTask) => seoToday(new Date(task.dueAt));
const flatkeyBlog = (task: WorkflowTask) => task.siteDomain === "flatkey.ai" && task.kind === "blog";
const modelFitBlog = (task: WorkflowTask) => task.siteDomain === "modelfit.cc" && task.kind === "blog" && task.country === "US" && task.language === "en";
const flatkeyRefresh = (task: WorkflowTask) => task.siteDomain === "flatkey.ai" && task.workClass === "content_refresh";
const flatkeyLanding = (task: WorkflowTask) => task.siteDomain === "flatkey.ai" && task.kind === "landing";
const satelliteLanding = (task: WorkflowTask) => ["modelfit.cc", "rackrate.org"].includes(task.siteDomain) && task.kind === "landing";
const inQuarter = (day: string, policy: NonNullable<WorkflowPlan["quarterlyContent"]>) => day >= policy.quarterStart && day <= policy.quarterEnd;
const committed = (plan: WorkflowPlan) => isExecutableWorkflowPlan(plan.status) ? plan.taskIds : plan.committedTaskIds ?? [];

export function quarterContentDailyMix(quarterStart: string, dates: readonly string[]) {
  const first = dates[0];
  let number = 0;
  for (let day = quarterStart; first && day < first; day = shiftDay(day, 1)) if (workday(day)) number++;
  return new Map(dates.map(day => {
    const api = number++ % 2 === 0 ? 2 : 3;
    return [day, { api, gpu: 5 - api }];
  }));
}

export function assertQuarterContentCapacity(plan: WorkflowPlan, previous: WorkflowPlan | undefined, all: WorkflowStoredRow[], dates: string[], now: Date) {
  const policy = plan.quarterlyContent, targets = plan.targets;
  if (!policy || !("cadence" in targets) || targets.cadence !== "growth") return;
  const fail = (code: string, message: string): never => { throw new WorkflowError(code, message); };
  if (policy.quarterStart > targets.executionRange.start || targets.executionRange.end > policy.quarterEnd
    || policy.quarterEnd > shiftDay(policy.quarterStart, 120)) fail("quarter_content_window", "业务周须完整归属所绑定的季度");
  if (previous?.quarterlyContent && (policy.quarterStart !== previous.quarterlyContent.quarterStart
    || policy.quarterEnd !== previous.quarterlyContent.quarterEnd || policy.historicalBefore !== previous.quarterlyContent.historicalBefore)) {
    fail("quarter_content_identity", "同一季度排期保留原执行窗口和历史文章截点");
  }
  if (previous?.strategyAllocation && workflowHash(previous.strategyAllocation) !== workflowHash(plan.strategyAllocation)
    || !previous?.strategyAllocation && plan.strategyAllocation) {
    fail("quarter_content_legacy_allocation", "旧投入回执沿原计划保存，新的源文及重写使用独立配额");
  }
  const mix = quarterContentDailyMix(policy.quarterStart, dates);
  const api = [...mix.values()].reduce((total, row) => total + row.api, 0);
  if (targets.apiBlogs !== api || targets.gpuBlogs !== dates.length * 5 - api || targets.optimizedPages !== 0
    || targets.contentRefreshPages !== dates.length * 5) fail("quarter_content_targets", "源文API/GPU交替排产，Flatkey重写每天五篇，独立常规优化额度为零");
  for (const group of ROUTINE_LANGUAGE_GROUPS) {
    const declared = GROWTH_LANGUAGES.filter(language => routineLanguageGroup(language) === group).reduce((n, language) => n + targets.blogLanguages[language], 0);
    if (declared !== dates.length) fail("quarter_content_language_targets", "Flatkey新博客五个语种组各按每工作日一篇分配");
  }
  if (!isExecutableWorkflowPlan(plan.status)) return;
  if (plan.gaps.some(gap => ["apiBlogs", "gpuBlogs", "modelFitBlogs", "contentRefreshPages"].includes(gap.category)
    && (!gap.date || !mix.has(gap.date) || gap.siteDomain !== (gap.category === "modelFitBlogs" ? "modelfit.cc" : "flatkey.ai")))) {
    fail("quarter_content_daily_gaps", "源文和翻新缺口必须标明实际工作日及站点");
  }

  const plans = all.filter(row => row.kind === "plan").map(row => row.record as WorkflowPlan).filter(saved => committed(saved).length || isExecutableWorkflowPlan(saved.status));
  if (plans.some(saved => saved.id !== plan.id && "executionRange" in saved.targets
    && saved.targets.executionRange.start === targets.executionRange.start)) fail("quarter_content_duplicate_week", "同业务周须修订现有正式计划");
  const store = new Map(all.filter(row => row.kind === "task").map(row => [row.record.id, row.record as WorkflowTask]));
  const existingIds = new Set(plans.flatMap(committed));
  const own = plan.taskIds.flatMap(id => store.get(id) ?? []);
  const routine = own.filter(task => !isSeoExtraCapacity(task.capacityClass));
  const additions = routine.filter(task => !existingIds.has(task.id));
  const content = [...routine, ...[...existingIds].filter(id => !plan.taskIds.includes(id)).flatMap(id => store.get(id) ?? [])
    .filter(task => !task.deletedAt && !isSeoExtraCapacity(task.capacityClass) && mix.has(dueDay(task)))];
  for (const task of additions) {
    if (Date.parse(task.dueAt) <= now.getTime()) fail("quarter_content_past_slot", "新增季度交付须安排尚未过去的制作时点");
    if (!(flatkeyBlog(task) || modelFitBlog(task) || flatkeyRefresh(task) || flatkeyLanding(task) || satelliteLanding(task))) {
      fail("quarter_content_scope", "季度常规制作只接纳博客、落地页和Flatkey旧文重写");
    }
    if (flatkeyBlog(task) && !["GPU", "API"].includes(task.business)) fail("quarter_content_blog_mix", "Flatkey源文须明确归为GPU或API");
    if (flatkeyRefresh(task) && (!task.maintenance?.refresh || Date.parse(task.maintenance.refresh.originalPublishedAt) >= Date.parse(policy.historicalBefore))) {
      fail("quarter_content_refresh_history", "季度重写须关联历史截点前的实际首发和原始版本");
    }
  }
  const research = routineLanguageProblems({ tasks: content.filter(task => flatkeyBlog(task) && isRoutineKeywordTask(task)),
    committedIds: existingIds, capacity: dates.length * 5, dailySlots: new Map(dates.map(date => [date, 5])) });
  if (research.length) fail(research[0].code, research[0].message);
  const pageKey = (task: WorkflowTask) => task.pageUrl?.replace(/^https:\/\/www\./iu, "https://").replace(/\/$/u, "");
  const priorRefreshes = [...existingIds].flatMap(id => store.get(id) ?? []).filter(task => !task.deletedAt && flatkeyRefresh(task) && inQuarter(dueDay(task), policy));
  for (const task of additions.filter(flatkeyRefresh)) {
    if (priorRefreshes.some(other => other.id !== task.id && pageKey(other) === pageKey(task))
      || routine.some(other => other.id !== task.id && other.kind === "optimization" && pageKey(other) === pageKey(task))) {
      fail("quarter_content_duplicate_refresh", "同一规范URL在本季度只占一篇旧文重写");
    }
  }
  for (const [date, allowed] of mix) {
    const today = content.filter(task => dueDay(task) === date);
    const blogs = today.filter(flatkeyBlog), apiBlogs = blogs.filter(task => task.business === "API").length;
    const gpuBlogs = blogs.filter(task => task.business === "GPU").length;
    const originalApi = blogs.filter(task => existingIds.has(task.id) && task.business === "API").length;
    const originalGpu = blogs.filter(task => existingIds.has(task.id) && task.business === "GPU").length;
    if (blogs.length > 5 || apiBlogs > Math.max(allowed.api, originalApi) || gpuBlogs > Math.max(allowed.gpu, originalGpu)) {
      fail("quarter_content_daily_blog_mix", `${date} Flatkey博客超出日额度或API/GPU分配，原承诺照原排期`);
    }
    const gaps = (category: WorkflowPlan["gaps"][number]["category"], site: string) => plan.gaps
      .filter(gap => gap.category === category && gap.date === date && gap.siteDomain === site).reduce((n, gap) => n + gap.count, 0);
    const open = 5 - blogs.length;
    const apiGap = Math.min(open, Math.max(0, allowed.api - apiBlogs));
    if (gaps("apiBlogs", "flatkey.ai") !== apiGap || gaps("gpuBlogs", "flatkey.ai") !== open - apiGap
      || today.filter(modelFitBlog).length + gaps("modelFitBlogs", "modelfit.cc") !== 5
      || today.filter(flatkeyRefresh).length + gaps("contentRefreshPages", "flatkey.ai") !== 5) {
      fail("quarter_content_daily_gaps", `${date}正式任务与逐日真实缺口未对平`);
    }
  }
  for (const [category, count, quota] of [
    ["landing", content.filter(flatkeyLanding).length, targets.landing],
    ["clusterLanding", content.filter(satelliteLanding).length, targets.clusterLanding],
  ] as const) {
    if (count + plan.gaps.filter(gap => gap.category === category).reduce((n, gap) => n + gap.count, 0) !== quota) {
      fail("quarter_content_landing_capacity", "落地页实际排期和共享缺口须按原业务周对平");
    }
  }
}

export function quarterContentBindingProblem(plan: WorkflowPlan, strategy: GrowthStrategy, now: Date) {
  const policy = plan.quarterlyContent;
  if (!policy) return null;
  const quarter = [strategy.quarterPlanning, ...(strategy.quarterPlanningHistory ?? [])]
    .find(row => row?.hash === strategy.baseline?.planHash && row?.approval?.hash === row?.hash);
  const satellite = satelliteQuarterBound(strategy);
  if (!quarter || quarter.hash !== policy.quarterPlanHash || quarter.approval?.hash !== quarter.hash
    || strategy.baseline?.planHash !== quarter.hash || policy.quarterStart !== quarter.plan.executionStart
    || policy.quarterEnd !== quarter.plan.executionEnd || satellite?.selectionHash !== policy.satelliteQuarterHash
    || satellite.baselinePlanHash !== quarter.hash || Date.parse(policy.historicalBefore) > now.getTime()) {
    return "季度计划须绑定当前已审批冻结的Flatkey原词、两站词批次及已真实发生的旧文时间截点";
  }
  return null;
}
