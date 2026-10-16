import type { KeywordOkrItem } from "@/lib/keyword-okr";
import type { KeywordWorkPlan } from "@/lib/page-audit";

export const CONTENT_ACTION_LABELS = { LINK: "已关联现有页面", EXPAND: "补充现有页面", BUILD: "待建设" } as const;
export type ContentPlanItem = KeywordOkrItem & { workPlan: KeywordWorkPlan };
export function keywordContentPlans(items: KeywordOkrItem[]): ContentPlanItem[] {
  return items.filter((item): item is ContentPlanItem => item.active && item.pool === "FORMAL" && Boolean(item.workPlan));
}
export function contentPlansCsv(items: ContentPlanItem[]): string {
  const cell = (value: string) => `"${(/^[\s]*[=+\-@]/u.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const rows = [["关键词", "原问题", "处理结果", "处理页面", "建议标题或章节", "具体要求或关联依据", "验收标准", "旧关联页面", "核验结论", "核验时间"],
    ...items.map(item => [item.text, item.workPlan.originalVerdict === "CONTENT_GAP" ? "需补内容" : "页面错配",
      CONTENT_ACTION_LABELS[item.workPlan.action], item.workPlan.pageUrls.join("\n"), item.workPlan.proposedTitle,
      item.workPlan.requirements.map((text, index) => `${index + 1}. ${text}`).join("\n"),
      item.workPlan.acceptance.map((text, index) => `${index + 1}. ${text}`).join("\n"),
      item.workPlan.previousPageUrl ?? "", item.latestPageAuditReason ?? "", item.latestPageAuditCheckedAt ?? ""]),
  ];
  return `\uFEFF${rows.map(row => row.map(cell).join(",")).join("\r\n")}`;
}
