import { z } from "zod";
import { pageAuditDomainSchema } from "./page-audit";
import type { SearchRegionCode } from "./seo";
import type { SerpResultStatus } from "./serp-results";
import type { KeywordPageTag } from "./keyword-status-tags";

export const KEYWORD_EXPORT_API_PATH = "/api/keywords/content-opportunities";
export const API_KEYS_PATH = "/api/api-keys";
export const CONTENT_TARGET_RANK = 100;
export const exportRegionSchema = z.enum(["all", "US", "JP", "ES", "BR"]);
export type ExportRegion = z.infer<typeof exportRegionSchema>;
export const apiKeyMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().trim().min(1).max(80), siteDomain: pageAuditDomainSchema.nullable().default(null) }).strict(),
  z.object({ action: z.literal("reveal"), id: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal("revoke"), id: z.string().min(1).max(100) }).strict(),
]);
export type ExportApiKey = { id: string; name: string; prefix: string; siteDomain: string | null; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
export type ContentOpportunity = {
  keywordId: string; keyword: string; siteDomain: string; pool: string; searchVolume: number;
  hasPage: boolean; pageStatus: KeywordPageTag["key"]; pageUrls: string[]; candidateUrls: string[];
  currentRank: null; isTop100: false | null;
  opportunityStatus: "OUTSIDE_TOP100" | "NEEDS_VERIFICATION";
  recommendedAction: "BUILD" | "OPTIMIZE" | "REVIEW_PAGE";
  rankingEvidence: Array<{ region: SearchRegionCode; status: SerpResultStatus; rank: number | null; url: string | null; checkedAt: string | null; coveredThroughRank: number | null; periodKey: string | null }>;
  taskStatus: string; taskStatuses: string[]; taskIds: string[]; plannedUrls: string[];
  proposedTitle: string | null; requirements: string[]; acceptance: string[];
};
export function opportunitiesCsv(rows: ContentOpportunity[]): string {
  const cell = (value: string) => `"${(/^\s*[=+\-@]/u.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const values = [["网站", "关键词ID", "关键词", "词池", "默认搜索量", "是否有页面", "页面状态", "对应页面", "候选页面", "当前最佳排名", "是否前100", "抢占状态", "建议操作", "各地区排名依据", "任务状态", "任务ID", "规划页面", "建议标题", "内容要求", "验收标准"],
    ...rows.map(row => [row.siteDomain, row.keywordId, row.keyword, row.pool, String(row.searchVolume), row.hasPage ? "是" : "否", row.pageStatus,
      row.pageUrls.join("\n"), row.candidateUrls.join("\n"), row.currentRank == null ? "" : String(row.currentRank),
      row.isTop100 === null ? "待核实" : "否", row.opportunityStatus, row.recommendedAction,
      JSON.stringify(row.rankingEvidence), row.taskStatus, row.taskIds.join("\n"), row.plannedUrls.join("\n"), row.proposedTitle ?? "", row.requirements.join("\n"), row.acceptance.join("\n")])];
  return `\uFEFF${values.map(row => row.map(cell).join(",")).join("\r\n")}`;
}
