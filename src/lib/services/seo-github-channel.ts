import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { githubChannelSchema, githubChannelId, type GithubChannel } from "../seo-github-channel";

export async function saveGithubChannel(input: unknown) {
  const record = githubChannelSchema.parse(input), id = githubChannelId(record);
  const dates = [...record.views.days, ...record.clones.days].map(row => row.date).sort();
  await prisma.seoReportVersion.createMany({ data: { id, kind: "GITHUB_CHANNEL", siteDomain: "flatkey.ai", periodStart: new Date(dates[0] || record.observedAt.slice(0, 10)), periodEnd: new Date(dates.at(-1) || record.observedAt.slice(0, 10)), createdAt: new Date(record.observedAt), payload: record as Prisma.InputJsonValue }, skipDuplicates: true });
  const saved = await prisma.seoReportVersion.findUniqueOrThrow({ where: { id }, select: { payload: true } });
  const readback = githubChannelSchema.parse(saved.payload);
  if (githubChannelId(readback) !== id) throw Error("github_readback_failed");
  return { stored: true, storage: "database", id, record: readback };
}
export async function loadGithubChannels(start: string, end: string): Promise<GithubChannel[]> {
  const rows = await prisma.seoReportVersion.findMany({ where: { kind: "GITHUB_CHANNEL", periodStart: { lte: new Date(end) }, periodEnd: { gte: new Date(start) } }, orderBy: { createdAt: "desc" }, take: 400, select: { payload: true } });
  return rows.flatMap(({ payload }) => { const parsed = githubChannelSchema.safeParse(payload); return parsed.success ? [parsed.data] : []; });
}
