"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "./PageHeader";
import { ReportLoading } from "./ReportLoading";
import styles from "./SeoWorkspace.module.css";

const routes = {
  work: ["work", "工作任务"], reports: ["reports", "日周效果"], opportunities: ["opportunities", "关键词目标"],
  "optimization-effects": ["optimization-effects", "优化效果"], automations: ["automations", "定时任务"],
  approvals: ["approvals", "页面审批"], credentials: ["credentials", "接入凭据"], pages: ["pages", "页面数据"],
  manage: ["manage", "数据管理"], keywords: ["keywords", "关键词库"], rankings: ["rankings", "排名记录"],
} as const;

export function RouteLoading() {
  const pathname = usePathname(), segment = pathname?.split("/")[1] ?? "";
  const [active, title] = pathname === "/" ? ["overview", "总览"] as const : routes[segment as keyof typeof routes] ?? ["loading", "页面"] as const;
  return <main className={styles.shell}><PageHeader active={active} /><ReportLoading label={`正在打开${title}…`} /></main>;
}
