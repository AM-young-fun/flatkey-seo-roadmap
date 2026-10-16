import type { KeywordContentTask } from "./keyword-okr";

export const PAGE_TASK_LABELS = { NEW: "待建设", EXPAND: "补充现有页面", REUSE: "复用现有页面" } as const;
export const PAGE_TASK_STATUS_LABELS: Record<string, string> = { TODO: "待安排", IN_PROGRESS: "进行中", DONE: "已完成", BLOCKED: "受阻", MERGED: "已合并", RESTORED: "已恢复" };

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

export function pageTaskChecklist(task: KeywordContentTask) {
  return {
    requirements: unique([...(task.requirements ?? []), ...(task.workPlans ?? []).flatMap(plan => plan.requirements)]),
    acceptance: unique([...(task.acceptance ?? []), ...(task.workPlans ?? []).flatMap(plan => plan.acceptance)]),
  };
}

export function matchesPageTask(task: KeywordContentTask, search: string): boolean {
  const query = search.normalize("NFKC").trim().toLocaleLowerCase();
  if (!query) return true;
  const checklist = pageTaskChecklist(task);
  return [task.title, task.plannedUrl, task.reason, task.owner ?? "", ...task.targetUrls, ...task.keywords,
    ...checklist.requirements, ...checklist.acceptance].join("\n").normalize("NFKC").toLocaleLowerCase().includes(query);
}

export function pageTasksCsv(tasks: KeywordContentTask[]): string {
  const cell = (value: string) => `"${(/^[\s]*[=+\-@]/u.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const numbered = (values: string[]) => values.map((value, index) => `${index + 1}. ${value}`).join("\n");
  const rows = [["页面任务", "主要页面或规划地址", "处理方式", "状态", "负责人", "截止时间", "关联关键词", "具体要求", "验收标准", "逐词要求与验收", "核实结论", "可用页面"],
    ...tasks.map(task => {
      const checklist = pageTaskChecklist(task);
      return [task.title, task.plannedUrl, PAGE_TASK_LABELS[task.type], PAGE_TASK_STATUS_LABELS[task.status] ?? task.status, task.owner ?? "", task.dueAt ?? "", task.keywords.join("\n"),
        numbered(checklist.requirements), numbered(checklist.acceptance),
        (task.workPlans ?? []).map(plan => `${plan.keyword}\n具体要求：\n${numbered(plan.requirements)}\n验收标准：\n${numbered(plan.acceptance)}${plan.pageUrls.length ? `\n已核实相关页面：\n${plan.pageUrls.join("\n")}` : ""}`).join("\n\n"),
        task.reason, task.targetUrls.join("\n")];
    }),
  ];
  return `\uFEFF${rows.map(row => row.map(cell).join(",")).join("\r\n")}`;
}
