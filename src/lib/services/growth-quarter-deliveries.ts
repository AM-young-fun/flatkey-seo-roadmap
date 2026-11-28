import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shiftDay } from "@/lib/seo-date-range";
import { CLOSEOUT_MARKET_POLICY } from "@/lib/seo-quarter-targets";
import type { QuarterDeliveryTask } from "@/lib/growth-quarter-display";

export async function loadQuarterCommittedDeliveries(local: boolean, range: { executionStart: string; executionEnd: string }) {
  if (local) return [];
  // Workweek storage uses its original Monday key. Restrict to the effective
  // quarter and derive display dates only from committed routine work.
  return prisma.$queryRaw<QuarterDeliveryTask[]>(Prisma.sql`
    WITH planned AS (
      SELECT member."taskId", bool_or(COALESCE(plan.payload #>> '{quarterlyContent,marketPolicy}' = ${CLOSEOUT_MARKET_POLICY}, false)) AS "capacityPlan"
      FROM "SeoWorkflowRecord" plan
      CROSS JOIN LATERAL jsonb_array_elements_text(plan.payload->'taskIds') AS member("taskId")
      WHERE plan.kind = 'plan' AND plan.status IN ('scheduled', 'reviewed')
        AND plan."weekStart" >= ${shiftDay(range.executionStart, -6)}
        AND plan."weekStart" <= ${range.executionEnd}
      GROUP BY member."taskId"
    )
    SELECT task."recordId" AS id, planned."capacityPlan", task."siteDomain", task.payload->>'topicId' AS "topicId", task.payload->>'keywordId' AS "keywordId",
      task.payload->>'keyword' AS keyword, task.payload->>'country' AS country, task.payload->>'language' AS language,
      task.payload #>> '{researchReview,reviewedAt}' AS "reviewedAt",
      (task.payload #>> '{research,volume}')::integer AS volume,
      task.payload->>'dueAt' AS "dueAt"
    FROM "SeoWorkflowRecord" task JOIN planned ON planned."taskId" = task."recordId"
    WHERE task.kind = 'task' AND task.payload->>'deletedAt' IS NULL
      AND task.payload->>'kind' IN ('blog', 'cluster', 'landing')
      AND COALESCE(task.payload->>'capacityClass', 'routine') = 'routine'
      AND (task.payload->>'dueAt')::timestamptz >= (${range.executionStart} || 'T00:00:00+08:00')::timestamptz
      AND (task.payload->>'dueAt')::timestamptz < (${shiftDay(range.executionEnd, 1)} || 'T00:00:00+08:00')::timestamptz
  `);
}
