import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { envBool } from "@/lib/env";
import { decryptDataForSeoCredentials } from "@/lib/dataforseo-credentials";
import { ImportRequestError } from "@/lib/ranking-import";
import { buildSerpTask, configForSerpRegion, groupSerpMarketQueries, quoteSerpTargets, SERP_CONFIG_ID, SERP_DEFAULT_CONFIG, SERP_MARKETS } from "@/lib/dataforseo-serp";
import { serpTaskId } from "@/lib/dataforseo-serp";
import { buildOptimizedPages, monitorDay, OPTIMIZED_PAGE_MAX_QUERIES, OPTIMIZED_PAGE_SCOPE, optimizedPagePeriod, optimizedPageRank, record,
  type OptimizedPageMutation, type OptimizedPageMonitorResponse } from "@/lib/optimized-page-monitor";
import { loadSerpMonitoringCohort } from "@/lib/services/serp-targets";
import { resumeSerpMonitorRun, submitOptimizedPageBatch } from "@/lib/services/serp-monitor";
import type { SerpMonitorRunDto, SerpTaskState } from "@/lib/serp-monitor-types";

const OPEN = ["PLANNED", "RUNNING", "UNKNOWN"];
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function loadPages() {
  const [rows, cohort] = await Promise.all([
    prisma.keywordSourceRow.findMany({ where: { siteDomain: "flatkey.ai", sourceId: "optimization" }, select: { rowKey: true, snapshot: true } }),
    loadSerpMonitoringCohort("flatkey.ai"),
  ]);
  return buildOptimizedPages(rows, cohort.targets);
}

// Cached reads only. The window keeps two captures per page regardless of how
// many other pages have been checked; a global LIMIT could lose a comparison.
export async function loadOptimizedPageMonitor(now = new Date()): Promise<OptimizedPageMonitorResponse> {
  const [pages, connection, ids, active] = await Promise.all([
    loadPages(), prisma.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" }, select: { loginMasked: true } }),
    prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY "configJson"->>'optimizedPageId' ORDER BY "createdAt" DESC, id DESC) AS n
      FROM "SerpMonitorRun" WHERE scope = 'OPTIMIZED_PAGE'
    ) captures WHERE n <= 2`,
    prisma.serpMonitorRun.findFirst({ where: { scope: OPTIMIZED_PAGE_SCOPE, status: { in: OPEN } }, select: { id: true } }),
  ]);
  const runs = ids.length ? await prisma.serpMonitorRun.findMany({ where: { id: { in: ids.map(row => row.id) } }, orderBy: { createdAt: "desc" },
    include: { tasks: { select: { keyword: true, region: true, state: true, normalizedJson: true, checkedAt: true } } } }) : [];
  const day = monitorDay(now);
  return { day, connectionConfigured: Boolean(connection), externalEnabled: !envBool("DISABLE_EXTERNAL_FETCH"), activeRunId: active?.id ?? null,
    pages: pages.map(page => {
      const captures = runs.filter(run => record(run.configJson).optimizedPageId === page.id), latest = captures[0], previous = captures[1];
      const quote = quoteSerpTargets(page.targets, SERP_MARKETS);
      let run: SerpMonitorRunDto | null = null;
      if (latest) {
        const counts: Partial<Record<SerpTaskState, number>> = {};
        for (const task of latest.tasks) counts[task.state as SerpTaskState] = (counts[task.state as SerpTaskState] ?? 0) + 1;
        run = { id: latest.id, scope: OPTIMIZED_PAGE_SCOPE, status: latest.status as SerpMonitorRunDto["status"], targetCount: latest.targetCount, queryCount: latest.queryCount,
          estimatedCostMicros: latest.estimatedCostMicros, reservedCostMicros: latest.reservedCostMicros, actualCostMicros: latest.actualCostMicros,
          startedAt: latest.startedAt.toISOString(), completedAt: latest.completedAt?.toISOString() ?? null, errorCode: latest.errorCode,
          periodKey: latest.periodKey, periodLabel: latest.periodLabel, periodStart: latest.periodStart.toISOString(), periodEnd: latest.periodEnd.toISOString(), taskCounts: counts };
      }
      return { ...page, queryCount: quote.queryCount, maxCostMicros: quote.maxCostMicros, usedToday: latest?.periodKey === optimizedPagePeriod(page.id, day), run,
        results: latest?.tasks.map(task => optimizedPageRank(page.url, task)) ?? [], previousResults: previous?.tasks.map(task => optimizedPageRank(page.url, task)) ?? [] };
    }) };
}

export async function mutateOptimizedPageMonitor(input: OptimizedPageMutation) {
  if (input.action === "poll") {
    const run = await prisma.serpMonitorRun.findUnique({ where: { id: input.runId } });
    if (!run || run.scope !== OPTIMIZED_PAGE_SCOPE) throw new ImportRequestError("未找到该页面的采集记录", 404);
    // A worker that stopped before its only POST cannot be resumed as a paid
    // action. Close those unsent tasks and preserve today's consumed allowance.
    if (run.status === "PLANNED" && run.createdAt.getTime() < Date.now() - 120_000) {
      await prisma.serpMonitorTask.updateMany({ where: { runId: run.id, state: "PLANNED" }, data: { state: "FAILED", errorCode: "SUBMISSION_NOT_STARTED" } });
    }
    // Free GETs for existing IDs only, never a paid continuation or a new run.
    await resumeSerpMonitorRun(run.id, { allowSubmit: false });
    return { action: "poll", runId: run.id };
  }
  if (envBool("DISABLE_EXTERNAL_FETCH")) throw new ImportRequestError("外部请求已暂停", 409);
  if (input.day !== monitorDay()) throw new ImportRequestError("日期已变化，请刷新后抓取", 409);
  const page = (await loadPages()).find(page => page.id === input.pageId);
  if (!page || !page.targets.length) throw new ImportRequestError("该页面尚无已核实的正式关键词，请先同步优化表并核对页面", 409);
  if (page.hash !== input.expectedHash) throw new ImportRequestError("页面关键词已变化，请刷新后抓取", 409);
  const groups = groupSerpMarketQueries(page.targets), quote = quoteSerpTargets(page.targets, SERP_MARKETS);
  if (groups.length > OPTIMIZED_PAGE_MAX_QUERIES) throw new ImportRequestError("该页关键词超过单次请求上限，请先精简关联词", 409);
  const day = input.day, periodKey = optimizedPagePeriod(page.id, day), runId = `optimized-${day}-${page.id}`;
  const reserved = await prisma.$transaction(async tx => {
    // Shared with recurring submissions: serialize the budget and daily claim.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    if (day !== monitorDay()) throw new ImportRequestError("日期已变化，请刷新后抓取", 409);
    const existing = await tx.serpMonitorRun.findUnique({ where: { periodKey_scope: { periodKey, scope: OPTIMIZED_PAGE_SCOPE } } });
    if (existing) return { id: existing.id, duplicate: true };
    if (await tx.serpMonitorRun.findFirst({ where: { scope: OPTIMIZED_PAGE_SCOPE, status: { in: OPEN } }, select: { id: true } }))
      throw new ImportRequestError("已有页面正在抓取或结果待核对，请先查看原记录", 409);
    const [connection, config, reserved] = await Promise.all([
      tx.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" } }),
      tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } }),
      tx.serpMonitorRun.aggregate({ where: { OR: [{ createdAt: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)) } },
        { completedAt: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)) } }, { status: { in: OPEN } }] }, _sum: { reservedCostMicros: true } }),
    ]);
    if (!connection) throw new ImportRequestError("请先在数据管理保存 DataForSEO 连接", 409);
    decryptDataForSeoCredentials(connection.encryptedCredentials);
    if (quote.maxCostMicros > (config?.maxRunCostMicros ?? SERP_DEFAULT_CONFIG.maxRunCostMicros) ||
      (reserved._sum.reservedCostMicros ?? 0) + quote.maxCostMicros > (config?.maxMonthCostMicros ?? SERP_DEFAULT_CONFIG.maxMonthCostMicros))
      throw new ImportRequestError("已达到排名抓取预算上限", 409);
    const tasks = groups.map(group => {
      const id = serpTaskId(runId, group.queryKey);
      return { id, runId, queryKey: group.queryKey, region: group.region, keyword: group.keyword, targetsJson: json(group.targets),
        state: "PLANNED", requestJson: json(buildSerpTask(group, id, configForSerpRegion(group.region))) };
    });
    await tx.serpMonitorRun.create({ data: { id: runId, scope: OPTIMIZED_PAGE_SCOPE, periodKey, periodLabel: `${day} 页面排名`,
      periodStart: new Date(`${day}T00:00:00+08:00`), periodEnd: new Date(`${day}T23:59:59.999+08:00`), status: "PLANNED",
      cohortHash: page.hash, cohortJson: json(page.targets), configJson: json({ ...SERP_DEFAULT_CONFIG, optimizedPageId: page.id, optimizedPageUrl: page.url, optimizedDay: day,
        connectionHash: createHash("sha256").update(connection.encryptedCredentials).digest("hex") }),
      queryCount: groups.length, targetCount: page.targets.length, estimatedCostMicros: quote.maxCostMicros, reservedCostMicros: quote.maxCostMicros,
      connectionVersion: connection.connectionVersion } });
    await tx.serpMonitorTask.createMany({ data: tasks });
    return { id: runId, duplicate: false };
  }, { maxWait: 10_000, timeout: 30_000 });
  // Commit the daily claim before the only paid POST. An interrupted request
  // keeps its allowance consumed; repeats never retry the provider POST.
  if (!reserved.duplicate) await submitOptimizedPageBatch(reserved.id, page.id);
  return { action: "start", runId: reserved.id, duplicate: reserved.duplicate };
}
