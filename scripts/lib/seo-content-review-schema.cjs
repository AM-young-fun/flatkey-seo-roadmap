// Versioned client snapshot of Task/Issue/Week; the server remains the final validator.
// Runtime deliberately has no dependency on TypeScript or repository business files.
// Update this contract explicitly when its source fingerprint/parity tests fail.
"use strict";
const CLIENT_CONTRACT_VERSION = "seo-content-review-workflow-039217d-v2";
const SOURCE_CONTRACT_SHA256 = "6407715f1a40e7a6099a71dd55e496eef28ee806ba7e1d43b38c9eedd9c42ea9";
const { z } = require("zod");
const WORKFLOW_SITES = ["flatkey.ai", "jev-llm.com", "mochichatbot.com", "modelfit.cc", "rackrate.org"];
const WORKFLOW_MARKETS = { US: "en", JP: "ja", BR: "pt-BR", ES: "es-ES" };
const WORKFLOW_SITE_LANGUAGES = {
    "flatkey.ai": ["en", "ja", "pt-BR", "es-ES"],
    "jev-llm.com": ["en"],
    "mochichatbot.com": ["en", "ja", "pt-BR", "zh-CN"],
    "modelfit.cc": ["en"],
    "rackrate.org": ["en"],
};
function workflowContentLanguages(domain, market) {
    if (domain === "flatkey.ai")
        return [WORKFLOW_MARKETS[market]];
    return WORKFLOW_SITE_LANGUAGES[domain] ?? [];
}
const WORKFLOW_STATUSES = ["planned", "researching", "ready", "drafting", "review_pending", "approved", "published", "verified", "observing", "blocked", "failed"];
const workflowRecordIdSchema = z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/);
const id = workflowRecordIdSchema;
const stamp = z.iso.datetime({ offset: true });
const workflowWeekSchema = z.iso.date().refine(value => new Date(value + "T00:00:00Z").getUTCDay() === 1, "工作周从周一开始");
const site = z.enum(WORKFLOW_SITES);
const country = z.enum(["US", "JP", "BR", "ES"]);
const language = z.enum(["en", "ja", "pt-BR", "es-ES", "zh-CN"]);
const httpsUrl = z.url().max(3000).refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }, "需要 HTTPS 地址");
const workflowEvidenceSchema = z.object({ label: z.string().trim().min(1).max(300), url: httpsUrl.optional(), artifact: z.string().trim().min(1).max(2000).optional(), observedAt: stamp }).strict()
    .refine(value => Boolean(value.url || value.artifact), "证据需要来源链接或产物路径");
const evidence = z.array(workflowEvidenceSchema).max(100);
const taskProgress = z.object({
    id, sessionId: id, observedAt: stamp,
    summary: z.string().trim().min(1).max(1000),
    nextAction: z.string().trim().max(1000),
    evidence: z.array(workflowEvidenceSchema).min(1).max(10),
}).strict();
const approval = z.object({ kind: z.enum(["explicit", "standing_new_blog"]), approvedBy: z.string().trim().min(1).max(200), approvedAt: stamp, contentVersion: z.string().min(1).max(200), evidence: evidence.min(1) }).strict();
const research = z.object({ volume: z.number().int().nonnegative().nullable(), kd: z.number().min(0).max(100).nullable(), businessValue: z.number().int().min(0).max(3).nullable(), exceptionReason: z.string().trim().max(2000).nullable(), intent: z.string().trim().max(2000), observedAt: stamp, evidence: evidence.min(1) }).strict();
const workflowCodeSourceSchema = z.object({
    repository: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(200),
    branch: z.string().trim().regex(/^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*$/).max(180)
        .refine(value => !/^(main|master|staging|production)$/i.test(value) && !value.endsWith(".lock"), "请选择该页面独立的工作分支"),
    commitSha: z.string().trim().regex(/^[a-f0-9]{40}$/),
}).strict();
const workflowTaskSchema = z.object({
    id, weekStart: workflowWeekSchema, title: z.string().trim().min(1).max(500), siteDomain: site, deletedAt: stamp.optional(),
    channel: z.enum(["website", "github", "product"]).optional(),
    kind: z.enum(["blog", "landing", "optimization", "cluster", "technical", "research", "promotion", "review"]),
    country: country.nullable(), language: language.nullable(), business: z.enum(["API", "GPU", "CLUSTER"]),
    pageType: z.enum(["blog", "landing", "tool", "comparison", "tutorial", "pricing", "integration", "technical", "other"]),
    keyword: z.string().trim().min(1).max(300).nullable(), keywordId: z.string().trim().min(1).max(160).nullable().default(null), pageUrl: httpsUrl.nullable(),
    changeScope: z.literal("search_intent").optional(), codeSource: workflowCodeSourceSchema.optional(),
    branchObservation: z.object({ headSha: z.string().regex(/^[a-f0-9]{40}$/), observedAt: stamp }).strict().optional(),
    owner: z.string().trim().min(1).max(200), dueAt: stamp, status: z.enum(WORKFLOW_STATUSES),
    dependencies: z.array(id).max(100), evidence, nextAction: z.string().trim().max(3000),
    // Internal task explanations are Chinese; page language and target queries remain unchanged.
    brief: z.object({
        reason: z.string().trim().min(1).max(3000).refine(value => /[\u3400-\u9fff]/u.test(value), "任务原因须用中文说明数据对应的具体问题"),
        plan: z.string().trim().min(1).max(3000).refine(value => /[\u3400-\u9fff]/u.test(value), "任务方案须用中文说明对应的处理动作"),
        problem: z.string().trim().min(1).max(2000).optional(),
        actions: z.array(z.object({ target: z.string().trim().min(1).max(1000), change: z.string().trim().min(1).max(2000), verify: z.string().trim().min(1).max(2000) }).strict()).min(1).max(20).optional(),
        evidence: evidence.min(1).optional(),
    }).strict().optional(),
    progress: z.array(taskProgress).max(100).optional(),
    contentVersion: z.string().trim().max(200).nullable(), artifactUrl: httpsUrl.nullable().default(null),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(30),
    research: research.nullable().default(null), approval: approval.nullable().default(null),
    source: z.enum(["human", "automation", "sheet"]), sourceRowId: z.string().max(500).nullable().default(null),
    fallbackReason: z.string().max(2000).nullable().default(null), failureReason: z.string().max(3000).nullable().default(null),
}).strict().superRefine((value, ctx) => {
    if (value.branchObservation && !value.codeSource)
        ctx.addIssue({ code: "custom", message: "分支检查须关联已登记的代码分支" });
    if (value.codeSource && (value.contentVersion !== value.codeSource.commitSha || (value.siteDomain === "flatkey.ai" && !value.artifactUrl) || !value.pageUrl))
        ctx.addIssue({ code: "custom", message: "代码分支必须绑定同一提交的测试地址和正式页面" });
    if (value.changeScope && (value.kind !== "optimization" || !value.pageUrl || !value.evidence.length))
        ctx.addIssue({ code: "custom", message: "搜索意图整改须关联已有页面和发现证据" });
    if (value.country && value.language && !workflowContentLanguages(value.siteDomain, value.country).includes(value.language))
        ctx.addIssue({ code: "custom", path: ["language"], message: "语言与 Flatkey 目标市场或集群站已支持语言不匹配" });
    if (["blog", "landing", "optimization", "cluster"].includes(value.kind) && (!value.country || !value.language || !value.keyword))
        ctx.addIssue({ code: "custom", message: "内容任务必须有明确国家、本语言关键词和语言" });
    if (value.channel === "github") {
        if (!value.pageUrl || !githubReviewBelongsToSite(value.pageUrl, value.siteDomain) || value.kind !== "technical")
            ctx.addIssue({ code: "custom", path: ["pageUrl"], message: "GitHub任务只允许Flatkey两个自有提示词库的渠道审核，不计博客或落地页产量" });
    }
    else if (value.channel === "product") {
        if (value.kind !== "technical" || value.siteDomain !== "flatkey.ai" || value.pageUrl && !productReviewBelongsToSite(value.pageUrl, value.siteDomain))
            ctx.addIssue({ code: "custom", path: ["pageUrl"], message: "产品渠道只允许Flatkey主站、Console与Router的技术变更审核" });
    }
    else if (value.pageUrl && !pageBelongsToSite(value.pageUrl, value.siteDomain))
        ctx.addIssue({ code: "custom", path: ["pageUrl"], message: "页面不属于选定站点" });
    if (value.dependencies.includes(value.id) || new Set(value.dependencies).size !== value.dependencies.length)
        ctx.addIssue({ code: "custom", path: ["dependencies"], message: "依赖不能重复或指向自身" });
    if (new Date(value.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) < value.weekStart || new Date(value.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) > shiftWorkflowDay(value.weekStart, 6))
        ctx.addIssue({ code: "custom", path: ["dueAt"], message: "交付日须在对应周一至周日内" });
    if (value.keyword && value.language !== "ja" && value.language !== "zh-CN" && /[\u3400-\u9fff]/u.test(value.keyword))
        ctx.addIssue({ code: "custom", path: ["keyword"], message: "英文、葡语和西语任务不能使用中文主词" });
    if (["blocked", "failed"].includes(value.status) && !value.failureReason)
        ctx.addIssue({ code: "custom", path: ["failureReason"], message: "阻塞或失败必须说明原因" });
});
const workflowIssueSchema = z.object({
    id, weekStart: workflowWeekSchema, siteDomain: site, pageUrl: httpsUrl.nullable(), title: z.string().min(1).max(500),
    category: z.enum(["technical", "indexing", "language", "content", "data", "business", "sync"]), priority: z.enum(["P0", "P1", "P2", "P3"]),
    status: z.enum(["open", "investigating", "blocked", "resolved"]), owner: z.string().min(1).max(200), taskId: id.nullable(), firstSeenAt: stamp,
    impact: z.string().min(1).max(3000), nextAction: z.string().max(3000), evidence, resolvedAt: stamp.nullable(), resolutionEvidence: evidence,
}).strict().superRefine((value, ctx) => { if (value.status === "resolved" && (!value.resolvedAt || !value.resolutionEvidence.length))
    ctx.addIssue({ code: "custom", message: "问题关闭需要恢复验证证据" }); });
function githubReviewBelongsToSite(value, domain) {
    try {
        const url = new URL(value);
        if (domain !== "flatkey.ai" || url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port || url.hash || url.search || /%(?:2f|5c|25)/i.test(url.pathname))
            return false;
        return ["/flatkey-ai/awesome-images", "/flatkey-ai/awesome-seedance-prompts"].some(repo => url.pathname === repo || url.pathname.startsWith(repo + "/"));
    }
    catch {
        return false;
    }
}
function pageBelongsToSite(value, domain) { const url = new URL(value); return url.protocol === "https:" && [domain, `www.${domain}`].includes(url.hostname) && !url.username && !url.password && !url.port && !url.hash; }
function productReviewBelongsToSite(value, domain) {
    // Explicit production host ownership only. Reject raw escape syntax before
    // URL normalisation can erase a port, path traversal or encoded separator.
    if (domain !== "flatkey.ai" || !/^https:\/\/(?:flatkey\.ai|www\.flatkey\.ai|console\.flatkey\.ai|router\.flatkey\.ai)(?:\/|$)/.test(value) || /[\\%?#]/.test(value) || [...value].some(char => char.charCodeAt(0) <= 32) || value.split("/").some(part => part === "." || part === ".."))
        return false;
    try {
        const url = new URL(value);
        return !url.username && !url.password && !url.port && !url.search && !url.hash;
    }
    catch {
        return false;
    }
}
function shiftWorkflowDay(value, days) { return new Date(Date.parse(value + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10); }

// BEGIN TASK BRIEF CLIENT CONTRACT
const SOURCE_BRIEF_SHA256 = "158f15bfc23ea2b5804c34eff80080290b98c3a28f2ba6019eb80f515ef24eb8";
function isChineseTaskProse(value, minimumHan = 8) {
    const prose = value.replace(/https?:\/\/\S+|`[^`]*`|「[^」]*」|“[^”]*”|"[^"]*"/gu, " ")
        .replace(/\b(?:Flatkey|ModelFit|RackRate|NVIDIA|CUDA|GSC|GA4|SEO|API|GPU|LLM|VRAM|SSE|WebSocket|KV|LoRA|QLoRA|GGUF|Safetensors|vLLM)\b/giu, " ");
    const han = prose.match(/\p{Script=Han}/gu)?.length ?? 0;
    const foreign = prose.match(/(?!\p{Script=Han})\p{Letter}/gu)?.length ?? 0;
    return han >= minimumHan && han >= foreign;
}
const generic = (text) => /^(?:优化|提升|提高|改善|完善|补充)(?:优化|提升|提高|改善|完善|补充|页面|内容|seo|搜索|排名|流量|转化|效果|体验|关键词|质量|结构|点击率|表现|可见度|的|和|与|及)+$/iu.test(text.replace(/[\s\p{P}\p{S}]/gu, ""));
function taskNeedsChineseBrief(task) {
    return ["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(task.siteDomain)
        && task.channel !== "product" && task.channel !== "github" && !task.id.startsWith("codex-thread:");
}
function workflowTaskBriefProblems(task) {
    const brief = task.brief;
    if (!brief)
        return ["缺少中文任务说明 brief"];
    const problems = [];
    if (!isChineseTaskProse(task.title, 1))
        problems.push("任务标题须用中文，原语言关键词可加引号保留");
    if (!isChineseTaskProse(brief.reason, 16) || generic(brief.reason))
        problems.push("为什么做须用中文解释数据说明的问题，不能只列指标");
    if (!/(?:说明|反映|存在|导致|但|因此|需要|缺少|缺乏|尚未|未能|无法|待核|样本|不足|意图|已有|区别)/u.test(brief.reason))
        problems.push("为什么做缺少问题解释或事实限制");
    if (!brief.problem || !isChineseTaskProse(brief.problem) || generic(brief.problem))
        problems.push("须明确具体问题 brief.problem");
    if (!isChineseTaskProse(brief.plan, 12) || generic(brief.plan))
        problems.push("具体方案须用中文说明处理动作");
    if (!brief.evidence?.length)
        problems.push("任务原因须关联真实来源 brief.evidence");
    if (!brief.actions?.length)
        problems.push("须列出具体修改与验证 brief.actions");
    for (const [index, action] of (brief.actions ?? []).entries()) {
        if (!action.target.trim() || !isChineseTaskProse(action.change) || generic(action.change)
            || !isChineseTaskProse(action.verify) || generic(action.verify))
            problems.push(`第 ${index + 1} 项须写清目标页面/模块、中文修改内容及验证方法`);
    }
    if (task.nextAction && !isChineseTaskProse(task.nextAction, 1))
        problems.push("任务执行说明须用中文");
    if (task.acceptanceCriteria.some(item => !isChineseTaskProse(item, 1)))
        problems.push("验收要求须用中文");
    return problems;
}
// END TASK BRIEF CLIENT CONTRACT

module.exports = { CLIENT_CONTRACT_VERSION, SOURCE_CONTRACT_SHA256, SOURCE_BRIEF_SHA256, workflowTaskSchema, workflowIssueSchema, workflowWeekSchema, taskNeedsChineseBrief, workflowTaskBriefProblems };
