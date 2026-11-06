import { z } from "zod";
import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const date = z.iso.date();
export const weeklyActionPeriodSchema = date.refine(value => new Date(value + "T00:00:00Z").getUTCDay() === 5, "周期起始日须为周五");
const pageUrl = z.url().max(3000).refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && ["flatkey.ai", "www.flatkey.ai"].includes(url.hostname) && !url.username && !url.password && !url.port;
}, "页面必须属于 Flatkey HTTPS 站点");
const rank = z.number().finite().min(1).max(10000).nullable();
const actionSchema = z.object({
  pageUrl,
  country: z.enum(["US", "JP", "ES", "BR"]),
  keyword: z.string().trim().min(1).max(300),
  role: z.enum(["primary", "support"]),
  currentRank: rank,
  targetRank: rank,
  monthlySearchVolume: z.number().finite().int().min(0).max(1_000_000_000).nullable(),
  estimatedClicks: z.number().finite().min(0).max(1_000_000_000).nullable(),
  ctrAssumption: z.number().finite().min(0).max(1).nullable(),
  reason: z.string().trim().min(1).max(1500),
  action: z.string().trim().min(1).max(1500),
}).strict().superRefine((value, ctx) => {
  if (value.estimatedClicks !== null) {
    if (value.monthlySearchVolume === null || value.targetRank === null || value.ctrAssumption === null) {
      ctx.addIssue({ code: "custom", message: "预估点击须同时有搜索量、目标排名及 CTR 假设", path: ["estimatedClicks"] });
    } else if (Math.abs(value.estimatedClicks - value.monthlySearchVolume * value.ctrAssumption) > .51) {
      ctx.addIssue({ code: "custom", message: "预估点击须与搜索量 × CTR 假设一致", path: ["estimatedClicks"] });
    }
  }
});
export const weeklyActionPlanSchema = z.object({
  periodStart: weeklyActionPeriodSchema,
  preparedAt: z.iso.datetime({ offset: true }),
  status: z.enum(["draft", "reviewed"]),
  sources: z.array(z.object({ name: z.string().trim().min(1).max(200), date,
    url: z.url().max(5000).refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }).optional(),
  }).strict()).min(1).max(20),
  actions: z.array(actionSchema).min(1).max(10),
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.preparedAt) > Date.now() + 300_000) ctx.addIssue({ code: "custom", path: ["preparedAt"], message: "准备时间不能在未来" });
  const seen = new Set<string>(), primary = new Set<string>();
  value.actions.forEach((action, index) => {
    const pageMarket = action.pageUrl + "~" + action.country;
    const keyword = pageMarket + "~" + action.keyword.normalize("NFKC").toLowerCase();
    if (seen.has(keyword)) ctx.addIssue({ code: "custom", path: ["actions", index], message: "同一页面和国家的关键词不能重复" });
    seen.add(keyword);
    if (action.role === "primary") {
      if (primary.has(pageMarket)) ctx.addIssue({ code: "custom", path: ["actions", index, "role"], message: "同一页面和国家只能有一个主词" });
      primary.add(pageMarket);
    }
  });
  value.sources.forEach((source, index) => {
    if (source.date > value.preparedAt.slice(0, 10)) ctx.addIssue({ code: "custom", path: ["sources", index, "date"], message: "来源数据日期不能晚于计划准备日" });
  });
});
export type WeeklyActionPlan = z.infer<typeof weeklyActionPlanSchema>;

export function weeklyActionsDirectory(localPreview: boolean) {
  const configured = process.env.SEO_WEEKLY_ACTIONS_STORE_DIR;
  if (configured) {
    if (!isAbsolute(configured)) throw new Error("周计划存储目录必须是绝对路径");
    return configured;
  }
  return localPreview ? join(process.cwd(), ".local", "seo-analytics", "weekly-actions") : null;
}

export async function writeWeeklyActionPlan(input: unknown, directory: string) {
  const plan = weeklyActionPlanSchema.parse(input);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `${plan.periodStart}~${Date.parse(plan.preparedAt)}~${plan.status}.json`;
  const path = join(directory, name), temporary = join(directory, "." + randomUUID());
  const content = JSON.stringify(plan);
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(path, "utf8") !== content) throw error;
  } finally { await unlink(temporary).catch(() => undefined); }
  return plan;
}

export async function readWeeklyActionPlan(directory: string, period: string | "latest") {
  if (period !== "latest") weeklyActionPeriodSchema.parse(period);
  const names = await readdir(directory).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const candidates = names.flatMap(name => {
    const match = /^(\d{4}-\d{2}-\d{2})~(\d+)~(draft|reviewed)\.json$/.exec(name);
    return match && (period === "latest" || match[1] === period)
      ? [{ name, week: match[1], timestamp: Number(match[2]), status: match[3] }] : [];
  }).sort((a, b) => b.week.localeCompare(a.week) || b.timestamp - a.timestamp || Number(b.status === "reviewed") - Number(a.status === "reviewed"));
  const selected = candidates[0];
  if (!selected) return null;
  const plan = weeklyActionPlanSchema.parse(JSON.parse(await readFile(join(directory, selected.name), "utf8")));
  if (plan.periodStart !== selected.week || Date.parse(plan.preparedAt) !== selected.timestamp || plan.status !== selected.status) throw new Error("计划记录不匹配");
  return plan;
}
