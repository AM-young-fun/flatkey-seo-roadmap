import { randomUUID } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
const compress = promisify(gzip), decompress = promisify(gunzip);
export type DisplayBuild = { value: object; keywordRows?: unknown[] };
export type DisplaySpec = { key: string; build: () => Promise<DisplayBuild> };
type Row = { body: Uint8Array | null; revision: number; builtRevision: number; builtAt: Date | null; leaseUntil: Date | null };
export type DisplayRead = { body: string; generatedAt: string; stale: boolean };

// Durable leases make this work across cold workers and deployments. Source
// invalidation during a build stays dirty: only the claimed revision is published.
export async function rebuildDisplaySnapshot(spec: DisplaySpec): Promise<boolean> {
  const token = randomUUID();
  const claimed = await prisma.$queryRaw<Array<{revision:number}>>`
    INSERT INTO "DisplaySnapshot" (key, "leaseToken", "leaseUntil") VALUES (${spec.key}, ${token}, NOW() + INTERVAL '4 minutes')
    ON CONFLICT (key) DO UPDATE SET "leaseToken" = EXCLUDED."leaseToken", "leaseUntil" = EXCLUDED."leaseUntil"
    WHERE ("DisplaySnapshot"."leaseUntil" IS NULL OR "DisplaySnapshot"."leaseUntil" < NOW())
      AND ("DisplaySnapshot".body IS NULL OR "DisplaySnapshot"."revision" > "DisplaySnapshot"."builtRevision")
    RETURNING revision`;
  if (!claimed.length) return false;
  try {
    const { value, keywordRows } = await spec.build();
    const generatedAt = new Date().toISOString();
    const body = await compress(JSON.stringify({ ...value, displaySnapshot: { generatedAt, revision: claimed[0].revision } }));
    await prisma.$executeRaw`UPDATE "DisplaySnapshot" SET body = ${body}, "keywordRows" = ${keywordRows ? JSON.stringify(keywordRows) : null}::jsonb,
      "builtRevision" = ${claimed[0].revision}, "builtAt" = ${new Date(generatedAt)}, "leaseToken" = NULL, "leaseUntil" = NULL, "lastError" = NULL
      WHERE key = ${spec.key} AND "leaseToken" = ${token}`;
    return true;
  } catch (error) {
    await prisma.$executeRaw`UPDATE "DisplaySnapshot" SET "leaseToken" = NULL, "leaseUntil" = NULL, "lastError" = 'BUILD_FAILED'
      WHERE key = ${spec.key} AND "leaseToken" = ${token}`.catch(() => {});
    throw error;
  }
}

export async function readDisplaySnapshot(spec: DisplaySpec): Promise<DisplayRead> {
  const read = () => prisma.$queryRaw<Row[]>`SELECT body, revision, "builtRevision", "builtAt", "leaseUntil" FROM "DisplaySnapshot" WHERE key = ${spec.key}`;
  let row = (await read())[0];
  // Bootstrap only. All subsequent page reads use the persisted result; dirty
  // snapshots are refreshed after the response or by the existing coordinator.
  if (!row?.body) {
    await rebuildDisplaySnapshot(spec);
    row = (await read())[0];
  }
  if (!row?.body || !row.builtAt) throw Object.assign(new Error("Display snapshot is preparing"), { code: "DISPLAY_PREPARING" });
  return { body: (await decompress(row.body)).toString(), generatedAt: row.builtAt.toISOString(), stale: row.revision > row.builtRevision };
}

export async function invalidateDisplaySnapshots() {
  await prisma.$executeRaw`UPDATE "DisplaySnapshot" SET revision = revision + 1 WHERE key LIKE 'display-v1:%'`;
}

// A small source watermark also catches imports from older collectors and
// recovers a transient invalidation failure. It reads no raw SERP responses.
// Updating the watermark and dirty revisions is one atomic database statement.
export async function syncDisplaySourceVersion() {
  await prisma.$executeRaw`
    WITH fingerprint AS (SELECT md5(concat_ws('|',
      'weekly-first-issue-v1',
      (SELECT md5(COALESCE(string_agg(md5(to_jsonb(sk)::text),'' ORDER BY sk."siteDomain",sk."keywordId"),'')) FROM "SiteKeyword" sk),
      (SELECT md5(COALESCE(string_agg(md5(to_jsonb(s)::text),'' ORDER BY s.domain),'')) FROM "SeoSite" s),
      (SELECT md5(COALESCE(string_agg(md5(to_jsonb(s)::text),'' ORDER BY s."siteDomain",s."topicId"),'')) FROM "SiteTopic" s),
      (SELECT md5(COALESCE(string_agg(md5(to_jsonb(s)::text),'' ORDER BY s."siteDomain",s."keywordId",s."topicId"),'')) FROM "SiteKeywordTopic" s),
      (SELECT md5(COALESCE(string_agg(md5(to_jsonb(r)::text),'' ORDER BY r.id),'')) FROM "TopicRelation" r),
      (SELECT concat_ws(':',max("appliedAt")::text,max("restoredAt")::text,count(*)::text) FROM "KeywordCurationAudit"),
      (SELECT max("updatedAt")::text || ':' || count(*)::text FROM "Keyword"),
      (SELECT max("updatedAt")::text || ':' || count(*)::text FROM "Topic"),
      (SELECT md5(COALESCE(string_agg(md5(to_jsonb(r)::text),'' ORDER BY r.id),'')) FROM "KeywordRelation" r),
      (SELECT max("updatedAt")::text || ':' || count(*)::text FROM "KeywordContentTask"),
      (SELECT max("updatedAt")::text || ':' || count(*)::text FROM "KeywordSourceRow"),
      (SELECT max("importedAt")::text || ':' || count(*)::text FROM "RankingImport"),
      (SELECT max("fetchedAt")::text || ':' || count(*)::text FROM "KeywordVolume"),
      (SELECT max("updatedAt")::text || ':' || count(*)::text FROM "SerpMonitorRun"),
      (SELECT max("updatedAt")::text || ':' || count(*)::text FROM "SerpMonitorTask" WHERE "checkedAt" IS NOT NULL OR state IN ('FAILED','UNKNOWN')),
      (SELECT max("importedAt")::text || ':' || count(*)::text FROM "WeeklyTraffic"),
      (SELECT md5(COALESCE(string_agg(md5(to_jsonb(w)::text),'' ORDER BY w."siteDomain",w."periodStart"),'')) FROM "WeeklyReportDraft" w)
    )) AS value), changed AS (
      INSERT INTO "DisplaySnapshot" (key,body) SELECT 'display-source-v1',convert_to(value,'UTF8') FROM fingerprint
      ON CONFLICT (key) DO UPDATE SET body=EXCLUDED.body WHERE "DisplaySnapshot".body IS DISTINCT FROM EXCLUDED.body RETURNING key
    ) UPDATE "DisplaySnapshot" SET revision=revision+1 WHERE key LIKE 'display-v1:%' AND EXISTS(SELECT 1 FROM changed)`;
}
