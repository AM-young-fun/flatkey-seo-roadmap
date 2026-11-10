import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ImportRequestError } from "@/lib/ranking-import";
import { KEYWORD_MARKET_LANGUAGES, MARKET_ASSIGNMENT_SOURCE_ID, keywordMarketAssignmentSchema, readKeywordMarketAssignment, type KeywordMarket } from "@/lib/keyword-market-policy";

type Evidence = { label: string; url?: string; artifact?: string; observedAt?: string };
/** Called only by an authenticated approved research decision in its transaction. */
export async function syncWorkflowMarketAssignment(tx: Prisma.TransactionClient, input: {
  siteDomain: string; keywordId: string; keyword: string; country: KeywordMarket;
  language: string; evidence: Evidence[]; reviewedAt: string;
}) {
  if (KEYWORD_MARKET_LANGUAGES[input.country] !== input.language) throw new ImportRequestError("关键词国家与语言不一致", 422);
  const reason = input.evidence.map(item => [item.label, item.url ?? item.artifact ?? "", item.observedAt ?? ""].filter(Boolean).join(" · ")).join("; ").slice(0, 2000);
  if (reason.trim().length < 12) throw new ImportRequestError("付费排名国家分配需要明确研究证据", 422);
  const rowKey = `keyword:${input.keywordId}`, identity = { siteDomain: input.siteDomain, sourceId: MARKET_ASSIGNMENT_SOURCE_ID, rowKey };
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-market:${input.siteDomain}:${input.keywordId}`}))`;
  const linked = await tx.siteKeyword.findUnique({ where: { siteDomain_keywordId: { siteDomain: input.siteDomain, keywordId: input.keywordId } }, include: { keyword: { select: { text: true } } } });
  if (!linked || linked.keyword.text.normalize("NFKC").trim().toLowerCase() !== input.keyword.normalize("NFKC").trim().toLowerCase()) throw new ImportRequestError("关键词标识与站点词库不匹配", 409);
  const existing = await tx.keywordSourceRow.findUnique({ where: { siteDomain_sourceId_rowKey: identity } });
  const current = readKeywordMarketAssignment(existing?.snapshot);
  if (existing && !current) throw new ImportRequestError("已有国家分配记录无效，需核实后修复，不能覆盖", 409);
  // Preserve the reviewed primary market. A separately approved market carries
  // its own rationale and extends, rather than silently replacing, that choice.
  const secondaryMarkets = current?.secondaryMarkets.filter(item => item.country !== input.country) ?? [];
  if (current && current.primaryCountry !== input.country) secondaryMarkets.push({ country: input.country, reason });
  const snapshot = keywordMarketAssignmentSchema.parse({
    primaryCountry: current?.primaryCountry ?? input.country,
    language: current?.language ?? input.language,
    secondaryMarkets,
    evidence: current && current.primaryCountry !== input.country ? current.evidence : reason,
    reviewedAt: input.reviewedAt,
  });
  const snapshotHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  await tx.keywordSourceRow.upsert({ where: { siteDomain_sourceId_rowKey: identity },
    create: { ...identity, snapshot: snapshot as unknown as Prisma.InputJsonValue, snapshotHash, observedAt: new Date(input.reviewedAt) },
    update: { snapshot: snapshot as unknown as Prisma.InputJsonValue, snapshotHash, observedAt: new Date(input.reviewedAt) } });
  return snapshot;
}
