import type { DigestWorkPlan } from "./seo-digest";
import { workTaskHref } from "./seo-workspace-routes";

export const reportTaskStatuses: Record<string, string> = {
  planned: "已排期", researching: "研究中", ready: "待领取", drafting: "制作中",
  review_pending: "待审批", missing_materials: "待补测试材料", approved: "待发布",
  published: "已上线 · 待验收", verified: "已验收", observing: "监控中", blocked: "有阻塞", failed: "需处理",
};

/** The task title carries the action; execution instructions stay on the task page. */
export function reportFocusLines(plan?: DigestWorkPlan, fallback: readonly string[] = []) {
  if (plan?.tasks.length) return plan.tasks.filter(task => task.scheduled !== false && !["verified", "observing"].includes(task.status)).slice(0, 3).map(task => {
    const href = workTaskHref({ id: task.id, weekStart: task.weekStart ?? plan.weekStart });
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(new Date(task.dueAt));
    const title = task.title.replace(/[[\]\r\n]/g, " ");
    return `[${title}](https://flatkey-seo-roadmap.vercel.app${href}) · ${[task.country, task.language].filter(Boolean).join(" / ")} · ${date} · ${reportTaskStatuses[task.status] ?? "待核实"}`;
  });
  return fallback.filter(line => line.trim() && !/^\[查看/.test(line)).slice(0, 3).map(line => {
    const first = line.replace(/^(?:[•*-]|\d+[.、])\s*/, "").split(/\s+·\s+/)[0];
    const linked = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/.exec(first);
    if (linked) return `[${linked[1].slice(0, 70)}](${linked[2]})`;
    return first.replace(/(?:\/Users\/|\/private\/|先读|制作前|本轮候选).*$/, "").trim().slice(0, 70);
  }).filter(Boolean);
}
