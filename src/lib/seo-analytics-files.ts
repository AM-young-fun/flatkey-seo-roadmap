import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyticsObservationSchema, type AnalyticsObservation } from "./seo-analytics";
import type { DateRange } from "./seo-date-range";
import type { SeoCountry } from "./seo";
import { clusterDomainForProperty, type ClusterDomain } from "./seo-cluster-sites";

export function analyticsDirectory() {
  return process.env.SEO_ANALYTICS_STORE_DIR || join(process.cwd(), ".local", "seo-analytics");
}

export async function writeAnalyticsEvidence(input: unknown) {
  const row = analyticsObservationSchema.parse(input);
  const directory = analyticsDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const site = clusterDomainForProperty(row.property);
  const scope = [row.kind, row.country, site].filter(Boolean).join("~");
  const host = row.kind === "ga4-pages" && row.hostnameDimension === "hostName" ? "~host" : "";
  const key = `${row.date}~${scope}${host}~${row.complete ? 1 : 0}~${Date.parse(row.observedAt)}.json`;
  const path = join(directory, key);
  const temporary = join(directory, "." + randomUUID());
  const contents = JSON.stringify(row);
  try {
    await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(path, "utf8") !== contents) throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function readAnalyticsEvidence(range: DateRange, country: SeoCountry = "all", site?: ClusterDomain) {
  const directory = analyticsDirectory();
  const names = await readdir(directory).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const best = new Map<string, { file: string; quality: number; timestamp: number }>();
  for (const file of names) {
    const match = /^(\d{4}-\d{2}-\d{2})~(ga4-site|ga4-pages|gsc-site|gsc-pages|gsc-page-queries)(?:~([A-Z]{2}))?(?:~((?!host~)[a-z0-9.-]+))?(?:~(host))?~([01])~(\d+)\.json$/.exec(file);
    if (!match || (match[3] ?? "all") !== country || match[4] !== site || match[1] < range.start || match[1] > range.end) continue;
    const key = match[1] + "~" + match[2];
    const entry = { file, quality: Number(match[6]) + (match[5] === "host" ? 2 : 0), timestamp: Number(match[7]) };
    const previous = best.get(key);
    if (!previous || entry.quality > previous.quality || entry.quality === previous.quality && entry.timestamp > previous.timestamp) best.set(key, entry);
  }
  const rows: AnalyticsObservation[] = [];
  for (const [key, entry] of best) {
    const row = analyticsObservationSchema.parse(JSON.parse(await readFile(join(directory, entry.file), "utf8")));
    if (key !== row.date + "~" + row.kind || (row.country ?? "all") !== country || clusterDomainForProperty(row.property) !== site) {
      throw new Error("采集证据文件名与内容不一致");
    }
    rows.push(row);
  }
  return rows;
}
