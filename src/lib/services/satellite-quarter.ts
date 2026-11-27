import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GROWTH_STRATEGY_KEY, GROWTH_STRATEGY_KIND, growthHash, growthStrategyStoredSchema, type GrowthStrategy } from "../growth-strategy";
import { growthTargetId } from "../growth-workspace";
import { MARKET_ASSIGNMENT_SOURCE_ID } from "../keyword-market-policy";
import { QuarterMembershipError, quarterMembershipHash, quarterWordKey } from "../quarter-membership";
import { quarterWordResearchProblem } from "../quarter-word-research";
import { SATELLITE_QUARTER_SITES, SATELLITE_QUARTER_VERSION, SATELLITE_QUARTER_EXTENSION_VERSION, satelliteQuarterBound, satelliteQuarterCommandSchema,
  satelliteQuarterAppliedAt, satelliteQuarterCounts, satelliteQuarterHash, satelliteQuarterInputRowSchema, satelliteQuarterProblem,
  satelliteQuarterStoredSchema, type SatelliteQuarter } from "../satellite-quarter";
import { GROWTH_EXECUTION_SITES, isGrowthTopicPlaceholder } from "../seo-growth-markets";
import { readGrowthStrategy } from "./growth-strategy";
import { verifiedWorkflowMarketAssignment } from "./keyword-market-assignment";

const researchSourceId = "SEO_SATELLITE_QUARTER_AHREFS_WEB";
const asJson = (value: unknown) => value as Prisma.InputJsonValue;
const eventId = (requestId: string) => `growth:satellite-quarter:${requestId}`;
const rowKey = (keywordId: string) => `keyword:${keywordId}`;
const txOptions = { maxWait: 10_000, timeout: 90_000 };

function verifiedSelection(state: GrowthStrategy, requestId: string) {
  const pool = satelliteQuarterBound(state);
  if (!pool || pool.requestId !== requestId) throw new QuarterMembershipError("satellite_receipt_unbound", "两站季度词须关联原冻结版本与入库请求", 409);
  return pool;
}

async function readVerifiedSources(tx: Prisma.TransactionClient, pool: SatelliteQuarter, at: Date) {
  const ids = pool.members.map(row => row.keywordId);
  const [members, sources, sites, topics] = await Promise.all([
    tx.siteKeyword.findMany({ where: { keywordId: { in: ids }, siteDomain: { in: [...SATELLITE_QUARTER_SITES] } },
      include: { keyword: { select: { text: true, active: true } }, topicAssignments: { select: { topicId: true } } } }),
    tx.keywordSourceRow.findMany({ where: { sourceId: { in: [researchSourceId, MARKET_ASSIGNMENT_SOURCE_ID] },
      rowKey: { in: ids.map(rowKey) } } }),
    tx.seoSite.findMany({ where: { domain: { in: [...SATELLITE_QUARTER_SITES] }, active: true }, select: { domain: true } }),
    tx.topic.findMany({ where: { id: { in: [...new Set(pool.members.map(row => row.topicId))] }, active: true },
      select: { id: true, text: true, sites: { select: { siteDomain: true } } } }),
  ]);
  const proven = pool.members.map(row => {
    const member = members.find(value => value.siteDomain === row.siteDomain && value.keywordId === row.keywordId);
    const source = sources.find(value => value.siteDomain === row.siteDomain && value.rowKey === rowKey(row.keywordId) && value.sourceId === researchSourceId);
    const market = sources.find(value => value.siteDomain === row.siteDomain && value.rowKey === rowKey(row.keywordId) && value.sourceId === MARKET_ASSIGNMENT_SOURCE_ID);
    const assignment = verifiedWorkflowMarketAssignment(market?.snapshot, market?.snapshotHash);
    const { data: raw } = satelliteQuarterInputRowSchema.safeParse(source?.snapshot);
    if (!sites.some(site => site.domain === row.siteDomain) || !topics.some(topic => topic.id === row.topicId
      && !isGrowthTopicPlaceholder(topic.text) && topic.sites.some(site => site.siteDomain === row.siteDomain))
      || !member?.active || !member.keyword.active || member.pool !== "FORMAL" || member.keyword.text !== row.keyword
      || member.topicId !== row.topicId || !member.topicAssignments.some(edge => edge.topicId === row.topicId)
      || !raw || source?.snapshotHash !== quarterMembershipHash(raw) || raw.keyword !== row.keyword || raw.topicId !== row.topicId
      || raw.siteDomain !== row.siteDomain || raw.country !== row.country || raw.language !== row.language
      || raw.sourceSha256 !== row.sourceSha256 || raw.sourceRow !== row.sourceRow || raw.observedAt !== row.observedAt
      || raw.sourceUrl !== row.sourceUrl || raw.sourceFile !== row.sourceFile || raw.volume !== row.volume
      || source.observedAt?.toISOString() !== new Date(row.observedAt).toISOString()
      || raw.researchDate !== row.researchDate || quarterWordResearchProblem(raw, at)
      || !assignment
      || assignment.primaryCountry !== row.country || assignment.language !== row.language) {
      throw new QuarterMembershipError("satellite_readback_changed", `两站正式成员、原题或来源读回未对平：${row.keyword}`, 409);
    }
    return raw;
  });
  if (satelliteQuarterHash(proven) !== pool.selectionHash) {
    throw new QuarterMembershipError("satellite_selection_changed", "确切两站来源清单的读回哈希不一致", 409);
  }
  return proven;
}
async function verifyReadback(tx: Prisma.TransactionClient, pool: SatelliteQuarter, at: Date) {
  await readVerifiedSources(tx, pool, at);
  return { status: "SATELLITE_QUARTER_APPLIED" as const, readbackVerified: true, siteCounts: satelliteQuarterCounts(pool), pool };
}

export async function loadSatelliteQuarterReceipt(requestId: string) {
  return prisma.$transaction(async tx => {
    const event = await tx.seoWorkflowEvent.findUnique({ where: { requestId: eventId(requestId) } });
    if (!event || event.recordKey !== GROWTH_STRATEGY_KEY) {
      throw new QuarterMembershipError("satellite_receipt_missing", "尚无该两站季度词请求回执，先保留原请求编号", 404);
    }
    const original = growthStrategyStoredSchema.parse(event.payload);
    const pool = verifiedSelection(original, requestId);
    const current = await readGrowthStrategy(tx);
    const historical = current.satelliteQuarter?.requestId !== requestId || current.baseline?.planHash !== pool.baselinePlanHash;
    if (!historical && growthHash(current.satelliteQuarter) !== growthHash(pool)) throw new QuarterMembershipError("satellite_receipt_changed", "生产两站补充批次与原确切回执不一致");
    return { ...await verifyReadback(tx, pool, new Date(satelliteQuarterAppliedAt(pool))), strategyVersion: event.version, currentVersion: current.version,
      ...(historical ? { historical: true } : {}) };
  }, { ...txOptions, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function applySatelliteQuarter(input: unknown, actor: SatelliteQuarter["actor"], now = new Date()) {
  const command = satelliteQuarterCommandSchema.parse(input);
  const requestId = eventId(command.requestId);
  const requestHash = growthHash({ actor, command });
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-v1'))`;
    const replay = await tx.seoWorkflowEvent.findUnique({ where: { requestId } });
    const current = await readGrowthStrategy(tx);
    if (replay) {
      if (replay.requestHash !== requestHash || replay.recordKey !== GROWTH_STRATEGY_KEY) {
        throw new QuarterMembershipError("idempotency_conflict", "同一请求编号已用于不同的两站季度词批次");
      }
      const pool = verifiedSelection(growthStrategyStoredSchema.parse(replay.payload), command.requestId);
      if (growthHash(verifiedSelection(current, command.requestId)) !== growthHash(pool)) {
        throw new QuarterMembershipError("satellite_receipt_changed", "生产两站补充批次与原确切回执不一致");
      }
      return { ...await verifyReadback(tx, pool, new Date(satelliteQuarterAppliedAt(pool))), strategyVersion: replay.version, replay: true };
    }
    if (current.version !== command.expectedVersion) throw new QuarterMembershipError("version_conflict", "季度策略已更新，请先重新读取当前生产版本");
    if (current.satelliteQuarter && command.mode !== "extend") throw new QuarterMembershipError("satellite_already_applied", "两站季度词批次已确认，沿原回执查证");
    const problem = satelliteQuarterProblem(command, current, now);
    if (problem) throw new QuarterMembershipError("satellite_scope_invalid", problem, 422);
    for (const site of [...GROWTH_EXECUTION_SITES].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${site}`}))`;
    const preserved = command.mode === "extend" ? current.satelliteQuarter : undefined;
    const previousSources = preserved ? await readVerifiedSources(tx, preserved, new Date(satelliteQuarterAppliedAt(preserved))) : [];
    const [sites, topics, known, existingContent] = await Promise.all([
      tx.seoSite.findMany({ where: { domain: { in: [...SATELLITE_QUARTER_SITES] }, active: true }, select: { domain: true } }),
      tx.topic.findMany({ where: { id: { in: [...new Set(command.rows.map(row => row.topicId))] }, active: true }, select: { id: true, text: true, sites: { select: { siteDomain: true } } } }),
      tx.keyword.findMany({ select: { text: true } }),
      tx.$queryRaw<{ keyword: string }[]>`SELECT payload->>'keyword' AS keyword FROM "SeoWorkflowRecord" WHERE kind IN ('task', 'publication') AND payload->>'keyword' IS NOT NULL`,
    ]);
    const knownWords = new Set([...known.map(row => row.text), ...existingContent.map(row => row.keyword)].map(quarterWordKey));
    for (const row of command.rows) {
      if (knownWords.has(quarterWordKey(row.keyword))) throw new QuarterMembershipError("satellite_existing_word", `${row.keyword} 已有原词或原内容任务`, 422);
      if (!sites.some(site => site.domain === row.siteDomain) || !topics.some(topic => topic.id === row.topicId
        && !isGrowthTopicPlaceholder(topic.text) && topic.sites.some(site => site.siteDomain === row.siteDomain))) {
        throw new QuarterMembershipError("satellite_topic_invalid", `${row.keyword} 仅能归入本站已有真实有效话题`, 422);
      }
    }
    const rows = command.rows.map(row => ({ row, keywordId: randomUUID() }));
    if (rows.length) {
      await tx.keyword.createMany({ data: rows.map(({ row, keywordId }) => ({ id: keywordId, text: row.keyword, topicId: row.topicId, type: "LONG_TAIL" })) });
      await tx.siteKeyword.createMany({ data: rows.map(({ row, keywordId }) => ({ siteDomain: row.siteDomain, keywordId, topicId: row.topicId,
      pool: "FORMAL", origin: "RESEARCH", sourceUrl: row.sourceUrl })) });
    await tx.siteKeywordTopic.createMany({ data: rows.map(({ row, keywordId }) => ({ siteDomain: row.siteDomain, keywordId, topicId: row.topicId })) });
    await tx.keywordSourceRow.createMany({ data: rows.flatMap(({ row, keywordId }) => {
      const identity = { siteDomain: row.siteDomain, rowKey: rowKey(keywordId) };
      const assignment = { primaryCountry: row.country, language: row.language, secondaryMarkets: [],
        evidence: `Ahrefs 原网页导出（${row.observedAt}）${row.sourceUrl}#${row.sourceSha256}:${row.sourceRow}`, reviewedAt: now.toISOString() };
      return [
        { ...identity, sourceId: researchSourceId, snapshot: asJson(row), snapshotHash: quarterMembershipHash(row), observedAt: new Date(row.observedAt) },
        { ...identity, sourceId: MARKET_ASSIGNMENT_SOURCE_ID, snapshot: assignment, snapshotHash: quarterMembershipHash(assignment), observedAt: now },
      ];
      }) });
    }
    const actorStamp = actor === "collector" ? { actor, appliedAt: now.toISOString() } : { actor, approvedAt: now.toISOString() };
    const pool = satelliteQuarterStoredSchema.parse({ version: preserved ? SATELLITE_QUARTER_EXTENSION_VERSION : SATELLITE_QUARTER_VERSION, requestId: command.requestId,
      ...actorStamp, baselinePlanHash: current.baseline!.planHash,
      selectionHash: satelliteQuarterHash([...previousSources, ...command.rows]), members: [...(preserved?.members ?? []), ...rows.map(({ row: { excerpt: _excerpt, ...row }, keywordId }) => ({
        ...row, keywordId, targetId: growthTargetId(row.siteDomain, row.keyword, row.country, row.language),
      }))] });
    const next: GrowthStrategy = { ...current, satelliteQuarter: pool, version: current.version + 1, updatedAt: now.toISOString() };
    const stored = await tx.seoWorkflowRecord.updateMany({ where: { key: GROWTH_STRATEGY_KEY, version: current.version },
      data: { version: next.version, payload: asJson(next) } });
    if (stored.count !== 1) throw new QuarterMembershipError("version_conflict", "季度策略写入期间已变化，请先读回");
    await tx.seoWorkflowEvent.create({ data: { requestId, requestHash, recordKey: GROWTH_STRATEGY_KEY,
      kind: GROWTH_STRATEGY_KIND, version: next.version, payload: asJson(next) } });
    if (growthHash(await readGrowthStrategy(tx)) !== growthHash(next)) {
      throw new QuarterMembershipError("satellite_state_readback_failed", "季度状态原样读回未对平，未保存两站批次");
    }
    return { ...await verifyReadback(tx, pool, now), strategyVersion: next.version, replay: false };
  }, { ...txOptions, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
