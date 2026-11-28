import "server-only";
import type { Prisma } from "@prisma/client";
import type { GrowthStrategy } from "../growth-strategy";
import { growthWebsitePageUrl } from "../growth-live-page";
import { isOwnedBrandKeyword } from "../keyword-market-policy";
import { capacityPlanAcceptsResearch } from "../seo-quarter-content";
import { WorkflowError, type WorkflowStoredRow } from "../seo-workflow-state";
import type { WorkflowHistoricalImport, WorkflowPlan, WorkflowPublication, WorkflowTask } from "../seo-workflow";

export async function admitQuarterKeyword(
  tx: Prisma.TransactionClient, task: Omit<WorkflowTask, "version" | "recordedAt" | "updatedAt">,
  all: WorkflowStoredRow[], strategy: GrowthStrategy, now: Date,
) {
  const { keyword, siteDomain, topicId, research, researchReview } = task;
  const page = growthWebsitePageUrl(task.pageUrl, siteDomain);
  const planHash = strategy.baseline?.planHash;
  const workingPlan = planHash ? all.find(row => row.kind === "plan"
    && capacityPlanAcceptsResearch(task, row.record as WorkflowPlan, planHash)) : undefined;
  if (task.status !== "ready" || task.workflowContract !== "growth-v1.5" || !keyword || !topicId
    || !page || new URL(page).search || !workingPlan || Date.parse(task.dueAt) <= now.getTime()
    || task.deletedAt || task.channel === "github" || task.channel === "product" || isOwnedBrandKeyword(keyword)) {
    throw new WorkflowError("quarter_keyword_scope", "仅可为有效制作周的待制作官网新任务登记真实、非自有品牌的原词", 422);
  }
  if (!research?.intent || !research.businessValue || !researchReview || researchReview.duplicateTaskIds.length
    || !task.evidence.length) {
    throw new WorkflowError("quarter_keyword_research", "登记原词须具备真实需求、原市场搜索意图、业务承接与查重证据", 422);
  }
  const previous = all.find(row => row.kind === "task" && row.record.id === task.id)?.record as WorkflowTask | undefined;
  if (previous && (previous.deletedAt || !["planned", "researching"].includes(previous.status) || previous.kind !== task.kind
    || previous.siteDomain !== siteDomain || previous.topicId && previous.topicId !== topicId
    || previous.keyword && previous.keyword !== keyword || previous.country && previous.country !== task.country
    || previous.language && previous.language !== task.language
    || previous.pageUrl && growthWebsitePageUrl(previous.pageUrl, siteDomain) !== page)) {
    throw new WorkflowError("quarter_keyword_original", "沿原研究任务保留本站、原词、话题、国家语种与拟发页", 409);
  }
  const samePage = (url: string | null) => growthWebsitePageUrl(url, siteDomain) === page;
  const normalized = (value: string | null) => value?.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  const duplicate = all.some(({ kind, record }) => {
    if (kind === "task") {
      const other = record as WorkflowTask;
      return other.id !== task.id && !other.deletedAt && other.siteDomain === siteDomain
        && ["blog", "landing", "cluster", "optimization"].includes(other.kind) && (samePage(other.pageUrl)
          || other.country === task.country && other.language === task.language && normalized(other.keyword) === normalized(keyword));
    }
    if (kind === "publication") {
      const other = record as WorkflowPublication;
      return other.siteDomain === siteDomain && ["published", "verified"].includes(other.status) && samePage(other.pageUrl);
    }
    if (kind !== "historical_import") return false;
    const archive = record as WorkflowHistoricalImport;
    return archive.siteDomain === siteDomain && archive.publications.some(other => other.verificationState === "live_verified" && samePage(other.pageUrl));
  });
  const www = new URL(page);
  www.hostname = "www." + www.hostname;
  const inventory = await tx.seoPageInventory.findFirst({
    where: { url: { in: [page, page + "/", www.href, www.href + "/"] } }, select: { url: true },
  });
  if (duplicate || inventory) throw new WorkflowError("quarter_keyword_duplicate", "本站拟发规范页或同市场原意图已有记录，请复用原页或原任务", 409);

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${siteDomain}`}))`;
  const matches = await tx.keyword.findMany({ where: { text: { equals: keyword, mode: "insensitive" } },
    select: { id: true, text: true, active: true }, take: 2 });
  const existing = matches[0];
  if (matches.length > 1 || existing && (!existing.active || existing.text !== keyword)
    || task.keywordId && existing?.id !== task.keywordId || previous?.keywordId && existing?.id !== previous.keywordId) {
    throw new WorkflowError("quarter_keyword_identity", "原词已存在其他身份或曾停用，须先沿确切原词核对", 409);
  }
  const word = existing ?? await tx.keyword.create({
    data: { text: keyword, type: "LONG_TAIL", topicId, active: true }, select: { id: true },
  });
  const identity = { siteDomain, keywordId: word.id };
  const where = { siteDomain_keywordId: identity };
  const member = await tx.siteKeyword.findUnique({ where, include: { topicAssignments: { select: { topicId: true } } } });
  const topicMatches = member?.topicId === topicId || member?.topicAssignments.some(row => row.topicId === topicId);
  if (member && (!member.active || member.targetUrls.length || !["FORMAL", "RESEARCH"].includes(member.pool)
    || (member.topicId || member.topicAssignments.length) && !topicMatches || member.pool === "RESEARCH" && (member.protected || member.curationId || member.candidateUrls.length))) {
    throw new WorkflowError("quarter_keyword_existing_record", "本站原词已有归属、页面或人工筛检记录，请沿原记录核对", 409);
  }
  const confirmed = { pool: "FORMAL", reviewStatus: "QUARTER_RESEARCH_CONFIRMED", auditReason: `季度任务 ${task.id} 保存本站原词研究与查重证据` };
  if (!member) await tx.siteKeyword.create({ data: { ...identity, topicId, origin: "RESEARCH", ...confirmed } });
  else if (member.pool === "RESEARCH") await tx.siteKeyword.update({ where, data: { ...confirmed, topicId: member.topicId ?? topicId } });
  const edge = { ...identity, topicId };
  await tx.siteKeywordTopic.upsert({ where: { siteDomain_keywordId_topicId: edge }, create: edge, update: {} });
  return word.id;
}
