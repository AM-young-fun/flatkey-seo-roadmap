import { createHash, randomUUID } from "node:crypto";
import { Prisma, type Topic, type Keyword } from "@prisma/client";
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
  const { dailyRankings, ...legacyPayload } = payload;
  const payloadHash = createHash("sha256").update(JSON.stringify({ ...(dailyRankings.length ? payload : legacyPayload), targetDomain: siteDomain, requestId: undefined })).digest("hex");
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
        count: payload.observations.length + payload.pages.length + payload.inventory.length + payload.traffic.length + payload.topics.length + payload.dailyRankings.length,
      } });
      const topicSpecs = [...payload.topics.map((row) => ({ text: row.text, parent: row.parentTopic })),
        ...payload.inventory.map((row) => ({ text: row.topic, parent: row.parentTopic })),
        ...(payload.allowNewKeywords ? [{ text: "自然搜索发现词", parent: undefined }] : [])];
      const topicTexts = [...new Set(topicSpecs.flatMap((row) => [row.text, ...(row.parent && row.parent !== row.text ? [row.parent] : [])]))];
      const topics = topicTexts.length ? await tx.topic.findMany({ where: { text: { in: topicTexts } } }) : [];
      const topicByText = new Map<string, Topic>(topics.map((row) => [row.text, row]));
      const parentTexts = new Set(topicSpecs.map((row) => row.parent).filter(Boolean));
      const newTopics = topicTexts.filter((text) => !topicByText.has(text)).map((text) => ({ id: randomUUID(), text, type: (!parentTexts.has(text) && topicSpecs.some((row) => row.text === text && row.parent && row.parent !== text) ? "SUB_TOPIC" : "MAIN") as "MAIN" | "SUB_TOPIC" }));
      if (newTopics.length) {
        await tx.topic.createMany({ data: newTopics });
        for (const row of newTopics) topicByText.set(row.text, row as Topic);
      }
      if (topicTexts.length) await tx.siteTopic.createMany({ data: topicTexts.map((text) => ({ siteDomain, topicId: topicByText.get(text)!.id })), skipDuplicates: true });
      const relations = topicSpecs.filter((row) => row.parent && row.parent !== row.text).map((row) => ({ parentId: topicByText.get(row.parent!)!.id, childId: topicByText.get(row.text)!.id }));
      if (relations.length) await tx.topicRelation.createMany({ data: relations, skipDuplicates: true });
      const requestedTexts = [...new Set([...payload.inventory, ...payload.observations, ...payload.pages].map((row) => row.keyword.toLowerCase()))];
      const keywords = requestedTexts.length ? await tx.$queryRaw<Keyword[]>(Prisma.sql`SELECT * FROM "Keyword" WHERE lower("text") IN (${Prisma.join(requestedTexts)})`) : [];
      const priorLinks = requestedTexts.length ? await tx.siteKeyword.findMany({ where: { siteDomain, keywordId: { in: keywords.map((row) => row.id) } } }) : [];
      const linksById = new Map(priorLinks.map((row) => [row.keywordId, row]));
      const groups = new Map<string, Keyword[]>();
      for (const keyword of keywords) groups.set(keyword.text.toLowerCase(), [...(groups.get(keyword.text.toLowerCase()) ?? []), keyword]);
      const keywordByText = new Map<string, Keyword>();
      for (const [key, group] of groups) {
        const tracked = group.filter((keyword) => linksById.get(keyword.id)?.active && linksById.get(keyword.id)?.topicId);
        const candidates = tracked.length ? tracked : group;
        const requested = [...payload.inventory, ...payload.observations, ...payload.pages].find((row) => row.keyword.toLowerCase() === key)!.keyword;
        const selected = candidates.find((keyword) => keyword.text === requested) ?? candidates.find((keyword) => keyword.text === key) ?? (candidates.length === 1 ? candidates[0] : null);
        if (!selected) throw new ImportRequestError(`关键词大小写匹配不唯一：${requested}`, 422);
        keywordByText.set(key, selected);
      }
      const plannedTexts = new Set(payload.inventory.map((row) => row.keyword.toLowerCase()));
      for (const row of [...payload.observations, ...payload.pages]) {
        const known = keywordByText.get(row.keyword.toLowerCase());
        if (!payload.allowNewKeywords && !plannedTexts.has(row.keyword.toLowerCase()) && !(known && linksById.get(known.id)?.active && known.active)) throw new ImportRequestError(`关键词不在当前网站列表：${row.keyword}`, 422);
      }
      const newKeywords = requestedTexts.filter((text) => !keywordByText.has(text)).map((text) => {
        const entry = payload.inventory.find((row) => row.keyword.toLowerCase() === text);
        return { id: randomUUID(), text, topicId: topicByText.get(entry?.topic ?? "自然搜索发现词")!.id };
      });
      if (newKeywords.length) {
        await tx.keyword.createMany({ data: newKeywords });
        for (const row of newKeywords) keywordByText.set(row.text, { ...row, active: true } as Keyword);
      }
      // Merge all assignments and planned URLs before a single membership write.
      const membershipData = new Map<string, { siteDomain: string; keywordId: string; topicId: string; origin: string; targetUrls: string[]; sourceUrl?: string; active: boolean }>();
      const assignments: Array<{ siteDomain: string; keywordId: string; topicId: string }> = [];
      const volumeData: Array<{ keywordId: string; region: (typeof REGION_CODES)[number]; volume: number; source: string; fetchedAt: Date }> = [];
      for (const row of payload.inventory) {
        const keyword = keywordByText.get(row.keyword.toLowerCase())!;
        const prior = membershipData.get(keyword.id) ?? linksById.get(keyword.id);
        const promote = !prior || ["RESEARCH", "DISCOVERED"].includes(prior.origin);
        membershipData.set(keyword.id, { siteDomain, keywordId: keyword.id, active: true,
          topicId: promote ? topicByText.get(row.topic)!.id : prior!.topicId ?? topicByText.get(row.topic)!.id,
          origin: promote ? row.origin : prior!.origin,
          sourceUrl: promote ? row.sourceUrl : prior!.sourceUrl ?? undefined,
          targetUrls: [...new Set([...(prior?.targetUrls ?? []), ...row.targetUrls])],
        });
        assignments.push({ siteDomain, keywordId: keyword.id, topicId: topicByText.get(row.topic)!.id });
        for (const region of REGION_CODES) if (row.marketVolumes[region] !== undefined) volumeData.push({ keywordId: keyword.id, region, volume: row.marketVolumes[region]!, source: "csv", fetchedAt: row.volumeObservedAt ? new Date(row.volumeObservedAt) : new Date() });
      }
      for (const row of [...payload.observations, ...payload.pages]) {
        const keyword = keywordByText.get(row.keyword.toLowerCase())!;
        if (membershipData.has(keyword.id) || linksById.get(keyword.id)?.active) continue;
        membershipData.set(keyword.id, { siteDomain, keywordId: keyword.id, active: true, topicId: topicByText.get("自然搜索发现词")!.id, origin: "DISCOVERED", targetUrls: [] });
      }
      const newLinks = [...membershipData.values()].filter((row) => !linksById.has(row.keywordId));
      if (newLinks.length) await tx.siteKeyword.createMany({ data: newLinks });
      const updates = [...membershipData.values()].filter((row) => {
        const prior = linksById.get(row.keywordId);
        return prior && (prior.topicId !== row.topicId || prior.origin !== row.origin || !prior.active || JSON.stringify(prior.targetUrls) !== JSON.stringify(row.targetUrls) || prior.sourceUrl !== (row.sourceUrl ?? null));
      });
      if (updates.length) {
        const values = updates.map((row) => Prisma.sql`(${row.keywordId}::text, ${row.topicId}::text, ${row.origin}::text, ${JSON.stringify(row.targetUrls)}::jsonb, ${row.sourceUrl ?? null}::text)`);
        await tx.$executeRaw(Prisma.sql`UPDATE "SiteKeyword" AS k SET "topicId" = data.topic, "origin" = data.origin, "targetUrls" = ARRAY(SELECT jsonb_array_elements_text(data.urls)), "sourceUrl" = data.source, "active" = true FROM (VALUES ${Prisma.join(values)}) AS data(id, topic, origin, urls, source) WHERE k."siteDomain" = ${siteDomain} AND k."keywordId" = data.id`);
      }
      if (assignments.length) await tx.siteKeywordTopic.createMany({ data: assignments, skipDuplicates: true });
      if (volumeData.length) await tx.keywordVolume.createMany({ data: volumeData });
      const byText = new Map([...keywordByText.entries()].map(([text, keyword]) => [text, keyword.id]));
      if (payload.capture) {
        const c = payload.capture;
        const prior = await tx.rankingCapture.findUnique({ where: { id: c.id } });
        if (prior && (prior.status === "COMPLETE" || prior.siteDomain !== siteDomain || prior.source !== c.source || prior.region !== c.region || prior.coverage !== c.coverage || prior.captureDate.toISOString().slice(0, 10) !== c.date)) throw new ImportRequestError("采集批次已完成或元信息冲突", 409);
        await tx.rankingCapture.upsert({ where: { id: c.id }, create: { id: c.id, siteDomain, source: c.source, region: c.region, coverage: c.coverage, captureDate: day(c.date)!, status: "PARTIAL" }, update: {} });
      }
      if (payload.observations.length) await tx.keywordObservation.createMany({ data: payload.observations.map((row) => ({
        keywordId: byText.get(row.keyword.toLowerCase())!, importId: batch.id, siteDomain, captureId: payload.capture?.id,
        source: row.source, region: row.region, rank: row.rank ?? null, rankReported: row.rank !== undefined || row.rankStatus !== undefined,
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
        newUsers: row.newUsers, newRegistrations: row.newRegistrations, registrationMetric: row.registrationMetric, ga4PropertyId: row.ga4PropertyId, collectedAt: new Date(row.collectedAt),
      })) });
      if (payload.dailyRankings.length) await tx.dailyRankingReport.createMany({ data: payload.dailyRankings.map((row) => ({
        siteDomain, importId: batch.id, date: day(row.date)!, publishedWeek: day(row.publishForWeek), region: row.region, source: row.source,
        top10: row.top10, top30: row.top30, top50: row.top50, top100: row.top100,
        totalKeywords: row.totalKeywords, rankings: row.rankings, sourceUrl: row.sourceUrl, collectedAt: new Date(row.collectedAt),
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
