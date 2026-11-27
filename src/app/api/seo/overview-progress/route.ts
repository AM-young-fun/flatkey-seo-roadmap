import { prisma } from "@/lib/prisma";
import { analyticsObservationSchema, scopedAnalytics } from "@/lib/seo-analytics";
import { authorizeWorkflow, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { type WorkflowApproval, type WorkflowPlan, type WorkflowPublication, type WorkflowTask } from "@/lib/seo-workflow";
import { latestClosedLa7DayRange, shiftDay } from "@/lib/seo-date-range";
import { monthlyOptimizationChanges, recentPublishedPages } from "@/lib/seo-digest-recent-pages";
import { loadMonthlyPageArchive } from "@/lib/services/monthly-page-archive";
import { overviewTaskProgress, type OverviewProgress } from "@/lib/seo-overview-progress";
import { loadWorkflowSnapshot } from "@/lib/services/seo-workflow";

export const dynamic = "force-dynamic";

async function readWork(localPreview: boolean) {
  if (localPreview) {
    const workflow = await loadWorkflowSnapshot({ allHistory: true }, true);
    const previous = await loadWorkflowSnapshot({ week: shiftDay(workflow.weekStart, -7) }, true);
    return { workflow, plans: [workflow.plan, previous.plan] };
  }
  const rows = await prisma.seoWorkflowRecord.findMany({
    where: { kind: { in: ["task", "plan", "approval", "publication"] } },
    select: { kind: true, payload: true },
  });
  return {
    workflow: {
      tasks: rows.filter(row => row.kind === "task").map(row => row.payload as unknown as WorkflowTask),
      approvals: rows.filter(row => row.kind === "approval").map(row => row.payload as unknown as WorkflowApproval),
      publications: rows.filter(row => row.kind === "publication").map(row => row.payload as unknown as WorkflowPublication),
    },
    plans: rows.filter(row => row.kind === "plan").map(row => row.payload as unknown as WorkflowPlan),
  };
}

async function effectSummary(workflow: Awaited<ReturnType<typeof readWork>>["workflow"], now: Date, localPreview: boolean) {
  const end = latestClosedLa7DayRange(now).end, start = shiftDay(end, -29);
  const window = { trafficStart: start, trafficEnd: end, workEnd: end, workTimezone: "Asia/Shanghai" };
  const targets = [...monthlyOptimizationChanges(workflow, end, now, true, window).values()].map(entry => entry.page);
  const archive = localPreview ? [] : await loadMonthlyPageArchive(targets, shiftDay(end, -59), end);
  const source = archive.flatMap(({ payload }) => {
    const parsed = analyticsObservationSchema.safeParse(payload);
    return parsed.success ? scopedAnalytics([parsed.data]) : [];
  });
  const pages = recentPublishedPages(workflow, source, end, now, true, window, true);
  const sorted = pages.sort((a, b) => b.day.localeCompare(a.day) || a.url.localeCompare(b.url));
  return { start, end, total: sorted.length, comparable: sorted.filter(row => row.before && row.latest).length, pages: sorted.slice(0, 8) };
}

export async function GET(request: Request) {
  try {
    const { localPreview } = await authorizeWorkflow(request);
    const now = new Date();
    const { workflow, plans } = await readWork(localPreview);
    const work: OverviewProgress["work"] = overviewTaskProgress(workflow, plans, now);
    const effects = await effectSummary(workflow, now, localPreview).catch(() => null);
    return Response.json({ work, effects } satisfies OverviewProgress, { headers: workflowHeaders });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
