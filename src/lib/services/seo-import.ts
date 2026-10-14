import { createHash } from "node:crypto";
import { Prisma, type Topic } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeDomain, REGION_CODES } from "@/lib/seo";
import { ImportRequestError, type RankingImportPayload } from "@/lib/ranking-import";

const day = (value?: string) => value ? new Date(`${value}T00:00:00Z`) : null;

function checkUrl(url: string, domain: string) {
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password ||
      !(parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) {
    throw new ImportRequestError("排名页面和目标页面必须属于目标网站", 400);
  }
}

export async function importSeo(payload: RankingImportPayload) {
  const siteDomain = normalizeDomain(payload.targetDomain);
  const site = await prisma.seoSite.findUnique({ where: { domain: siteDomain } });
  if (!site?.active) throw new ImportRequestError("目标网站未启用", 400);
  for (const row of [...payload.observations, ...payload.pages]) if (row.url) checkUrl(row.url, siteDomain);
  for (const row of payload.inventory) for (const url of row.targetUrls) checkUrl(url, siteDomain);
  for (const row of payload.traffic) {
    if (site.ga4PropertyId && site.ga4PropertyId !== row.ga4PropertyId) throw new ImportRequestError("GA4 属性与网站不匹配", 400);
  }
  const payloadHash = createHash("sha256").update(JSON.stringify({ ...payload, targetDomain: siteDomain, requestId: undefined })).digest("hex");
  const replay = (batch: { id: string; payloadHash: string; count: number; importedAt: Date }) => {
    if (batch.payloadHash !== payloadHash) throw new ImportRequestError("requestId 已被不同内容使用", 409);
    return { importId: batch.id, imported: batch.count, duplicate: true, importedAt: batch.importedAt.toISOString() };
  };
  const existing = await prisma.rankingImport.findUnique({ where: { requestId: payload.requestId } });
  if (existing) return replay(existing);
  try {
    return await prisma.$transaction(async (tx) => {
      // Serializes batches for a site, including capture completion and inventory upserts.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${siteDomain}`}))`;
      const duplicate = await tx.rankingImport.findUnique({ where: { requestId: payload.requestId } });
      if (duplicate) return replay(duplicate);
      if (payload.traffic.length) {
        const currentSite = await tx.seoSite.findUniqueOrThrow({ where: { domain: siteDomain } });
        if (currentSite.ga4PropertyId && currentSite.ga4PropertyId !== payload.traffic[0].ga4PropertyId) throw new ImportRequestError("GA4 属性与网站不匹配", 400);
        if (!currentSite.ga4PropertyId) await tx.seoSite.update({ where: { domain: siteDomain }, data: { ga4PropertyId: payload.traffic[0].ga4PropertyId } });
      }
      const batch = await tx.rankingImport.create({ data: {
        requestId: payload.requestId, payloadHash, siteDomain,
        count: payload.observations.length + payload.pages.length + payload.inventory.length + payload.traffic.length + payload.topics.length,
      } });
      const topicCache = new Map<string, Topic>();
      async function topic(text: string, parentText?: string): Promise<Topic> {
        const key = `${text}:${parentText ?? ""}`;
        if (topicCache.has(key)) return topicCache.get(key)!;
        const parent = parentText && parentText !== text ? await topic(parentText) : null;
        const value = await tx.topic.upsert({ where: { text }, create: { text, type: parent ? "SUB_TOPIC" : "MAIN", parentId: parent?.id }, update: { active: true } });
        await tx.siteTopic.upsert({ where: { siteDomain_topicId: { siteDomain, topicId: value.id } }, create: { siteDomain, topicId: value.id }, update: {} });
        if (parent) await tx.topicRelation.upsert({ where: { parentId_childId: { parentId: parent.id, childId: value.id } }, create: { parentId: parent.id, childId: value.id }, update: {} });
        topicCache.set(key, value);
        return value;
      }
      for (const row of payload.topics) await topic(row.text, row.parentTopic);
      for (const row of payload.inventory) {
        const assigned = await topic(row.topic, row.parentTopic);
        const keyword = await tx.keyword.findFirst({ where: { text: { equals: row.keyword, mode: "insensitive" } } }) ??
          await tx.keyword.create({ data: { text: row.keyword, topicId: assigned.id } });
        const prior = await tx.siteKeyword.findUnique({ where: { siteDomain_keywordId: { siteDomain, keywordId: keyword.id } } });
        const targetUrls = [...new Set([...(prior?.targetUrls ?? []), ...row.targetUrls])];
        // Curated plans take precedence over research, while all topic assignments remain available.
        const promote = !prior || ["RESEARCH", "DISCOVERED"].includes(prior.origin);
        await tx.siteKeyword.upsert({ where: { siteDomain_keywordId: { siteDomain, keywordId: keyword.id } },
          create: { siteDomain, keywordId: keyword.id, topicId: assigned.id, origin: row.origin, targetUrls, sourceUrl: row.sourceUrl },
          update: { active: true, targetUrls, ...(promote ? { topicId: assigned.id, origin: row.origin, sourceUrl: row.sourceUrl } : {}) },
        });
        await tx.siteKeywordTopic.upsert({ where: { siteDomain_keywordId_topicId: { siteDomain, keywordId: keyword.id, topicId: assigned.id } }, create: { siteDomain, keywordId: keyword.id, topicId: assigned.id }, update: {} });
        for (const region of REGION_CODES) if (row.marketVolumes[region] !== undefined) {
          await tx.keywordVolume.create({ data: { keywordId: keyword.id, region, volume: row.marketVolumes[region]!, source: "csv", fetchedAt: row.volumeObservedAt ? new Date(row.volumeObservedAt) : undefined } });
        }
      }
      const links = await tx.siteKeyword.findMany({ where: { siteDomain, active: true }, include: { keyword: true } });
      const byText = new Map(links.map((link) => [link.keyword.text.toLowerCase(), link.keywordId]));
      for (const row of [...payload.observations, ...payload.pages]) {
        if (byText.has(row.keyword.toLowerCase())) continue;
        if (!payload.allowNewKeywords) throw new ImportRequestError(`关键词不在当前网站列表：${row.keyword}`, 422);
        const assigned = await topic("自然搜索发现词");
        const keyword = await tx.keyword.findFirst({ where: { text: { equals: row.keyword, mode: "insensitive" } } }) ?? await tx.keyword.create({ data: { text: row.keyword, topicId: assigned.id } });
        await tx.siteKeyword.upsert({ where: { siteDomain_keywordId: { siteDomain, keywordId: keyword.id } }, create: { siteDomain, keywordId: keyword.id, topicId: assigned.id, origin: "DISCOVERED" }, update: { active: true } });
        byText.set(row.keyword.toLowerCase(), keyword.id);
      }
      if (payload.capture) {
        const c = payload.capture;
        const prior = await tx.rankingCapture.findUnique({ where: { id: c.id } });
        if (prior && (prior.status === "COMPLETE" || prior.siteDomain !== siteDomain || prior.source !== c.source || prior.region !== c.region || prior.coverage !== c.coverage || prior.captureDate.toISOString().slice(0, 10) !== c.date)) throw new ImportRequestError("采集批次已完成或元信息冲突", 409);
        await tx.rankingCapture.upsert({ where: { id: c.id }, create: { id: c.id, siteDomain, source: c.source, region: c.region, coverage: c.coverage, captureDate: day(c.date)!, status: "PARTIAL" }, update: {} });
      }
      if (payload.observations.length) await tx.keywordObservation.createMany({ data: payload.observations.map((row) => ({
        keywordId: byText.get(row.keyword.toLowerCase())!, importId: batch.id, siteDomain, captureId: payload.capture?.id,
        source: row.source, region: row.region, rank: row.rank ?? null, rankReported: row.rank !== undefined,
        rankStatus: row.rankStatus ?? (row.rank == null ? "no_data" : row.rank <= 100 ? "ranked" : "outside_top100"),
        url: row.url, volume: row.volume, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr,
        periodStart: day(row.periodStart), periodEnd: day(row.periodEnd), collectedAt: new Date(row.collectedAt), dataUpdatedAt: row.dataUpdatedAt ? new Date(row.dataUpdatedAt) : null,
      })) });
      if (payload.pages.length) await tx.keywordPageObservation.createMany({ data: payload.pages.map((row) => ({
        keywordId: byText.get(row.keyword.toLowerCase())!, importId: batch.id, siteDomain, source: row.source, region: row.region,
        url: row.url, rank: row.rank ?? null, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr,
        periodStart: day(row.periodStart), periodEnd: day(row.periodEnd), collectedAt: new Date(row.collectedAt), dataUpdatedAt: row.dataUpdatedAt ? new Date(row.dataUpdatedAt) : null,
      })) });
      if (payload.traffic.length) await tx.weeklyTraffic.createMany({ data: payload.traffic.map((row) => ({
        siteDomain, importId: batch.id, periodStart: day(row.periodStart)!, periodEnd: day(row.periodEnd)!, timezone: row.timezone,
        newUsers: row.newUsers, newRegistrations: row.newRegistrations, ga4PropertyId: row.ga4PropertyId, collectedAt: new Date(row.collectedAt),
      })) });
      if (payload.capture?.complete) await tx.rankingCapture.update({ where: { id: payload.capture.id }, data: { status: "COMPLETE" } });
      return { importId: batch.id, imported: batch.count, duplicate: false, importedAt: batch.importedAt.toISOString() };
    }, { timeout: 55_000, maxWait: 5000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const batch = await prisma.rankingImport.findUnique({ where: { requestId: payload.requestId } });
      if (batch) return replay(batch);
    }
    throw error;
  }
}
