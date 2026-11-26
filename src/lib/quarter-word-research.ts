import { z } from "zod";
import { cleanCsvCell, parseCsv } from "./csv";
import { GROWTH_MARKET_LANGUAGES, GROWTH_RESEARCH_COUNTRIES } from "./seo-growth-markets";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const market = z.enum(GROWTH_RESEARCH_COUNTRIES);
const sourceLanguages = {
  US: "English", JP: "Japanese", BR: "Portuguese", SG: "Chinese", ES: "Spanish",
  FR: "French", DE: "German", VN: "Vietnamese", ID: "Indonesian",
};
export const quarterWordResearchRowSchema = z.object({
    siteDomain: z.enum(["flatkey.ai", "modelfit.cc", "rackrate.org"]),
    topicId: z.string().trim().min(1).max(160),
    keyword: z.string().trim().min(1).max(160),
    country: market,
    language: z.string().min(1).max(16),
    volume: z.number().int().min(10),
    sourceUrl: z.url().max(1000),
    sourceFile: z.string().trim().min(1).max(500),
    sourceSha256: hash,
    sourceRow: z.number().int().positive(),
    observedAt: z.iso.datetime({ offset: true }),
    excerpt: z.string().min(1).max(5000),
}).strict();
export const quarterWordResearchSchema = z.object({
  action: z.literal("stage_new_words"),
  requestId: z.string().trim().min(1).max(160),
  rows: z.array(quarterWordResearchRowSchema).min(1).max(150),
}).strict();
export type QuarterWordResearchRow = z.infer<typeof quarterWordResearchRowSchema>;

export function quarterWordResearchProblem(row: QuarterWordResearchRow, now: Date) {
  const url = new URL(row.sourceUrl);
  if (url.origin !== "https://app.ahrefs.com" || url.username || url.password || !url.pathname.startsWith("/keywords-explorer/")
    || !url.pathname.includes(`/google/${row.country.toLowerCase()}/`) || GROWTH_MARKET_LANGUAGES[row.country] !== row.language
    || Date.parse(row.observedAt) > now.getTime()) return "Ahrefs 网页来源、市场语种或观察时间不匹配";
  try {
    const [header, values, ...other] = parseCsv(row.excerpt);
    const columns = header?.map(cleanCsvCell);
    if (!columns || !values || other.length || columns.length !== values.length
      || cleanCsvCell(values[columns.indexOf("#")]) !== String(row.sourceRow)
      || cleanCsvCell(values[columns.indexOf("Keyword")]) !== row.keyword
      || cleanCsvCell(values[columns.indexOf("Country")]).toUpperCase() !== row.country
      || cleanCsvCell(values[columns.indexOf("Volume")]) !== String(row.volume)
      || cleanCsvCell(values[columns.indexOf("Languages")]) !== sourceLanguages[row.country]) return "原始导出行的编号、原词、市场语种和搜索量须逐项一致";
  } catch {
    return "原始导出行的 CSV 格式无效";
  }
  return null;
}
