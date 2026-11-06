import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { propertyToday } from "./seo-date-range";

const page = z.url().max(3000).refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && ["flatkey.ai", "www.flatkey.ai"].includes(url.hostname) && !url.username && !url.password && !url.port && !url.hash;
}, "目标页面须为 Flatkey HTTPS 地址");
const timestamp = z.iso.datetime({ offset: true });
const rank = z.number().finite().int().min(1).max(100).nullable();
const volume = z.number().finite().int().min(0).max(1_000_000_000).nullable();
const baselineSchema = z.object({
  siteRank: rank,
  pageRank: z.null(),
  rankUrl: z.null(),
  volume,
  snapshotGeneratedAt: timestamp.nullable(),
  savedAt: timestamp,
}).strict();
export const optimizationPlanInputSchema = z.object({
  country: z.enum(["US", "JP", "ES", "BR"]),
  keyword: z.string().trim().min(1).max(300),
  pageUrl: page,
  role: z.enum(["primary", "supporting"]),
  targetRank: z.enum(["10", "5", "3"]),
  ctr: z.string().trim().max(20).refine(value => value === "" || /^\d+(?:\.\d+)?$/.test(value) && Number(value) >= 0 && Number(value) <= 100, "CTR 须为 0–100 或留空"),
  notes: z.string().max(4000),
  optimizedAt: z.iso.date().nullable(),
  changes: z.string().max(4000),
  baseline: baselineSchema,
}).strict().superRefine((value, ctx) => {
  if (value.optimizedAt && value.optimizedAt > propertyToday()) ctx.addIssue({ code: "custom", path: ["optimizedAt"], message: "优化日期不能在未来" });
  for (const field of ["snapshotGeneratedAt", "savedAt"] as const) {
    const date = value.baseline[field];
    if (date && Date.parse(date) > Date.now() + 300_000) ctx.addIssue({ code: "custom", path: ["baseline", field], message: "基线时间不能在未来" });
  }
});
export type OptimizationPlanInput = z.infer<typeof optimizationPlanInputSchema>;
export type OptimizationPlanRecord = OptimizationPlanInput & { schemaVersion: 1; id: string; revision: string; updatedAt: string };
export function optimizationPlanId(value: Pick<OptimizationPlanInput, "country" | "keyword" | "pageUrl">) {
  return createHash("sha256").update(JSON.stringify([value.country, value.keyword.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(), new URL(value.pageUrl).toString()])).digest("hex");
}
export function optimizationPlansDirectory(localPreview: boolean) {
  const configured = process.env.SEO_OPTIMIZATION_PLANS_STORE_DIR;
  if (configured) { if (!isAbsolute(configured)) throw new Error("优化目标目录须为绝对路径"); return configured; }
  return localPreview ? join(process.cwd(), ".local", "seo-analytics", "optimization-plans") : null;
}
const filePattern = /^([a-f0-9]{64})~(\d{13})~([a-f0-9-]{36})\.json$/;
export async function readOptimizationPlans(directory: string, includeHistory = false): Promise<OptimizationPlanRecord[]> {
  const names = await readdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; });
  const records = await Promise.all(names.filter(name => filePattern.test(name)).map(async name => {
    const match = filePattern.exec(name)!;
    const saved = JSON.parse(await readFile(join(directory, name), "utf8")) as OptimizationPlanRecord;
    const { schemaVersion, id, revision, updatedAt, ...input } = saved;
    optimizationPlanInputSchema.parse(input);
    if (schemaVersion !== 1 || id !== match[1] || optimizationPlanId(input) !== id || revision !== match[3] || !z.uuid().safeParse(revision).success || Date.parse(updatedAt) !== Number(match[2])) throw new Error("优化目标归档不匹配");
    return saved;
  }));
  records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision.localeCompare(a.revision));
  if (includeHistory) return records;
  const latest = new Map<string, OptimizationPlanRecord>();
  for (const record of records) if (!latest.has(record.id)) latest.set(record.id, record);
  return [...latest.values()];
}
export async function writeOptimizationPlan(input: unknown, directory: string): Promise<OptimizationPlanRecord> {
  const parsed = optimizationPlanInputSchema.parse(input), id = optimizationPlanId(parsed);
  const previous = (await readOptimizationPlans(directory)).find(plan => plan.id === id);
  const plan = createOptimizationRevision(parsed, previous);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${id}~${Date.parse(plan.updatedAt)}~${plan.revision}.json`), temporary = join(directory, "." + randomUUID());
  try { await writeFile(temporary, JSON.stringify(plan), { flag: "wx", mode: 0o600 }); await link(temporary, path); }
  finally { await unlink(temporary).catch(() => undefined); }
  return plan;
}

export function createOptimizationRevision(input: OptimizationPlanInput, previous?: OptimizationPlanRecord): OptimizationPlanRecord {
  const updatedAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
  return { ...input, pageUrl: new URL(input.pageUrl).toString(), baseline: previous?.baseline ?? { ...input.baseline, savedAt: updatedAt },
    schemaVersion: 1, id: optimizationPlanId(input), revision: randomUUID(), updatedAt };
}
