"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { workflowWeek, shiftWorkflowDay } from "@/lib/seo-workflow";
import { PageHeader } from "./PageHeader";
import { SeoPageApprovals } from "./SeoPageApprovals";
import workspace from "./SeoWorkspace.module.css";
import styles from "./SeoWorkWorkspace.module.css";

export function SeoApprovalWorkspace() {
  const params = useSearchParams();
  const [monday] = useState(() => workflowWeek());
  const requestedWeek = params.get("week");
  const weekStart = requestedWeek === "next" ? shiftWorkflowDay(monday, 7) : requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) && new Date(requestedWeek + "T00:00:00Z").getUTCDay() === 1 ? requestedWeek : monday;
  return <main className={workspace.shell}>
    <PageHeader active="approvals" />
    <div className={workspace.titleRow}><div><h1 className={workspace.title}>页面审批</h1><p className={styles.subtitle}>逐页核对新增、改稿和翻译的具体版本，再批准发布。所有工作周的待审批统一处理。</p></div></div>
    <SeoPageApprovals key={`${params.get("newApproval") ?? ""}:${params.get("taskId") ?? ""}`} weekStart={weekStart} />
  </main>;
}
