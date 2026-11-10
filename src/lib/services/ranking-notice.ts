import { keywordCyclePlan } from "@/lib/keyword-cycle";
import { prisma } from "@/lib/prisma";
import { serpPeriod } from "@/lib/serp-periods";

// Only periods after the notification rollout are eligible.
const firstNotifiedPeriod = "2026-11-17";
const rankingFinalStatuses = ["COMPLETED", "PARTIAL", "FAILED", "UNKNOWN"];
const discoveryReviewStatuses = ["FAILED", "UNKNOWN", "IMPORT_FAILED"];

async function readPeriodNotice(now: Date, key: string) {
  const { period, jobs } = keywordCyclePlan(now, key);
  const dueAt = new Date(period.dueAt);
  if (key < firstNotifiedPeriod || dueAt > now) return null;

  const [rankings, discovery] = await Promise.all([
    prisma.serpMonitorRun.findUnique({
      where: { periodKey_scope: { periodKey: key, scope: "SCHEDULED" } },
      select: {
        id: true, startedAt: true, status: true, queryCount: true, actualCostMicros: true,
        tasks: {
          where: {
            submittedAt: { gte: dueAt },
            OR: [
              { providerTaskId: { not: null } },
              { submissionRaw: { not: null } },
              { errorCode: "SUBMISSION_OUTCOME_UNKNOWN" },
            ],
          },
          select: { id: true },
          take: 1,
        },
      },
    }),
    prisma.dataForSeoRun.findMany({
      where: { requestId: { in: jobs.map(job => job.requestId) } },
      select: { createdAt: true, collectedAt: true, status: true, actualCostMicros: true, errorCode: true },
    }),
  ]);

  // A manually advanced cycle must not generate the scheduled result notice.
  if ((rankings && rankings.startedAt < dueAt) || discovery.some(row => row.createdAt < dueAt)) return null;

  const title = `DataForSEO · ${period.label}`;
  if (!rankings) {
    const failedAfterRequest = discovery.some(row => discoveryReviewStatuses.includes(row.status) &&
      (row.collectedAt || row.errorCode === "DISCOVERY_RESPONSE_UNCONFIRMED"));
    if (failedAfterRequest) {
      return { period: key, title, text: `${title} · 新词采集需处理，排名未开始，费用待结算。` };
    }
    return null;
  }

  if (!rankings.tasks.length || !rankingFinalStatuses.includes(rankings.status)) return null;

  const completed = await prisma.serpMonitorTask.count({
    where: { runId: rankings.id, state: "COMPLETE" },
  });
  const status = rankings.status === "COMPLETED" ? "完成"
    : rankings.status === "PARTIAL" ? "部分完成"
      : rankings.status === "FAILED" ? "失败" : "需处理";
  let cost = "费用待结算";
  if (rankings.status !== "UNKNOWN" && rankings.actualCostMicros !== null &&
      discovery.length === jobs.length && discovery.every(row => row.actualCostMicros !== null)) {
    const total = rankings.actualCostMicros + discovery.reduce((sum, row) => sum + (row.actualCostMicros ?? 0), 0);
    const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 });
    cost = `费用 ${usd.format(total / 1_000_000)}`;
  }
  return {
    period: key,
    title,
    text: `${title} · ${status}，四国排名已核验 ${completed.toLocaleString("en-US")}/${rankings.queryCount.toLocaleString("en-US")} 次，${cost}。`,
  };
}

export async function readRankingNotice(now = new Date()) {
  const current = serpPeriod(now);
  const previous = serpPeriod(new Date(now.getTime() - 14 * 86_400_000));
  return await readPeriodNotice(now, current.key) ?? await readPeriodNotice(now, previous.key);
}
