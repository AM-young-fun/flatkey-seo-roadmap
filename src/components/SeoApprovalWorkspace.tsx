"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { workflowWeek, shiftWorkflowDay } from "@/lib/seo-workflow";
import { WorkTabs } from "./WorkTabs";
import { PageHeader } from "./PageHeader";
import { SeoPageApprovals } from "./SeoPageApprovals";
import workspace from "./SeoWorkspace.module.css";

export function SeoApprovalWorkspace() {
  const params = useSearchParams();
  const [monday] = useState(() => workflowWeek());
  const requestedWeek = params.get("week");
  const weekStart = requestedWeek === "next" ? shiftWorkflowDay(monday, 7) : requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) && new Date(requestedWeek + "T00:00:00Z").getUTCDay() === 1 ? requestedWeek : monday;
  return <main className={workspace.shell}>
    <PageHeader active="work" />
    <WorkTabs active="approvals" />
    <SeoPageApprovals key={`${params.get("newApproval") ?? ""}:${params.get("taskId") ?? ""}`} weekStart={weekStart} />
  </main>;
}
