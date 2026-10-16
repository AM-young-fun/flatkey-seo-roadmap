import { z } from "zod";
import { normalizeKeywordText } from "@/lib/keyword-relevance";

export const PAGE_AUDIT_API_PATH = "/api/keywords/page-audit";
export const PAGE_AUDIT_SOURCE_ID = "page_audit";
const localPage = z.url().max(2000).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === "flatkey.ai" || url.hostname.endsWith(".flatkey.ai"));
  } catch { return false; }
}, "页面必须是本站HTTPS地址且不含账号、密码或自定义端口");
export function normalizeAuditPageUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
function sameAuditPage(first: string, second: string): boolean {
  try { return normalizeAuditPageUrl(first) === normalizeAuditPageUrl(second); } catch { return false; }
}
const pageEvidence = z.object({ title: z.string().trim().max(1000).optional(), h1: z.string().trim().max(2000).optional(), excerpt: z.string().trim().max(5000).optional() }).strict();
const additionalPage = z.object({
  pageUrl: localPage, canonicalUrl: localPage, httpStatus: z.literal(200),
  checkedAt: z.iso.datetime({ offset: true }), reason: z.string().trim().min(20).max(3000), evidence: pageEvidence,
}).strict();
export const keywordWorkPlanSchema = z.object({
  originalVerdict: z.enum(["CONTENT_GAP", "MISMATCH"]),
  action: z.enum(["EXPAND", "LINK", "BUILD"]),
  pageUrls: z.array(localPage).max(21),
  previousPageUrl: localPage.nullable(),
  proposedTitle: z.string().trim().min(4).max(500),
  requirements: z.array(z.string().trim().min(8).max(1000)).min(3).max(8),
  acceptance: z.array(z.string().trim().min(8).max(1000)).min(2).max(6),
}).strict();
export type KeywordWorkPlan = z.infer<typeof keywordWorkPlanSchema>;
export const pageAuditSchema = z.object({
  kind: z.literal("page-audit"), requestId: z.string().trim().min(1).max(160).regex(/^[\w.:-]+$/),
  targetDomain: z.literal("flatkey.ai"), action: z.enum(["preview", "apply"]),
  expectedStateHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  rows: z.array(z.object({
    keyword: z.string().trim().min(1).max(2000).refine(value => new TextEncoder().encode(value).length <= 2000, "关键词过长"),
    verdict: z.enum(["VERIFIED", "MISSING", "MISMATCH", "REVIEW", "NO_MATCH", "CONTENT_GAP"]),
    pageUrl: localPage.optional(), canonicalUrl: localPage.optional(), httpStatus: z.number().int().min(100).max(599).optional(),
    checkedAt: z.iso.datetime({ offset: true }), reason: z.string().trim().min(12).max(3000),
    evidence: pageEvidence,
    additionalPages: z.array(additionalPage).max(20).optional(),
    workPlan: keywordWorkPlanSchema.optional(),
    inventory: z.object({ sourceUrl: localPage, pageCount: z.number().int().positive().max(1000000), checkedAt: z.iso.datetime({ offset: true }) }).strict().optional(),
  }).strict()).min(1).max(30),
}).strict().superRefine((input, context) => {
  const seen = new Set<string>();
  input.rows.forEach((row, index) => {
    const issue = (message: string) => context.addIssue({ code: "custom", path: ["rows", index], message });
    const keyword = normalizeKeywordText(row.keyword);
    if (seen.has(keyword)) issue("每个关键词每批只能有一个复核结论");
    seen.add(keyword);
    if (Date.parse(row.checkedAt) > Date.now() + 300000) issue("页面复核时间不能在未来");
    if (!["REVIEW", "NO_MATCH"].includes(row.verdict) && !row.pageUrl) issue("明确页面结论必须提供已检查页面");
    if (row.verdict === "VERIFIED") {
      if (row.httpStatus !== 200 || !row.canonicalUrl || !row.pageUrl || !sameAuditPage(row.pageUrl, row.canonicalUrl)) issue("核验通过必须是HTTP200且canonical与已检查的最终页面一致");
      if (row.reason.length < 20 || !Object.values(row.evidence).some(value => value && value.length >= 8)) issue("核验通过必须提供详细逐词意图理由及页面正文证据");
    }
    if (row.verdict === "MISSING" && ![404, 410].includes(row.httpStatus ?? 0)) issue("缺页结论必须有HTTP404或410证据");
    if (row.verdict === "MISMATCH" && (row.httpStatus !== 200 || row.reason.length < 20)) issue("意图错配必须有HTTP200和详细不匹配理由");
    if (row.verdict === "NO_MATCH" && (!row.inventory || row.reason.length < 30 || (row.evidence.excerpt?.length ?? 0) < 20)) issue("未找到匹配页须提供已核公开页面目录、页数、时间及逐词检索结论");
    if (row.verdict === "CONTENT_GAP" && (row.httpStatus !== 200 || !row.canonicalUrl || !row.pageUrl || !sameAuditPage(row.pageUrl, row.canonicalUrl) || row.reason.length < 30 || (row.evidence.excerpt?.length ?? 0) < 20)) issue("内容缺口须提供已检查的HTTP200最终页面及具体缺失意图证据");
    if (row.inventory && Date.parse(row.inventory.checkedAt) > Date.now() + 300000) issue("目录核验时间不能在未来");
    if (row.additionalPages?.length && row.verdict !== "VERIFIED") issue("只有逐页核验通过的关键词才能增加匹配页面");
    const pages = new Set(row.pageUrl ? [normalizeAuditPageUrl(row.pageUrl)] : []);
    for (const page of row.additionalPages ?? []) {
      if (!sameAuditPage(page.pageUrl, page.canonicalUrl) || Date.parse(page.checkedAt) > Date.now() + 300000 || !Object.values(page.evidence).some(value => value && value.length >= 8)) issue("每个新增匹配页须有独立的最终URL、canonical、核验时间及正文证据");
      const identity = normalizeAuditPageUrl(page.pageUrl);
      if (pages.has(identity)) issue("同一关键词的匹配页面不能重复");
      pages.add(identity);
    }
    if (row.workPlan) {
      const expected = { LINK: "VERIFIED", EXPAND: "CONTENT_GAP", BUILD: "NO_MATCH" } as const;
      if (row.verdict !== expected[row.workPlan.action]) issue("优化清单处理方式必须与页面核验结论一致");
      const targets = row.workPlan.pageUrls.map(normalizeAuditPageUrl);
      if (new Set(targets).size !== targets.length) issue("优化清单页面不能重复");
      if (row.workPlan.action === "BUILD") {
        if (targets.length) issue("待建设词不能关联尚未存在的页面");
      } else if (!targets.length || targets.some(url => !pages.has(url)) || (row.workPlan.action === "LINK" && targets.length !== pages.size)) {
        issue("优化清单的处理页面须逐一通过本次页面核验");
      }
    }
  });
});
export type PageAuditPayload = z.infer<typeof pageAuditSchema>;
export type PageAuditVerdict = PageAuditPayload["rows"][number]["verdict"];
export type PageAuditSummary = { changed: number; unchanged: number; verified: number; missing: number; mismatch: number; review: number; noMatch: number; contentGap: number };
export type PageAuditResult = { kind: "page-audit"; requestId: string; targetDomain: "flatkey.ai"; action: "preview" | "apply";
  imported: number; duplicate: boolean; stateHash: string; pageSummary: PageAuditSummary;
  changes: Array<{ keyword: string; verdict: PageAuditPayload["rows"][number]["verdict"]; mappingStatusBefore: string; mappingStatusAfter: string;
    targetUrlsBefore: string[]; targetUrlsAfter: string[]; candidateUrlsBefore: string[]; candidateUrlsAfter: string[]; fields: string[]; reason: string }>;
};
