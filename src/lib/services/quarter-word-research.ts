import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isGrowthTopicPlaceholder } from "../seo-growth-markets";
import { quarterMembershipHash, quarterWordKey, QuarterMembershipError } from "../quarter-membership";
import { quarterWordResearchProblem, quarterWordResearchSchema } from "../quarter-word-research";
import { readGrowthStrategy } from "./growth-strategy";

const sourceId = "SEO_QUARTER_AHREFS_WEB";
const auditStatus = "QUARTER_AHREFS_RESEARCH_STAGED";
const asJson = (value: unknown) => value as Prisma.InputJsonValue;

export async function stageQuarterWordResearch(input: unknown, now = new Date()) {
  const command = quarterWordResearchSchema.parse(input), hash = quarterMembershipHash(command);
  const auditId = `quarter-ahrefs-research:${command.requestId}`;
  const words = command.rows.map(row => quarterWordKey(row.keyword));
  if (new Set(words).size !== words.length) throw new QuarterMembershipError("duplicate_research_word", "同批季度研究原词须全局唯一", 422);
  for (const row of command.rows) {
    const problem = quarterWordResearchProblem(row, now);
    if (problem) throw new QuarterMembershipError("research_source_invalid", problem, 422);
  }
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-v1'))`;
    const saved = await tx.keywordCurationAudit.findUnique({ where: { id: auditId } });
    if (saved) {
      if (saved.payloadHash !== hash || saved.status !== auditStatus) throw new QuarterMembershipError("idempotency_conflict", "此请求编号已用于其他研究批次");
      return { status: "STAGED", auditId, replay: true, receipt: saved.summary };
    }
    const strategy = await readGrowthStrategy(tx);
    if (!strategy.baseline?.frozenAt || strategy.baseline.targets.length !== 1600) {
      throw new QuarterMembershipError("stage_window_closed", "新版季度研究准备须保留当前旧基线，启用后只读回原批次");
    }
    const sites = [...new Set(command.rows.map(row => row.siteDomain))].sort();
    for (const site of sites) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${site}`}))`;
    const [topics, activeSites, known] = await Promise.all([
      tx.topic.findMany({ where: { id: { in: [...new Set(command.rows.map(row => row.topicId))] }, active: true }, select: { id: true, text: true, sites: { select: { siteDomain: true } } } }),
      tx.seoSite.findMany({ where: { domain: { in: sites }, active: true }, select: { domain: true } }),
      tx.keyword.findMany({ select: { text: true } }),
    ]);
    const existing = new Set([...known, ...strategy.baseline.targets.map(target => ({ text: target.keyword }))].map(row => quarterWordKey(row.text)));
    for (const row of command.rows) {
      if (existing.has(quarterWordKey(row.keyword))) throw new QuarterMembershipError("research_word_exists", `原词已存在于平台，请沿原词身份核查 ${row.keyword}`);
      const topic = topics.find(topic => topic.id === row.topicId && topic.sites.some(site => site.siteDomain === row.siteDomain));
      if (!topic || isGrowthTopicPlaceholder(topic.text) || !activeSites.some(site => site.domain === row.siteDomain)) throw new QuarterMembershipError("research_topic_inactive", "只能归入原站点已有有效话题", 422);
    }
    const results = command.rows.map(row => ({ ...row, keywordId: randomUUID() }));
    await tx.keyword.createMany({ data: results.map(row => ({ id: row.keywordId, text: row.keyword, topicId: row.topicId, type: "LONG_TAIL" })) });
    await tx.siteKeyword.createMany({ data: results.map(row => ({ siteDomain: row.siteDomain, keywordId: row.keywordId, topicId: row.topicId, pool: "RESEARCH", origin: "RESEARCH", sourceUrl: row.sourceUrl })) });
    await tx.siteKeywordTopic.createMany({ data: results.map(row => ({ siteDomain: row.siteDomain, keywordId: row.keywordId, topicId: row.topicId })) });
    await tx.keywordSourceRow.createMany({ data: results.map(row => ({ siteDomain: row.siteDomain, sourceId, rowKey: `keyword:${row.keywordId}`, snapshot: asJson(row), snapshotHash: quarterMembershipHash(row), observedAt: new Date(row.observedAt) })) });
    const ids = results.map(row => row.keywordId);
    const [members, sources] = await Promise.all([
      tx.siteKeyword.findMany({ where: { keywordId: { in: ids } }, include: { keyword: { select: { text: true } }, topicAssignments: { select: { topicId: true } } } }),
      tx.keywordSourceRow.findMany({ where: { sourceId, rowKey: { in: ids.map(id => `keyword:${id}`) } } }),
    ]);
    if (results.some(row => !members.some(member => member.keywordId === row.keywordId && member.siteDomain === row.siteDomain && member.pool === "RESEARCH"
      && member.topicId === row.topicId && member.keyword.text === row.keyword && member.topicAssignments.some(edge => edge.topicId === row.topicId))
      || !sources.some(source => source.siteDomain === row.siteDomain && source.rowKey === `keyword:${row.keywordId}`
        && source.snapshotHash === quarterMembershipHash(row) && quarterMembershipHash(source.snapshot) === source.snapshotHash))) {
      throw new QuarterMembershipError("research_readback_failed", "原词与来源生产读回未对平，批次未保存");
    }
    const receipt = results.map(({ siteDomain, keywordId, keyword, topicId, country, language, sourceSha256, sourceRow }) =>
      ({ siteDomain, keywordId, keyword, topicId, country, language, sourceSha256, sourceRow }));
    await tx.keywordCurationAudit.create({ data: { id: auditId, siteDomain: "flatkey.ai", payloadHash: hash, status: auditStatus, before: [], after: asJson(receipt), summary: asJson(receipt), appliedAt: now } });
    return { status: "STAGED", auditId, replay: false, receipt };
  }, { maxWait: 10_000, timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
