import { z } from "zod";

export const WORKFLOW_SITES = ["flatkey.ai", "jev-llm.com", "mochichatbot.com", "modelfit.cc", "rackrate.org"] as const;
export const WORKFLOW_MARKETS = { US: "en", JP: "ja", BR: "pt-BR", ES: "es-ES" } as const;
export const WORKFLOW_STATUSES = ["planned", "researching", "ready", "drafting", "review_pending", "approved", "published", "verified", "observing", "blocked", "failed"] as const;
const id = z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/);
const stamp = z.iso.datetime({ offset: true });
export const workflowWeekSchema = z.iso.date().refine(value => new Date(value + "T00:00:00Z").getUTCDay() === 1, "工作周从周一开始");
const site = z.enum(WORKFLOW_SITES);
const country = z.enum(["US", "JP", "BR", "ES"]);
const language = z.enum(["en", "ja", "pt-BR", "es-ES"]);
const httpsUrl = z.url().max(3000).refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }, "需要 HTTPS 地址");
export const workflowEvidenceSchema = z.object({ label: z.string().trim().min(1).max(300), url: httpsUrl.optional(), artifact: z.string().trim().min(1).max(2000).optional(), observedAt: stamp }).strict()
  .refine(value => Boolean(value.url || value.artifact), "证据需要来源链接或产物路径");
const evidence = z.array(workflowEvidenceSchema).max(100);
const approval = z.object({ kind: z.enum(["explicit", "standing_new_blog"]), approvedBy: z.string().trim().min(1).max(200), approvedAt: stamp, contentVersion: z.string().min(1).max(200), evidence: evidence.min(1) }).strict();
const research = z.object({ volume: z.number().int().nonnegative().nullable(), kd: z.number().min(0).max(100).nullable(), businessValue: z.number().int().min(0).max(3).nullable(), exceptionReason: z.string().trim().max(2000).nullable(), intent: z.string().trim().max(2000), observedAt: stamp, evidence: evidence.min(1) }).strict();

export const workflowTaskSchema = z.object({
  id, weekStart: workflowWeekSchema, title: z.string().trim().min(1).max(500), siteDomain: site,
  channel: z.enum(["website", "github", "product"]).optional(),
  kind: z.enum(["blog", "landing", "optimization", "cluster", "technical", "research", "promotion", "review"]),
  country: country.nullable(), language: language.nullable(), business: z.enum(["API", "GPU", "CLUSTER"]),
  pageType: z.enum(["blog", "landing", "tool", "comparison", "tutorial", "pricing", "integration", "technical", "other"]),
  keyword: z.string().trim().min(1).max(300).nullable(), keywordId: z.string().trim().min(1).max(160).nullable().default(null), pageUrl: httpsUrl.nullable(),
  owner: z.string().trim().min(1).max(200), dueAt: stamp, status: z.enum(WORKFLOW_STATUSES),
  dependencies: z.array(id).max(100), evidence, nextAction: z.string().trim().max(3000),
  contentVersion: z.string().trim().max(200).nullable(), artifactUrl: httpsUrl.nullable().default(null),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(30),
  research: research.nullable().default(null), approval: approval.nullable().default(null),
  source: z.enum(["human", "automation", "sheet"]), sourceRowId: z.string().max(500).nullable().default(null),
  fallbackReason: z.string().max(2000).nullable().default(null), failureReason: z.string().max(3000).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.country && value.language && WORKFLOW_MARKETS[value.country] !== value.language) ctx.addIssue({ code: "custom", path: ["language"], message: "目标国家与页面语言不匹配" });
  if (["blog", "landing", "optimization", "cluster"].includes(value.kind) && (!value.country || !value.language || !value.keyword)) ctx.addIssue({ code: "custom", message: "内容任务必须有明确国家、本语言关键词和语言" });
  if (value.channel === "github") {
    if (!value.pageUrl || !githubReviewBelongsToSite(value.pageUrl, value.siteDomain) || value.kind !== "technical") ctx.addIssue({ code: "custom", path: ["pageUrl"], message: "GitHub任务只允许Flatkey两个自有提示词库的渠道审核，不计博客或落地页产量" });
  } else if (value.channel === "product") {
    if (value.kind !== "technical" || value.siteDomain !== "flatkey.ai" || value.pageUrl && !productReviewBelongsToSite(value.pageUrl, value.siteDomain)) ctx.addIssue({ code: "custom", path: ["pageUrl"], message: "产品渠道只允许Flatkey主站、Console与Router的技术变更审核" });
  } else if (value.pageUrl && !pageBelongsToSite(value.pageUrl, value.siteDomain)) ctx.addIssue({ code: "custom", path: ["pageUrl"], message: "页面不属于选定站点" });
  if (value.dependencies.includes(value.id) || new Set(value.dependencies).size !== value.dependencies.length) ctx.addIssue({ code: "custom", path: ["dependencies"], message: "依赖不能重复或指向自身" });
  if (new Date(value.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) < value.weekStart || new Date(value.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) > shiftWorkflowDay(value.weekStart, 6)) ctx.addIssue({ code: "custom", path: ["dueAt"], message: "交付日须在对应周一至周日内" });
  if (value.keyword && value.language !== "ja" && /[\u3400-\u9fff]/u.test(value.keyword)) ctx.addIssue({ code: "custom", path: ["keyword"], message: "英文、葡语和西语任务不能使用中文主词" });
  if (["blocked", "failed"].includes(value.status) && !value.failureReason) ctx.addIssue({ code: "custom", path: ["failureReason"], message: "阻塞或失败必须说明原因" });
});
export const workflowPlanSchema = z.object({
  id, weekStart: workflowWeekSchema, status: z.enum(["draft", "reviewed", "bootstrap"]), title: z.string().trim().min(1).max(500),
  taskIds: z.array(id).max(500), owner: z.string().trim().min(1).max(200), preparedAt: stamp, reviewedAt: stamp.nullable(), reviewedBy: z.string().max(200).nullable(),
  targets: z.object({ landing: z.literal(5), apiBlogs: z.number().int().min(0).max(35), gpuBlogs: z.number().int().min(0).max(35), optimizedPages: z.literal(5),
    blogLanguages: z.object({ en: z.literal(14), ja: z.literal(7), "pt-BR": z.literal(7), "es-ES": z.literal(7) }).strict().optional(),
  }).strict().refine(value => value.apiBlogs + value.gpuBlogs === 35, "API/GPU源文计划合计35篇，按关键词机会分配；翻译不占源文额度"),
  gaps: z.array(z.object({ category: z.enum(["landing", "apiBlogs", "gpuBlogs", "optimizedPages", "blogEn", "blogJa", "blogPt", "blogEs", "evidence", "other"]), count: z.number().int().positive(), reason: z.string().trim().min(1).max(2000) }).strict()).max(100),
  evidence, notes: z.string().max(5000),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.taskIds).size !== value.taskIds.length) ctx.addIssue({ code: "custom", path: ["taskIds"], message: "计划任务不能重复" });
  if (value.status === "reviewed" && (!value.reviewedAt || !value.reviewedBy || !value.evidence.length)) ctx.addIssue({ code: "custom", message: "正式计划需要核对人、时间和证据" });
});
export const WORKFLOW_APPROVAL_STATUSES = ["draft", "pending", "partially_reviewed", "approved", "rejected", "changes_requested", "withdrawn", "superseded"] as const;
export const workflowApprovalItemSchema = z.object({
  id, taskId: id, operation: z.enum(["new", "update"]), pageUrl: httpsUrl,
  language: z.string().trim().min(2).max(20).regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  contentVersion: z.string().trim().min(1).max(200), baseContentVersion: z.string().trim().min(1).max(200).nullable(),
  changeSummary: z.string().trim().min(1).max(5000), beforeSummary: z.string().trim().min(1).max(5000).nullable(), afterSummary: z.string().trim().min(1).max(5000),
  draftUrl: httpsUrl.nullable(), previewUrl: httpsUrl.nullable(), previewContentVersion: z.string().trim().min(1).max(200).nullable().default(null), reviewContent: z.string().trim().min(1).max(120000).nullable().default(null), reviewFormat: z.enum(["markdown", "diff", "text"]).default("text"), beforeContent: z.string().max(120000).nullable().default(null), evidence: evidence.min(1),
}).strict().superRefine((item, ctx) => {
  if (!item.draftUrl && !item.previewUrl && !item.reviewContent) ctx.addIssue({ code: "custom", message: "每项审批必须提供平台内可读稿件正文、完整差异或 HTTPS 稿件/预览链接" });
  if (item.operation === "update" && (!item.baseContentVersion || !item.beforeSummary)) ctx.addIssue({ code: "custom", message: "修改页面需保留改前版本和改前说明" });
  if (item.operation === "new" && item.baseContentVersion) ctx.addIssue({ code: "custom", message: "新增页面不能冒用旧版本基线" });
  if (item.baseContentVersion === item.contentVersion) ctx.addIssue({ code: "custom", message: "改稿必须使用新的内容版本" });
});
export function approvalReviewReadiness(item: z.infer<typeof workflowApprovalItemSchema>) {
  const missing: string[] = [];
  const safe = (value: string | null | undefined) => { try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password ? url : null; } catch { return null; } };
  const preview = safe(item.previewUrl);
  if (!preview || preview.origin === safe(item.pageUrl)?.origin) missing.push("独立测试环境链接");
  if (item.previewContentVersion !== item.contentVersion) missing.push("与稿件一致的测试部署版本");
  const sameVersion = (row: typeof item.evidence[number]) => !row.url?.startsWith("https://flatkey-seo-roadmap.vercel.app/api/seo/review-assets/") || row.label.endsWith(` · ${item.contentVersion}`);
  if (!item.evidence.some(row => safe(row.url) && sameVersion(row) && /桌面|desktop/i.test(row.label) && /截图|截屏|screenshot|screen capture/i.test(row.label))) missing.push("桌面截图链接");
  if (!item.evidence.some(row => safe(row.url) && sameVersion(row) && /手机|移动|mobile/i.test(row.label) && /截图|截屏|screenshot|screen capture/i.test(row.label))) missing.push("手机截图链接");
  return { ready: missing.length === 0, missing };
}
export const workflowApprovalDecisionSchema = z.object({
  id, itemIds: z.array(id).min(1).max(500), decision: z.enum(["approved", "rejected", "changes_requested", "withdrawn", "superseded"]),
  decidedBy: z.string().trim().min(1).max(200), decidedAt: stamp, note: z.string().trim().min(1).max(5000), evidence: evidence.min(1),
}).strict();
export function workflowApprovalItemStatus(approval: { decisions: { itemIds: string[]; decision: "approved" | "rejected" | "changes_requested" | "withdrawn" | "superseded" }[]; status?: string }, itemId: string) {
  return [...approval.decisions].reverse().find(decision => decision.itemIds.includes(itemId))?.decision ?? (approval.status === "draft" ? "draft" : "pending");
}
export function workflowApprovalStatus(decisions: z.infer<typeof workflowApprovalDecisionSchema>[], items: { id: string }[], draft = false): typeof WORKFLOW_APPROVAL_STATUSES[number] {
  if (draft) return "draft";
  const states = new Set(items.map(item => workflowApprovalItemStatus({ decisions }, item.id)));
  return states.size === 1 ? [...states][0] as typeof WORKFLOW_APPROVAL_STATUSES[number] : "partially_reviewed";
}
export const workflowApprovalSchema = z.object({
  id, weekStart: workflowWeekSchema, siteDomain: site, title: z.string().trim().min(1).max(500), requestedBy: z.string().trim().min(1).max(200),
  channel: z.enum(["website", "github", "product"]).optional(),
  submittedAt: stamp.nullable(), status: z.enum(WORKFLOW_APPROVAL_STATUSES), items: z.array(workflowApprovalItemSchema).min(1).max(500),
  decisions: z.array(workflowApprovalDecisionSchema).max(1000), supersedesApprovalIds: z.array(id).max(100), evidence: evidence.min(1),
}).strict().superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.status === "draft" ? Boolean(value.submittedAt || value.decisions.length) : !value.submittedAt) fail("待审单需要真实提交时间；草稿不能携带审批决定");
  if (value.status !== workflowApprovalStatus(value.decisions, value.items, value.status === "draft")) fail("审批单状态与逐项决定不一致");
  if (new Set(value.items.map(item => item.id)).size !== value.items.length || new Set(value.items.map(item => JSON.stringify([item.pageUrl,item.language]))).size !== value.items.length) fail("同一审批单不能重复页面语言或审批项编号");
  if (new Set(value.decisions.map(decision => decision.id)).size !== value.decisions.length) fail("审批决定编号不能重复");
  if (new Set(value.supersedesApprovalIds).size !== value.supersedesApprovalIds.length || value.supersedesApprovalIds.includes(value.id)) fail("替换审批单不能重复或指向自身");
  for (const item of value.items) if (!(value.channel === "github" ? githubReviewBelongsToSite(item.pageUrl, value.siteDomain) : value.channel === "product" ? productReviewBelongsToSite(item.pageUrl, value.siteDomain) : pageBelongsToSite(item.pageUrl, value.siteDomain))) fail("审批页面必须属于所选站点或明确标记的自有渠道");
  for (const decision of value.decisions) if (new Set(decision.itemIds).size !== decision.itemIds.length || decision.itemIds.some(id => !value.items.some(item => item.id === id))) fail("决定只能引用本单唯一审批项");
});

const liveCheck = z.object({ checkedAt: stamp, httpStatus: z.literal(200), canonicalUrl: httpsUrl, language: z.string().min(2).max(20), contentVersion: z.string().min(1).max(200), contentMatched: z.literal(true), linksChecked: z.literal(true), sourceReceipt: z.string().trim().min(1).max(3000), evidence: evidence.min(1) }).strict();
export const workflowPublicationSchema = z.object({
  id, taskId: id, approvalId: id, approvalItemId: id, weekStart: workflowWeekSchema, runId: id, siteDomain: site, pageUrl: httpsUrl,
  country: country.nullable(), language: z.string().trim().min(2).max(20), keyword: z.string().trim().min(1).max(300).nullable(),
  contentVersion: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(500),
  kind: z.enum(["source_blog", "translation", "backfill_translation", "landing", "optimization", "cluster"]),
  sourcePublicationId: id.nullable(), publishedAt: stamp, verifiedAt: stamp.nullable(),
  status: z.enum(["published", "verified", "failed", "unknown"]), liveCheck: liveCheck.nullable(), evidence,
  failureReason: z.string().max(3000).nullable(),
}).strict().superRefine((value, ctx) => {
  if (!pageBelongsToSite(value.pageUrl, value.siteDomain)) ctx.addIssue({ code: "custom", path: ["pageUrl"], message: "页面不属于选定站点" });
  if (!["translation", "backfill_translation", "optimization", "landing"].includes(value.kind) && (!value.country || !value.keyword)) ctx.addIssue({ code: "custom", message: "源文及页面发布需要明确目标国家与本语言关键词" });
  if (value.country && WORKFLOW_MARKETS[value.country] !== value.language) ctx.addIssue({ code: "custom", message: "发布目标国家与语言不一致；非目标市场译文须保留国家为空" });
  if (value.keyword && value.language !== "ja" && !value.language.startsWith("zh") && /[\u3400-\u9fff]/u.test(value.keyword)) ctx.addIssue({ code: "custom", message: "发布关键词必须使用对应页面语言" });
  if (value.status === "verified" && (!value.verifiedAt || !value.liveCheck || !value.evidence.length)) ctx.addIssue({ code: "custom", message: "验收上线需要正式页验收与发布回执" });
  if (value.verifiedAt && Date.parse(value.verifiedAt) < Date.parse(value.publishedAt)) ctx.addIssue({ code: "custom", message: "验收不能早于发布" });
  if (value.liveCheck && (value.liveCheck.canonicalUrl !== value.pageUrl || value.liveCheck.contentVersion !== value.contentVersion || value.liveCheck.language !== value.language || Date.parse(value.liveCheck.checkedAt) < Date.parse(value.publishedAt))) ctx.addIssue({ code: "custom", path: ["liveCheck"], message: "验收版本、语言、规范页面或时间不匹配" });
  if (["translation", "backfill_translation"].includes(value.kind) && !value.sourcePublicationId) ctx.addIssue({ code: "custom", message: "翻译必须关联源文" });
  if (!["translation", "backfill_translation"].includes(value.kind) && value.sourcePublicationId) ctx.addIssue({ code: "custom", message: "源文和落地页不能标记翻译来源" });
});
const metric = z.number().finite().nonnegative().nullable();
export const workflowBaselineSchema = z.object({
  capturedAt: stamp, periodStart: z.iso.date(), periodEnd: z.iso.date(), source: z.enum(["GSC", "GA4", "combined"]),
  sourceDate: z.iso.date(), timezone: z.string().min(1).max(100), country, device: z.enum(["all", "desktop", "mobile", "tablet"]),
  clicks: metric, impressions: metric, ctr: z.number().min(0).max(1).nullable(), averagePosition: z.number().min(1).nullable(), organicVisits: metric,
  registrations: metric, activation: metric, payment: metric,
  dataStatus: z.enum(["complete", "partial", "missing", "unverified", "not_connected"]), evidence,
}).strict().superRefine((value, ctx) => { if (value.periodEnd < value.periodStart || value.sourceDate < value.periodEnd) ctx.addIssue({ code: "custom", message: "基线日期不一致" }); if (value.dataStatus === "complete" && !value.evidence.length) ctx.addIssue({ code: "custom", message: "完整基线须保留来源证据" }); });

export const workflowComparisonMetricsSchema = z.object({
  clicks: metric, impressions: metric, ctr: z.number().min(0).max(1).nullable(), averagePosition: z.number().min(1).nullable(),
  targetKeywordAveragePosition: z.number().min(1).nullable(), organicVisits: metric, registrations: metric, activation: metric, payment: metric,
}).strict().superRefine((value, ctx) => {
  if (value.clicks !== null && value.impressions !== null && value.clicks > value.impressions) ctx.addIssue({ code: "custom", message: "点击不能超过曝光" });
  if (value.clicks !== null && value.impressions !== null && value.impressions > 0 && value.ctr !== null && Math.abs(value.ctr - value.clicks / value.impressions) > 0.0001) ctx.addIssue({ code: "custom", message: "CTR 必须由同范围点击/曝光计算" });
});
const comparisonWindow = z.object({
  periodStart: z.iso.date(), periodEnd: z.iso.date(), actualDays: z.array(z.iso.date()).max(56), sourceDate: z.iso.date(),
  dataStatus: z.enum(["complete", "partial", "missing", "unverified", "not_connected"]), metrics: workflowComparisonMetricsSchema,
}).strict().superRefine((value, ctx) => {
  if (value.periodEnd < value.periodStart || value.actualDays.some(day => day < value.periodStart || day > value.periodEnd || day > value.sourceDate) || new Set(value.actualDays).size !== value.actualDays.length) ctx.addIssue({ code: "custom", message: "实际覆盖日期需唯一且处于窗口和来源已出数范围内" });
  if (value.dataStatus === "complete" && (value.actualDays.length !== Math.round((Date.parse(value.periodEnd) - Date.parse(value.periodStart)) / 86400000) + 1 || value.sourceDate < value.periodEnd)) ctx.addIssue({ code: "custom", message: "完整窗口必须覆盖每个自然日" });
  if (["missing", "not_connected"].includes(value.dataStatus) && (value.actualDays.length || Object.values(value.metrics).some(metric => metric !== null))) ctx.addIssue({ code: "custom", message: "缺失或未接通的数据不能填为零或完整指标" });
});
export const workflowOptimizationComparisonSchema = z.object({
  changeId: id, source: z.enum(["GSC", "GA4"]), timezone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "需要有效来源时区"),
  country, device: z.enum(["all", "desktop", "mobile", "tablet"]), targetKeyword: z.string().trim().min(1).max(300), pageUrl: httpsUrl,
  before: comparisonWindow, after: comparisonWindow, status: z.enum(["comparable", "partial", "not_comparable"]), reason: z.string().trim().min(1).max(3000).nullable(), evidence: evidence.min(1),
}).strict().superRefine((value, ctx) => {
  if (value.source === "GSC" && value.timezone !== "America/Los_Angeles") ctx.addIssue({ code: "custom", message: "GSC 日期须按 America/Los_Angeles 比较" });
  if (value.status === "comparable" && (value.before.dataStatus !== "complete" || value.after.dataStatus !== "complete")) ctx.addIssue({ code: "custom", message: "可比结论需要前后完整覆盖" });
  if (value.status !== "comparable" && !value.reason) ctx.addIssue({ code: "custom", message: "部分覆盖或不可比须说明原因" });
  for (const window of [value.before, value.after]) {
    const wrongSource = value.source === "GSC" ? ["organicVisits", "registrations", "activation", "payment"] as const : ["clicks", "impressions", "ctr", "averagePosition", "targetKeywordAveragePosition"] as const;
    if (wrongSource.some(key => window.metrics[key] !== null)) ctx.addIssue({ code: "custom", message: "GSC 与 GA4 指标必须分别保留来源和时间窗口" });
  }
});
export const workflowOptimizationSchema = z.object({
  id, taskId: id, weekStart: workflowWeekSchema, siteDomain: site, pageUrl: httpsUrl, country, language,
  keyword: z.string().trim().min(1).max(300), status: z.enum(["drafting", "review_pending", "approved", "published", "verified", "observing", "blocked"]),
  objective: z.string().trim().min(1).max(3000), baseline: workflowBaselineSchema,
  changes: z.array(z.object({ id, contentVersion: z.string().min(1).max(200), description: z.string().min(1).max(5000), publicationId: id.nullable(), changedAt: stamp, evidence }).strict()).max(100),
  observations: z.array(z.object({ windowDays: z.enum(["7", "28", "56"]), checkedAt: stamp, status: z.enum(["observing", "improved", "needs_investigation", "insufficient_data"]), comparableDays: z.number().int().nonnegative(), note: z.string().min(1).max(5000), comparison: workflowOptimizationComparisonSchema.optional(), evidence }).strict()).max(100),
  evidence,
}).strict().superRefine((value, ctx) => { if (!pageBelongsToSite(value.pageUrl, value.siteDomain)) ctx.addIssue({ code: "custom", message: "页面不属于选定站点" }); if (WORKFLOW_MARKETS[value.country] !== value.language || value.baseline.country !== value.country) ctx.addIssue({ code: "custom", message: "优化国家、语言和基线不一致" }); });
export const workflowIssueSchema = z.object({
  id, weekStart: workflowWeekSchema, siteDomain: site, pageUrl: httpsUrl.nullable(), title: z.string().min(1).max(500),
  category: z.enum(["technical", "indexing", "language", "content", "data", "business", "sync"]), priority: z.enum(["P0", "P1", "P2", "P3"]),
  status: z.enum(["open", "investigating", "blocked", "resolved"]), owner: z.string().min(1).max(200), taskId: id.nullable(), firstSeenAt: stamp,
  impact: z.string().min(1).max(3000), nextAction: z.string().max(3000), evidence, resolvedAt: stamp.nullable(), resolutionEvidence: evidence,
}).strict().superRefine((value, ctx) => { if (value.status === "resolved" && (!value.resolvedAt || !value.resolutionEvidence.length)) ctx.addIssue({ code: "custom", message: "问题关闭需要恢复验证证据" }); });
export const workflowRunSchema = z.object({
  id, weekStart: workflowWeekSchema, stage: z.string().regex(/^[A-Z0-9_]+$/).max(100), scheduledFor: stamp, startedAt: stamp, completedAt: stamp.nullable(),
  status: z.enum(["running", "completed", "partial", "blocked", "failed"]), owner: z.string().min(1).max(200), taskIds: z.array(id).max(500),
  inputVersion: z.string().min(1).max(200), evidence, failureReason: z.string().max(3000).nullable(), nextAction: z.string().max(3000),
  checkedItems: z.number().int().nonnegative(), completedItems: z.number().int().nonnegative(), costMicros: z.number().int().nonnegative().nullable(),
  coverage: z.enum(["full", "partial", "unknown"]), sourceDates: z.record(z.string().max(100), z.iso.date().nullable()),
}).strict().superRefine((value, ctx) => { if (value.completedItems > value.checkedItems) ctx.addIssue({ code: "custom", message: "完成数量不能超过核查数量" }); if (value.status === "completed" && (!value.completedAt || !value.evidence.length || value.coverage !== "full")) ctx.addIssue({ code: "custom", message: "完成回执需要时间、完整覆盖和证据" }); if (["blocked", "failed", "partial"].includes(value.status) && !value.failureReason) ctx.addIssue({ code: "custom", message: "异常需要原因" }); });

// Legacy evidence is an immutable archive, deliberately not an executable task
// or publication authorization. Unreviewed markets/keywords remain null.
export const workflowHistoricalImportSchema = z.object({
  id, weekStart: workflowWeekSchema, siteDomain: site, status: z.literal("archived"), mode: z.literal("historical_import"),
  sourceRunId: id, sourceRunStatus: z.string().min(1).max(100), sourceStartedAt: stamp.nullable(), sourceCompletedAt: stamp.nullable(), sourceSnapshotAt: stamp,
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/), evidence: evidence.min(1), notes: z.string().min(1).max(5000),
  sourceTasks: z.array(z.object({
    id, externalRow: z.number().int().positive(), business: z.enum(["API", "GPU"]), title: z.string().min(1).max(500), pageUrl: httpsUrl,
    language: z.string().min(2).max(20), country: country.nullable(), keyword: z.string().min(1).max(300).nullable(),
    researchState: z.literal("legacy_unverified"), approvalState: z.literal("historical_not_granted"), evidence: evidence.min(1),
  }).strict()).min(1).max(100),
  publications: z.array(z.object({
    id, sourceTaskId: id, sourcePublicationId: id.nullable(), kind: z.enum(["source_blog", "translation"]), cmsId: z.string().min(1).max(200),
    title: z.string().min(1).max(500), pageUrl: httpsUrl, language: z.string().min(2).max(20), country: country.nullable(), keyword: z.string().min(1).max(300).nullable(),
    contentVersion: z.string().regex(/^sha256:[a-f0-9]{64}$/), publishedAt: stamp, firstVerifiedAt: stamp.nullable(), verifiedAt: stamp.nullable(),
    verificationState: z.enum(["live_verified", "artifact_verified", "published_unverified"]),
    verification: z.object({ httpStatus: z.literal(200), canonicalUrl: httpsUrl, contentMatched: z.boolean().nullable(), linksChecked: z.boolean().nullable(), evidence: evidence.min(1) }).strict().nullable(),
    evidence: evidence.min(1),
  }).strict()).min(1).max(500),
  auditBacklog: z.object({ attempted: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), evidence: evidence.min(1) }).strict(),
  pendingRevisions: z.object({ count: z.number().int().nonnegative(), externalRows: z.array(z.number().int().positive()), cmsModified: z.literal(0), state: z.literal("awaiting_exact_review"), evidence: evidence.min(1) }).strict(),
}).strict().superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.sourceStartedAt && Date.parse(value.sourceStartedAt) > Date.parse(value.sourceSnapshotAt) || value.sourceCompletedAt && (Date.parse(value.sourceCompletedAt) > Date.parse(value.sourceSnapshotAt) || value.sourceStartedAt && Date.parse(value.sourceCompletedAt) < Date.parse(value.sourceStartedAt))) fail("历史运行时间必须与来源快照一致");
  if (value.auditBacklog.completed + value.auditBacklog.pending !== value.auditBacklog.attempted) fail("历史审查已完成与待补数量须等于实际尝试数量");
  if (value.pendingRevisions.count !== value.pendingRevisions.externalRows.length) fail("待审旧页数量须与行号一致");
  if (new Set(value.sourceTasks.map(task => task.id)).size !== value.sourceTasks.length || new Set(value.publications.map(item => item.id)).size !== value.publications.length || new Set(value.publications.map(item => item.pageUrl)).size !== value.publications.length || new Set(value.publications.map(item => item.cmsId)).size !== value.publications.length) fail("历史任务、CMS页面和规范URL不能重复");
  for (const task of value.sourceTasks) if (!pageBelongsToSite(task.pageUrl, value.siteDomain) || value.publications.filter(item => item.sourceTaskId === task.id && item.kind === "source_blog").length !== 1) fail("每个历史源文任务须对应唯一同站点源文");
  for (const item of value.publications) {
    const task = value.sourceTasks.find(task => task.id === item.sourceTaskId);
    if (!task || !pageBelongsToSite(item.pageUrl, value.siteDomain)) fail("历史页面须属于站点且关联真实源文任务");
    if (item.kind === "source_blog" && (item.sourcePublicationId || task?.pageUrl !== item.pageUrl || task?.language !== item.language)) fail("源文身份必须匹配历史任务");
    if (item.kind === "translation" && !value.publications.some(source => source.id === item.sourcePublicationId && source.kind === "source_blog" && source.sourceTaskId === item.sourceTaskId)) fail("历史译文必须关联真实源文");
    if (Date.parse(item.publishedAt) > Date.parse(value.sourceSnapshotAt) || item.verifiedAt && Date.parse(item.verifiedAt) > Date.parse(value.sourceSnapshotAt)) fail("不能把来源快照之后的页面事实写入历史档案");
    if (item.verifiedAt && Date.parse(item.verifiedAt) < Date.parse(item.publishedAt) || item.firstVerifiedAt && (!item.verifiedAt || Date.parse(item.firstVerifiedAt) < Date.parse(item.publishedAt) || Date.parse(item.firstVerifiedAt) > Date.parse(item.verifiedAt))) fail("历史发布和验收时间顺序不正确");
    if (item.verificationState === "live_verified" && (!item.verifiedAt || !item.verification?.contentMatched || item.verification.canonicalUrl !== item.pageUrl)) fail("历史线上验收须有明确核查时间、内容和规范URL证据");
    if (item.verificationState !== "live_verified" && (item.verifiedAt || item.firstVerifiedAt)) fail("未留真实在线核查时刻不得补造验收时间");
  }
});

export const WORKFLOW_SCHEMAS = { approval: workflowApprovalSchema, plan: workflowPlanSchema, task: workflowTaskSchema, publication: workflowPublicationSchema, optimization: workflowOptimizationSchema, issue: workflowIssueSchema, run: workflowRunSchema, historical_import: workflowHistoricalImportSchema };
export type WorkflowKind = keyof typeof WORKFLOW_SCHEMAS;
type Stored<T> = T & { version: number; updatedAt: string; recordedAt: string };
export type WorkflowTask = Stored<z.infer<typeof workflowTaskSchema>>;
export type WorkflowPlan = Stored<z.infer<typeof workflowPlanSchema>>;
export type WorkflowApproval = Stored<Omit<z.infer<typeof workflowApprovalSchema>, "decisions"> & { decisions: (z.infer<typeof workflowApprovalDecisionSchema> & { recordedAt: string })[] }> & { submittedRecordedAt: string | null };
export type WorkflowPublication = Stored<z.infer<typeof workflowPublicationSchema>> & { verificationRecordedAt: string | null };
export type WorkflowOptimization = Stored<z.infer<typeof workflowOptimizationSchema>>;
export type WorkflowIssue = Stored<z.infer<typeof workflowIssueSchema>>;
export type WorkflowRun = Stored<z.infer<typeof workflowRunSchema>>;
export type WorkflowHistoricalImport = Stored<Omit<z.infer<typeof workflowHistoricalImportSchema>, "publications"> & { publications: (z.infer<typeof workflowHistoricalImportSchema>["publications"][number] & { verificationRecordedAt: string | null })[] }>;
export function workflowApprovalEffectiveItemStatus(approval: WorkflowApproval, itemId: string, all: WorkflowApproval[]) {
  const item = approval.items.find(item => item.id === itemId);
  if (item && all.some(other => other.id !== approval.id && other.status !== "draft" && other.supersedesApprovalIds.includes(approval.id) && other.items.some(next => next.pageUrl === item.pageUrl && next.language === item.language))) return "superseded" as const;
  return workflowApprovalItemStatus(approval, itemId);
}
export const workflowApprovalCheckSchema = z.object({ approvalId: id, itemId: id, taskId: id, pageUrl: httpsUrl, language: z.string().min(2).max(20), contentVersion: z.string().min(1).max(200) }).strict();
export type WorkflowApprovalCheck = z.infer<typeof workflowApprovalCheckSchema>;
export type WorkflowRecord = WorkflowApproval | WorkflowTask | WorkflowPlan | WorkflowPublication | WorkflowOptimization | WorkflowIssue | WorkflowRun | WorkflowHistoricalImport;
export type WorkflowSnapshot = { weekStart: string; weekEnd: string; plan: WorkflowPlan | null; approvals: WorkflowApproval[]; tasks: WorkflowTask[]; runs: WorkflowRun[]; publications: WorkflowPublication[]; historicalImports: WorkflowHistoricalImport[]; optimizations: WorkflowOptimization[]; issues: WorkflowIssue[]; generatedAt: string; storage: "database" | "local_preview"; summary: { tasks: number; blocked: number; reviewPending: number; pendingApprovalItems: number; pendingApprovals: number; verifiedSourceBlogs: number; verifiedTranslations: number; verifiedLandingPages: number; optimizedPages: number; openIssues: number; lastRunAt: string | null }; };
export const workflowMutationSchema = z.object({ requestId: id, action: z.enum(["save_approval", "save_plan", "save_task", "save_issue", "save_optimization", "record_publication", "record_run", "record_historical_import"]), expectedVersion: z.number().int().nonnegative().default(0), claim: z.object({ runId: id, owner: z.string().min(1).max(200), fencingToken: z.number().int().positive() }).strict().optional(), record: z.unknown() }).strict();
export const ACTION_KIND = { save_approval: "approval", save_plan: "plan", save_task: "task", save_issue: "issue", save_optimization: "optimization", record_publication: "publication", record_run: "run", record_historical_import: "historical_import" } as const;
export const workflowClaimSchema = z.object({ action: z.enum(["claim", "renew", "complete"]), runId: id, stage: z.string().regex(/^[A-Z0-9_]+$/).max(100), scheduledFor: stamp, owner: z.string().min(1).max(200), fencingToken: z.number().int().positive().optional(), leaseSeconds: z.number().int().min(30).max(1800).default(600), status: z.enum(["completed", "partial", "blocked", "failed"]).optional(), evidence: evidence.default([]) }).strict();

// Review-only owned channels. Never use this predicate for publication/SEO page metrics.
export function githubReviewBelongsToSite(value: string, domain: string) {
  try {
    const url = new URL(value);
    if (domain !== "flatkey.ai" || url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port || url.hash || url.search || /%(?:2f|5c|25)/i.test(url.pathname)) return false;
    return ["/flatkey-ai/awesome-images", "/flatkey-ai/awesome-seedance-prompts"].some(repo => url.pathname === repo || url.pathname.startsWith(repo + "/"));
  } catch { return false; }
}
export function pageBelongsToSite(value: string, domain: string) { const url = new URL(value); return url.protocol === "https:" && [domain, `www.${domain}`].includes(url.hostname) && !url.username && !url.password && !url.port && !url.hash; }
export function productReviewBelongsToSite(value: string, domain: string) {
  // Explicit production host ownership only. Reject raw escape syntax before
  // URL normalisation can erase a port, path traversal or encoded separator.
  if (domain !== "flatkey.ai" || !/^https:\/\/(?:flatkey\.ai|www\.flatkey\.ai|console\.flatkey\.ai|router\.flatkey\.ai)(?:\/|$)/.test(value) || /[\\%?#]/.test(value) || [...value].some(char => char.charCodeAt(0) <= 32) || value.split("/").some(part => part === "." || part === "..")) return false;
  try { const url = new URL(value); return !url.username && !url.password && !url.port && !url.search && !url.hash; } catch { return false; }
}
export function shiftWorkflowDay(value: string, days: number) { return new Date(Date.parse(value + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10); }
export function workflowWeek(now = new Date()) { const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }); return shiftWorkflowDay(day, -((new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7)); }
