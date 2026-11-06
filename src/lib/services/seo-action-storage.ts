import { isDeepStrictEqual } from "node:util";
import { prisma } from "@/lib/prisma";
import { createOptimizationRevision, optimizationPlanId, optimizationPlanInputSchema, type OptimizationPlanRecord } from "@/lib/seo-optimization-plans";
import { weeklyActionPlanSchema } from "@/lib/seo-weekly-actions";
import { shiftDay } from "@/lib/seo-date-range";

const siteDomain = "flatkey.ai";
const weeklyKind = "WEEKLY_ACTION";
const optimizationKind = "OPTIMIZATION_PLAN";

export async function readDatabaseWeeklyAction(period: string) {
  const row = await prisma.seoReportVersion.findFirst({
    where: { siteDomain, kind: weeklyKind, ...(period === "latest" ? {} : { periodStart: new Date(period) }) },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { payload: true },
  });
  return row ? weeklyActionPlanSchema.parse(row.payload) : null;
}

export async function saveDatabaseWeeklyAction(input: unknown) {
  const plan = weeklyActionPlanSchema.parse(input);
  const id = `weekly-action:${plan.periodStart}:${Date.parse(plan.preparedAt)}:${plan.status}`;
  await prisma.seoReportVersion.createMany({
    data: {
      id, siteDomain, kind: weeklyKind, periodStart: new Date(plan.periodStart),
      periodEnd: new Date(shiftDay(plan.periodStart, 6)), createdAt: new Date(plan.preparedAt), payload: plan,
    },
    skipDuplicates: true,
  });
  const row = await prisma.seoReportVersion.findUniqueOrThrow({ where: { id }, select: { payload: true } });
  if (!isDeepStrictEqual(weeklyActionPlanSchema.parse(row.payload), plan)) throw new Error("同一版本编号已有不同周计划");
  return plan;
}

export async function readDatabaseOptimizationPlans() {
  const rows = await prisma.seoReportVersion.findMany({
    where: { siteDomain, kind: optimizationKind },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { payload: true },
  });
  const latest = new Map<string, OptimizationPlanRecord>();
  for (const { payload } of rows) {
    const plan = payload as unknown as OptimizationPlanRecord;
    if (!latest.has(plan.id)) latest.set(plan.id, plan);
  }
  return [...latest.values()];
}

export async function saveDatabaseOptimizationPlan(input: unknown) {
  const parsed = optimizationPlanInputSchema.parse(input);
  const id = optimizationPlanId(parsed);
  const prefix = `optimization-plan:${id}:`;
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;
    const previous = await tx.seoReportVersion.findFirst({
      where: { siteDomain, kind: optimizationKind, id: { startsWith: prefix } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { payload: true },
    });
    const plan = createOptimizationRevision(parsed, previous?.payload as unknown as OptimizationPlanRecord | undefined);
    const date = new Date(plan.optimizedAt ?? plan.updatedAt.slice(0, 10));
    await tx.seoReportVersion.create({
      data: {
        id: prefix + plan.revision, siteDomain, kind: optimizationKind, periodStart: date, periodEnd: date,
        createdAt: new Date(plan.updatedAt), payload: plan,
      },
    });
    return plan;
  });
}
