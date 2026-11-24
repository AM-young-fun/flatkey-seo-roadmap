import { z } from "zod";
import type { WorkflowTask, WorkflowPublication } from "./seo-workflow";

export const MAINTENANCE_VERSION = "seo-maintenance-v1" as const;
export const maintenanceWorkClassSchema = z.enum(["content_refresh", "internal_linking", "technical_seo"]);
const stamp = z.iso.datetime({ offset: true });
const timezone = z.string().min(1).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; } }, "须为真实IANA来源时区");
const text = z.string().trim().min(12).max(3000);
const url = z.url().refine(value => {
  try {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port && !parsed.hash
    && !/^\/(?:api|admin|console|router|sign-in|sign-up)(?:\/|$)/.test(parsed.pathname)
    && ["flatkey.ai", "www.flatkey.ai", "modelfit.cc", "rackrate.org"].includes(parsed.hostname);
  } catch { return false; }
}, "仅限已授权公开官网规范地址");
const proof = z.object({ observedAt: stamp, source: z.string().trim().min(1).max(3000), finding: text }).strict();
export const TECHNICAL_AREAS = ["performance", "robots_noindex", "canonical", "sitemap", "hreflang", "structured_data", "links_redirects_cache"] as const;
const area = z.enum(TECHNICAL_AREAS);
const technicalCheck = z.object({
  area, method: z.enum(["field", "lab", "rendered_page", "http", "source"]),
  before: text, change: text, verify: text, evidence: z.array(proof).min(1).max(10),
}).strict();
const relation = z.object({
  entityId: z.string().trim().min(1).max(300), topicId: z.string().trim().min(1).max(160),
  language: z.string().min(2).max(20), modelUrl: url, articleUrl: url,
  modelToArticleAnchor: z.string().trim().min(2).max(300), articleToModelAnchor: z.string().trim().min(2).max(300),
  relevance: text, evidence: z.array(proof).min(1).max(10),
}).strict().superRefine((value, ctx) => {
  if (!url.safeParse(value.modelUrl).success || !url.safeParse(value.articleUrl).success) return;
  if (value.modelUrl === value.articleUrl || new URL(value.modelUrl).hostname.replace(/^www\./, "") !== new URL(value.articleUrl).hostname.replace(/^www\./, "")) ctx.addIssue({ code: "custom", message: "模型与相关文章须为同站不同的真实页面" });
});
export const maintenancePlanSchema = z.object({
  version: z.literal(MAINTENANCE_VERSION),
  refresh: z.object({
    reason: z.enum(["decline", "plateau", "outdated_facts", "intent_gap"]),
    baselineId: z.string().trim().min(1).max(160), originalPublishedAt: stamp,
    previousTaskId: z.string().trim().min(1).max(160).optional(),
    baseContentVersion: z.string().trim().min(1).max(200),
    changes: z.array(text).min(1).max(20), evidence: z.array(proof).min(1).max(20),
    trend: z.object({
      source: z.enum(["GA4", "GSC"]), timezone, metric: z.enum(["sessions", "clicks", "impressions", "position"]),
      beforeStart: z.iso.date(), beforeEnd: z.iso.date(), afterStart: z.iso.date(), afterEnd: z.iso.date(),
      beforeValue: z.number().finite().nonnegative(), afterValue: z.number().finite().nonnegative(),
      observedAt: stamp, sourceEvidence: z.string().trim().min(1).max(3000),
    }).strict().optional(),
  }).strict().optional(),
  links: z.array(relation).min(1).max(50).optional(),
  technical: z.array(technicalCheck).min(1).max(20).optional(),
}).strict().superRefine((value, ctx) => {
  const trend = value.refresh?.trend;
  if (value.refresh && ["decline", "plateau"].includes(value.refresh.reason) && !trend) ctx.addIssue({ code: "custom", message: "下滑或见顶须有完整同口径趋势，不能仅凭单日判断" });
  if (trend) {
    if (!timezone.safeParse(trend.timezone).success || !Number.isFinite(Date.parse(trend.observedAt))) return;
    const days = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    const sourceDay = new Intl.DateTimeFormat("en-CA", { timeZone: trend.timezone }).format(new Date(trend.observedAt));
    if (trend.beforeEnd >= trend.afterStart || trend.afterEnd >= sourceDay
      || days(trend.beforeStart, trend.beforeEnd) < 28 || days(trend.beforeStart, trend.beforeEnd) !== days(trend.afterStart, trend.afterEnd)) ctx.addIssue({ code: "custom", message: "趋势须为相邻已结束且等长、至少28日的真实窗口" });
    if (Date.parse(trend.afterStart) - Date.parse(trend.beforeEnd) !== 86400000) ctx.addIssue({ code: "custom", message: "趋势前后窗口须相邻" });
    if (trend.source === "GSC" && (trend.timezone !== "America/Los_Angeles" || trend.metric === "sessions") || trend.source === "GA4" && trend.metric !== "sessions") ctx.addIssue({ code: "custom", message: "趋势指标须与GA4/GSC来源一致" });
  }
});
export const maintenanceQaSchema = z.object({
  version: z.literal(MAINTENANCE_VERSION), contentVersion: z.string().trim().min(1).max(200), checkedAt: stamp,
  checks: z.array(z.object({
    key: z.enum(["refresh_identity", "refresh_substance", "reciprocal_links", ...TECHNICAL_AREAS]),
    pageUrl: url, result: z.literal("passed"), method: z.enum(["field", "lab", "rendered_page", "http", "source"]),
    evidence: z.array(proof).min(1).max(10),
  }).strict()).min(1).max(100),
  preservedPublishedAt: stamp.optional(), modifiedAt: stamp.optional(),
  linkReadbacks: z.array(z.object({
    from: url, to: url, canonicalUrl: url, language: z.string().min(2).max(20),
    httpStatus: z.literal(200), anchor: z.string().trim().min(2).max(300), crawlableAnchor: z.literal(true),
    indexable: z.literal(true), redirectCount: z.literal(0), evidence: z.array(proof).min(1).max(10),
  }).strict()).max(100).optional(),
}).strict();
function nativePathLanguage(value: string) {
  const first = new URL(value).pathname.split("/")[1];
  return ({ zh: "zh-CN", ja: "ja", pt: "pt-BR", es: "es-ES", fr: "fr", de: "de", ru: "ru", vi: "vi", id: "id" } as Record<string, string>)[first] ?? "en";
}

/** Optional classes leave legacy records and the CMS update protocol intact. */
export function maintenanceTaskProblems(task: WorkflowTask) {
  if (!task.workClass) return [];
  const errors: string[] = [];
  if (task.pageUrl && !url.safeParse(task.pageUrl).success) errors.push("维护目标必须是已授权公开官网页面");
  if (task.channel && task.channel !== "website") errors.push("维护工作仅限公开官网");
  if (task.workClass === "content_refresh" && (task.kind !== "optimization" || task.pageType !== "blog" || !["flatkey.ai", "modelfit.cc"].includes(task.siteDomain) || !task.pageUrl || !/\/blog\//.test(new URL(task.pageUrl).pathname))) errors.push("旧文翻新仅限Flatkey或ModelFit已有博客的更新任务");
  if (task.workClass === "internal_linking" && !["optimization", "technical"].includes(task.kind)) errors.push("内链建设沿原优化或技术任务执行");
  if (task.workClass === "technical_seo" && task.kind !== "technical") errors.push("技术维护沿原技术任务执行");
  if (!["ready", "drafting", "review_pending", "approved", "published", "verified", "observing"].includes(task.status)) return errors;
  if (task.workflowContract !== "growth-v1.5" || !task.problemKey || !task.pageUrl) errors.push("维护执行须保留原问题身份、页面和研究契约");
  const plan = task.maintenance;
  if (!plan) return [...errors, "维护执行缺少具体计划及证据"];
  if (task.workClass === "content_refresh" && !plan.refresh) errors.push("旧文翻新缺少原文版本、基线及实质修改计划");
  if (task.workClass === "internal_linking" && !plan.links?.length) errors.push("内链任务缺少模型与文章逐项双向关联");
  if (task.workClass === "technical_seo" && !plan.technical?.length) errors.push("技术维护缺少检查项、修复及验证方法");
  for (const link of plan.links ?? []) {
    if (link.language !== task.language || link.topicId !== task.topicId || ![link.modelUrl, link.articleUrl].includes(task.pageUrl ?? "")) errors.push("内链关系须匹配原任务的语言、话题及页面");
    const host = (value: string) => new URL(value).hostname.replace(/^www\./, "");
    if (host(link.modelUrl) !== task.siteDomain || host(link.articleUrl) !== task.siteDomain) errors.push("内链不能跨站或进入产品后台");
    if (nativePathLanguage(link.modelUrl) !== link.language || nativePathLanguage(link.articleUrl) !== link.language || !/\/models\/[^/]+\/?$/.test(new URL(link.modelUrl).pathname) || !/\/blog\/[^/]+\/?$/.test(new URL(link.articleUrl).pathname)) errors.push("模型详情与文章URL须对应真实模块及同语言路径");
  }
  return errors;
}
export function maintenancePublicationProblems(task: WorkflowTask, publication: WorkflowPublication) {
  if (!task.workClass) return [];
  // Real writes and failures must be recorded before QA finishes; only verified
  // receipts count as completed delivery. No missing check becomes a pass.
  if (publication.status !== "verified") return [];
  const errors = maintenanceTaskProblems(task);
  const qa = publication.maintenanceQa;
  if (!qa || qa.contentVersion !== publication.contentVersion || Date.parse(qa.checkedAt) < Date.parse(publication.publishedAt)) return [...errors, "维护发布须提供同版本实际上线检查"];
  const passed = (key: typeof qa.checks[number]["key"], pageUrl: string) => qa.checks.some(check => check.key === key && check.pageUrl === pageUrl);
  if (task.workClass === "content_refresh") {
    const refresh = task.maintenance?.refresh;
    if (publication.kind !== "optimization" || !refresh || publication.automaticWrite && publication.automaticWrite.baseContentVersion !== refresh.baseContentVersion
      || qa.preservedPublishedAt !== refresh?.originalPublishedAt || !qa.modifiedAt || Date.parse(qa.modifiedAt) <= Date.parse(refresh.originalPublishedAt) || Date.parse(qa.modifiedAt) > Date.parse(qa.checkedAt)
      || !passed("refresh_identity", publication.pageUrl) || !passed("refresh_substance", publication.pageUrl)) errors.push("翻新须保留原URL/首发日和原版本，验证实质更新及真实修改日期");
  }
  for (const link of task.maintenance?.links ?? []) {
    const directions = [[link.modelUrl, link.articleUrl, link.modelToArticleAnchor], [link.articleUrl, link.modelUrl, link.articleToModelAnchor]];
    if (!passed("reciprocal_links", link.modelUrl) || !passed("reciprocal_links", link.articleUrl)
      || directions.some(([from, to, anchor]) => !qa.linkReadbacks?.some(read => read.from === from && read.to === to && read.canonicalUrl === to && read.language === link.language && read.anchor === anchor))) errors.push("双向内链须逐页检查实际渲染锚文本、链接和规范页");
  }
  for (const check of task.maintenance?.technical ?? []) if (!passed(check.area, publication.pageUrl)) errors.push(`技术维护缺少${check.area}实际修复回执`);
  return errors;
}
