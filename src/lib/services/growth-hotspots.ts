import "server-only";
import { prisma } from "@/lib/prisma";
import { buildGrowthHotspotView, type HotspotPlan } from "@/lib/growth-hotspots";
import { loadGrowthStrategy } from "./growth-strategy";
import { loadWorkflowSnapshot } from "./seo-workflow";

export async function loadGrowthHotspotView(localPreview = false, now = new Date()) {
  const [strategy, workflow, planRows] = await Promise.all([
    loadGrowthStrategy(localPreview), loadWorkflowSnapshot({ allHistory: true }, localPreview),
    localPreview ? Promise.resolve([]) : prisma.seoWorkflowRecord.findMany({ where: { kind: "plan", status: { in: ["scheduled", "reviewed"] } }, select: { recordId: true, status: true, payload: true } }),
  ]);
  const plans: HotspotPlan[] = planRows.flatMap(row => {
    const plan = row.payload as Record<string, unknown>;
    return plan.id === row.recordId && plan.status === row.status && Array.isArray(plan.taskIds) && plan.taskIds.every(id => typeof id === "string") ? [{ id: row.recordId, status: row.status, taskIds: plan.taskIds as string[] }] : [];
  });
  if (localPreview && workflow.plan) plans.push(workflow.plan);
  return buildGrowthHotspotView(strategy, workflow, plans, now);
}
