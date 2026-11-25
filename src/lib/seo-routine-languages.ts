import type { WorkflowTask } from "./seo-workflow";

export const ROUTINE_LANGUAGE_START = "2026-11-27";
export const ROUTINE_LANGUAGE_GROUPS = ["zh-CN", "ja", "en", "es-ES", "other"] as const;
export type RoutineLanguageGroup = typeof ROUTINE_LANGUAGE_GROUPS[number];
const authorizedOther = new Set(["pt-BR", "fr", "de", "vi", "id"]);
const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });

export function routineLanguageGroup(language: string | null | undefined): RoutineLanguageGroup | null {
  if (language === "zh-CN" || language === "ja" || language === "en" || language === "es-ES") return language;
  return language && authorizedOther.has(language) ? "other" : null;
}

/** Equal shares, with one continuous sequence across uneven daily capacities. */
export function routineLanguageBudget(total: number, offset = 0): Record<RoutineLanguageGroup, number> {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(offset) || total < 0 || offset < 0) throw new RangeError("Invalid routine language capacity");
  const groups = ROUTINE_LANGUAGE_GROUPS.length, equal = Math.floor(total / groups), extra = total % groups;
  return Object.fromEntries(ROUTINE_LANGUAGE_GROUPS.map((language, index) => [language, equal + Number((index - offset % groups + groups) % groups < extra)])) as Record<RoutineLanguageGroup, number>;
}

export function routineDailyLanguageBudgets(days: readonly { date: string; slots: number }[], offset = 0) {
  return [...days].sort((a, b) => a.date.localeCompare(b.date)).map(({ date, slots }) => {
    const counts = routineLanguageBudget(slots, offset);
    offset = (offset + slots % ROUTINE_LANGUAGE_GROUPS.length) % ROUTINE_LANGUAGE_GROUPS.length;
    return { date, counts };
  });
}

export const isRoutineKeywordTask = (task: WorkflowTask) => !task.deletedAt && task.capacityClass !== "authorized_hotspot_extra"
  && Boolean(task.keyword?.trim()) && ["blog", "landing", "optimization", "research", "cluster"].includes(task.kind);

type LanguageProblem = { code: string; message: string };

/** Enforce the aggregate share and the same remainder rotation per day. */
export function routineLanguageProblems(options: {
  tasks: readonly WorkflowTask[];
  committedIds: ReadonlySet<string>;
  capacity: number;
  offset?: number;
  dailySlots?: ReadonlyMap<string, number>;
}): LanguageProblem[] {
  const { committedIds, capacity, offset, dailySlots } = options;
  const tasks = options.tasks.filter(isRoutineKeywordTask);
  const additions = tasks.filter(task => !committedIds.has(task.id));
  const scope = additions.find(task => !routineLanguageGroup(task.language));
  if (scope) return [{ code: "routine_keyword_language_scope", message: `任务 ${scope.id} 须使用已核定的原词语种；俄语仅走原翻译流程` }];
  if (!additions.length) return [];

  const count = (rows: readonly WorkflowTask[], group: RoutineLanguageGroup) => rows.filter(task => routineLanguageGroup(task.language) === group).length;
  const remaining = routineLanguageBudget(capacity, offset), priorTasks = tasks.filter(task => committedIds.has(task.id));
  for (const group of ROUTINE_LANGUAGE_GROUPS) {
    // Earlier commitments can exceed today's target; they keep their slots,
    // while further work in a full group is held for a later allocation.
    if (count(tasks, group) > Math.max(remaining[group], count(priorTasks, group))) {
      return [{ code: "routine_weekly_language_capacity", message: `新关键词任务的 ${group} 周语种名额已满；保留已排任务，并如实记录其他合格语种的缺口` }];
    }
  }
  const dayBudgets = dailySlots ? routineDailyLanguageBudgets([...dailySlots].map(([date, slots]) => ({ date, slots })), offset) : [];
  for (const { date, counts } of dayBudgets) {
    const dayTasks = tasks.filter(task => localDate.format(new Date(task.dueAt)) === date);
    const prior = dayTasks.filter(task => committedIds.has(task.id));
    for (const group of ROUTINE_LANGUAGE_GROUPS) if (count(dayTasks, group) > Math.max(counts[group], count(prior, group))) {
      return [{ code: "routine_daily_language_capacity", message: `${date} 的 ${group} 语种任务超出当日名额；保留原计划并在后续原时段平衡语种` }];
    }
  }
  return [];
}
