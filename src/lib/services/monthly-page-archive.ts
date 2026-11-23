import { prisma } from "../prisma";
import { CLUSTER_SITES } from "../seo-cluster-sites";
import { analyticsStorageKind } from "../seo-analytics";
import { timedRead } from "../read-profile";

export function monthlyArchiveScope(targets: readonly { pageUrl: string; siteDomain: string }[]) {
  const sites = new Set(targets.map(page => page.siteDomain));
  const domains = ["flatkey.ai", ...CLUSTER_SITES.map(site => site.domain)].filter(site => sites.has(site));
  const kinds = domains.flatMap(site => ["ga4-pages", "gsc-pages"].map(kind =>
    analyticsStorageKind(kind as "ga4-pages" | "gsc-pages", "all", site === "flatkey.ai" ? undefined : CLUSTER_SITES.find(entry => entry.domain === site)!.domain)));
  return { kinds, urls: [...new Set(targets.map(page => page.pageUrl))],
    paths: [...new Set(targets.map(page => { const url = new URL(page.pageUrl); return url.hostname + url.pathname + url.search; }))] };
}

type ArchiveVersion = { kind: string; date: string; revision: string };
type ProjectedDay = { payload: unknown };
type CachedDay = { revision: string; day: ProjectedDay };
type CachedScope = { days: Map<string, CachedDay>; touched: number };
const scopes = new Map<string, CachedScope>();
const inFlight = new Map<string, Promise<ProjectedDay[]>>();
const dayKey = (day: { kind: string; date: string }) => `${day.kind}:${day.date}`;

// Imported archives have already passed the observation schema. Preserve their
// metadata and every matching row; validate the projected observations again.
function projectArchive(archive: readonly ProjectedDay[], urls: string[], paths: string[]) {
  const urlSet = new Set(urls), pathSet = new Set(paths);
  return archive.map(({ payload }) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { payload };
    const value = payload as Record<string, unknown>;
    if (!Array.isArray(value.rows)) return { payload };
    return { payload: { ...value, rows: value.rows.filter(item => {
      if (!item || typeof item !== "object") return false;
      return value.kind === "gsc-pages" ? urlSet.has(item.url) : value.kind === "ga4-pages" && pathSet.has(item.hostname + item.path);
    }) } };
  });
}
import { Prisma } from "@prisma/client";

export async function loadMonthlyPageArchive(targets: readonly { pageUrl: string; siteDomain: string }[], start: string, end: string) {
  if (!targets.length) return [];
  const { kinds, urls, paths } = monthlyArchiveScope(targets);
  const where = { date: { gte: start, lte: end }, kind: { in: kinds } };
  let versions: ArchiveVersion[];
  try {
    // xmin changes for every row update, including corrections that retain the
    // provider's observedAt. This reads indexed row identities, never JSON rows.
    versions = await timedRead("monthly-revisions", () => prisma.$queryRaw<ArchiveVersion[]>(Prisma.sql`
      SELECT kind, date, xmin::text AS revision FROM "SeoAnalyticsDay"
      WHERE date >= ${start} AND date <= ${end} AND kind IN (${Prisma.join(kinds)})
      ORDER BY kind, date
    `));
  } catch {
    const archive = await timedRead("monthly-revision-fallback", () => prisma.seoAnalyticsDay.findMany({ where, select: { payload: true } }));
    return projectArchive(archive, urls, paths);
  }
  const key = JSON.stringify([start, end, kinds, [...urls].sort(), [...paths].sort()]);
  const flightKey = key + JSON.stringify(versions);
  const pending = inFlight.get(flightKey);
  if (pending) return pending;
  const now = Date.now();
  for (const [entryKey, entry] of scopes) if (now - entry.touched > 300_000) scopes.delete(entryKey);
  const cached = scopes.get(key);
  const changed = versions.filter(day => cached?.days.get(dayKey(day))?.revision !== day.revision);
  const read = async () => {
    const updated = changed.length ? await timedRead("monthly-archive", () => prisma.seoAnalyticsDay.findMany({
      where: { OR: changed.map(({ kind, date }) => ({ kind, date })) }, select: { kind: true, date: true, payload: true },
    })) : [];
    const changedRows = new Map(updated.map(day => [dayKey(day), projectArchive([day], urls, paths)[0]]));
    const days = new Map<string, CachedDay>();
    for (const version of versions) {
      const id = dayKey(version), prior = cached?.days.get(id);
      const day = changedRows.get(id) ?? (prior?.revision === version.revision ? prior.day : undefined);
      if (day) days.set(id, { revision: version.revision, day });
    }
    // Keep only small projected data; dates removed from the archive disappear
    // immediately. Eviction affects performance only, never freshness.
    const result = [...days.values()].map(entry => entry.day);
    if (Buffer.byteLength(JSON.stringify(result)) <= 2_000_000) {
      scopes.delete(key);
      scopes.set(key, { days, touched: Date.now() });
      while (scopes.size > 8) scopes.delete(scopes.keys().next().value!);
    }
    return result;
  };
  const promise = read();
  inFlight.set(flightKey, promise);
  try { return await promise; } finally { inFlight.delete(flightKey); }
}
