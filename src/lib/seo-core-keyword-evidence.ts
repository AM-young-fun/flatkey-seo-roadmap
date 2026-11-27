import { z } from "zod";
import { closeoutCoreKeywords } from "./seo-quarter-targets";
import { shiftDay } from "./seo-date-range";

export const coreKeywordArchiveKind = "gsc-core-keyword-window";
export const coreKeywordArchiveSchema = z.object({
  source: z.literal("gsc-search-analytics-final"),
  property: z.literal("sc-domain:flatkey.ai"),
  start: z.iso.date(), end: z.iso.date(), observedAt: z.iso.datetime(),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  linkedSourceHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  rows: z.array(z.object({
    keyword: z.string().min(1), country: z.enum(["BR", "US", "JP", "SG"]),
    language: z.enum(["pt-BR", "en", "ja", "zh-CN"]),
    url: z.url(),
    clicks: z.number().int().nonnegative().nullable(),
    impressions: z.number().int().nonnegative().nullable(),
    position: z.number().positive().nullable().optional(),
    otherPages: z.array(z.object({
      url: z.url(),
      clicks: z.number().int().nonnegative(),
      impressions: z.number().int().positive(),
      position: z.number().positive().nullable(),
    }).strict()).max(12).optional(),
  }).strict()).length(closeoutCoreKeywords.length),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (shiftDay(value.end, -27) !== value.start) issue("核心词数据须对应完整的 28 个来源自然日");
  const seen = new Set<string>();
  for (const row of value.rows) {
    const key = row.country + ":" + row.keyword;
    if (seen.has(key) || !closeoutCoreKeywords.some(word => word.keyword === row.keyword && word.country === row.country
      && word.language === row.language && "https://flatkey.ai" + word.path === row.url)) issue("核心词归档须沿确切原词、市场、语种和承接页");
    if ((row.clicks === null) !== (row.impressions === null) || (row.clicks ?? 0) > (row.impressions ?? 0)) issue("点击、展示须同源或同时标记缺失");
    if (row.position != null && !row.impressions) issue("平均排名须有同来源展示样本");
    const alternate = row.otherPages ?? [];
    if (alternate.length && !value.linkedSourceHash) issue("其他承接页须绑定精确来源文件");
    if (new Set(alternate.map(page => page.url)).size !== alternate.length || alternate.some(page => {
      const url = URL.parse(page.url);
      if (!url) return true;
      return url.protocol !== "https:" || url.hostname !== "flatkey.ai" || url.port || url.username || url.password
        || page.url === row.url || page.clicks > page.impressions;
    })) issue("其他承接页须是同站独立真实来源");
    seen.add(key);
  }
});
