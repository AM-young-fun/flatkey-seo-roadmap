import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildGrowthWorkspace, GROWTH_MARKETS, GROWTH_SITES, growthPublicUrl, growthWordKey, type GrowthRankEvidence, type GrowthWorkspaceInput } from "@/lib/growth-workspace";
import { MARKET_ASSIGNMENT_SOURCE_ID } from "@/lib/keyword-market-policy";
import { loadWorkflowSnapshot } from "./seo-workflow";
import type { WorkflowSnapshot } from "@/lib/seo-workflow";
import type { GrowthWorkspace } from "@/lib/growth-types";
import { approvedDiagnosticWordLanguages } from "@/lib/growth-word-language-evidence";
import { siteSourceReadiness } from "@/lib/seo-cluster-sites";
import { buildGrowthCollectionManifest, growthCollectionMonitoringQuote } from "@/lib/growth-collection";
import { serpPeriod } from "@/lib/serp-periods";
import { buildGrowthHotspotView, publishedGrowthHotspotTaskIds } from "@/lib/growth-hotspots";
import { growthStrategyStoredSchema } from "@/lib/growth-strategy";
import { HUMAN_WORD_LANGUAGE_SOURCE_ID, PRE_FREEZE_IDENTITY_AUDIT, auditedHumanWordLanguages, type IdentitySourceRow } from "@/lib/pre-freeze-market-identities";
import { projectAppliedQuarterManifestTopics } from "@/lib/applied-quarter-manifest";
import { QUARTER_MEMBERSHIP_STATUS } from "@/lib/quarter-membership";
import { growthPageAuditChecks, growthPublicationPageChecks } from "@/lib/growth-live-page-evidence";
import { PAGE_AUDIT_SOURCE_ID } from "@/lib/page-audit";
import { requestRead } from "@/lib/request-read-scope";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown) => Array.isArray(value) ? value.map(object) : [];
const date = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const languageFor = (country: string) => GROWTH_MARKETS.find(market => market.country === country)?.language ?? null;
type SavedTask = { id: string; keyword: string; region: string; targetsJson: unknown; state: string; checkedAt: Date | null; providerTaskId: string | null; requestJson: unknown; normalizedJson: unknown; runId: string; periodKey: string; periodLabel: string; scope: string; cohortHash: string | null; targetCount: number; queryCount: number };
const providerMarkets: Record<string, { location: number; language: string[] }> = {
  US: { location: 2840, language: ["en"] }, JP: { location: 2392, language: ["ja"] }, BR: { location: 2076, language: ["pt", "pt-BR"] },
  ES: { location: 2724, language: ["es", "es-ES"] }, CN: { location: 2156, language: ["zh-CN"] }, SG: { location: 2702, language: ["zh-CN"] },
  FR: { location: 2250, language: ["fr", "fr-FR"] }, DE: { location: 2276, language: ["de", "de-DE"] }, VN: { location: 2704, language: ["vi", "vi-VN"] }, ID: { location: 2360, language: ["id", "id-ID"] },
};

/** Read saved normalized results from every original run scope. Historical
 * views keep the full archive; the dashboard bounds the same evidence by its
 * eligibility window. Trim competitors before transferring the results. */
async function savedSerpEvidence(db: Prisma.TransactionClient | typeof prisma = prisma, asOf?: Date): Promise<GrowthRankEvidence[]> {
  const cutoff = asOf && new Date(asOf.getTime() - 14 * 86_400_000);
  const tasks = await db.$queryRaw<SavedTask[]>(Prisma.sql`
    SELECT t.id, t.keyword, t.region, t."targetsJson", t.state, t."checkedAt", t."providerTaskId", t."requestJson",
      r.id AS "runId", r."periodKey", r."periodLabel", r.scope, r."cohortHash", r."targetCount", r."queryCount",
      jsonb_build_object('keyword', "normalizedJson"->'keyword', 'locationCode', "normalizedJson"->'locationCode',
        'languageCode', "normalizedJson"->'languageCode', 'queryStatus', "normalizedJson"->'queryStatus',
        'rankingVerified', "normalizedJson"->'rankingVerified', 'captureComplete', "normalizedJson"->'captureComplete',
        'completeDepth', "normalizedJson"->'completeDepth',
        'organicResults', COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof("normalizedJson"->'organicResults') = 'array' THEN "normalizedJson"->'organicResults' ELSE '[]'::jsonb END
        ) item WHERE item->>'domain' IN ('flatkey.ai', 'www.flatkey.ai', 'rackrate.org', 'www.rackrate.org', 'modelfit.cc', 'www.modelfit.cc')), '[]'::jsonb)) AS "normalizedJson"
    FROM "SerpMonitorTask" t JOIN "SerpMonitorRun" r ON r.id = t."runId" WHERE t."checkedAt" IS NOT NULL
      ${cutoff ? Prisma.sql`AND t."checkedAt" BETWEEN ${cutoff} AND ${asOf}` : Prisma.empty}
    ORDER BY t."checkedAt" DESC, t.id
  `);
  return tasks.flatMap(task => {
    const normalized = object(task.normalizedJson), request = object(task.requestJson), market = providerMarkets[task.region];
    const exact = Boolean(market && normalized.queryStatus === "EXACT" && normalized.rankingVerified === true
      && typeof normalized.keyword === "string" && growthWordKey(normalized.keyword) === growthWordKey(task.keyword)
      && normalized.locationCode === market.location && typeof normalized.languageCode === "string" && market.language.includes(normalized.languageCode)
      && request.device === "desktop" && typeof request.depth === "number" && request.depth >= 100
      && request.location_code === market.location && typeof request.language_code === "string" && market.language.includes(request.language_code)
      && task.providerTaskId && /^[a-zA-Z0-9-]{1,160}$/.test(task.providerTaskId));
    const complete = exact && normalized.captureComplete === true && ["COMPLETE", "INCOMPLETE"].includes(task.state);
    const declaredTargets=array(task.targetsJson);
    const targetSites = new Set(declaredTargets.flatMap(target => typeof target.siteDomain === "string" ? [target.siteDomain] : []));
    const organic = array(normalized.organicResults);
    for (const result of organic) if (typeof result.url === "string") for (const site of GROWTH_SITES.filter(site => site.keywordGoals)) if (growthPublicUrl(result.url, site.domain)) targetSites.add(site.domain);
    return [...targetSites].filter(site => GROWTH_SITES.some(item => item.domain === site && item.keywordGoals)).flatMap<GrowthRankEvidence>(site => {
      const originalIds=[...new Set(declaredTargets.filter(target=>target.siteDomain===site&&typeof target.keywordId==="string"&&typeof target.keyword==="string"&&growthWordKey(target.keyword)===growthWordKey(task.keyword)).map(target=>String(target.keywordId)))];
      const base = { site, keywordId:originalIds.length===1?originalIds[0]:null,keyword: task.keyword, country: task.region, language: languageFor(task.region), source: "serp" as const, checkedAt: date(task.checkedAt), exact, complete, evidenceId: task.id,
        period: { id: task.runId, periodKey: task.periodKey, label: task.periodLabel, scope: task.scope, cohortHash: task.cohortHash, originalTargetCount: task.targetCount, originalQueryCount: task.queryCount } };
      const hits = organic.flatMap(result => {
        const url = typeof result.url === "string" ? growthPublicUrl(result.url, site) : null;
        return url && typeof result.rankGroup === "number" && Number.isInteger(result.rankGroup) && result.rankGroup >= 1 && result.rankGroup <= 100 ? [{ ...base, rank: result.rankGroup, url, captureState: "ranked" as const }] : [];
      });
      return hits.length ? hits : [{ ...base, rank: null, url: null, captureState: complete && normalized.completeDepth === true ? "outside100" as const : "incomplete" as const,
        // A partial provider page without a hit cannot prove outside the top 100.
        complete: complete && normalized.completeDepth === true }];
    });
  });
}

async function savedDiscoveryEvidence(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<GrowthRankEvidence[]> {
  const runs = await db.dataForSeoRun.findMany({ where: { status: "COMPLETED", OR:[{requestId:{startsWith:"discovery-"}},{requestId:{startsWith:"gd-"}}] }, select: { requestId: true, siteDomain: true, normalized: true, collectedAt: true } });
  return runs.flatMap(run => {
    const snapshot = object(run.normalized), country = typeof snapshot.region === "string" ? snapshot.region : null;
    if (snapshot.datasetType !== "provider_ranked_keywords_snapshot" || !country || snapshot.targetDomain !== run.siteDomain) return [];
    return array(snapshot.rows).flatMap(row => {
      const keyword = typeof row.rawKeyword === "string" ? row.rawKeyword : typeof row.keyword === "string" ? row.keyword : null;
      const url = typeof row.url === "string" ? growthPublicUrl(row.url, run.siteDomain) : null;
      return keyword && url && row.region === country && typeof row.rank_group === "number" && row.rank_group >= 1 && row.rank_group <= 100 ? [{ site: run.siteDomain, keyword, country, language: languageFor(country), rank: row.rank_group, url, source: "database" as const,
        checkedAt: typeof row.sourceSerpUpdatedAt === "string" ? row.sourceSerpUpdatedAt : null, exact: true, complete: false, evidenceId: run.requestId }] : [];
    });
  });
}

type DashboardHistory = Pick<WorkflowSnapshot, "tasks" | "publications">;

export function loadGrowthDashboardHistory(localPreview = false): Promise<DashboardHistory> {
  if (localPreview) return loadWorkflowSnapshot({ allHistory: true }, true);
  return requestRead("growth:dashboard:history", async () => {
    const rows = await prisma.$queryRaw<{ kind: "task" | "publication"; payload: unknown }[]>(Prisma.sql`
      SELECT kind, CASE WHEN kind = 'task' THEN jsonb_build_object(
        'id', payload->'id', 'siteDomain', payload->'siteDomain', 'keyword', payload->'keyword',
        'keywordId', payload->'keywordId', 'country', payload->'country', 'language', payload->'language',
        'pageUrl', payload->'pageUrl', 'status', payload->'status', 'channel', payload->'channel',
        'kind', payload->'kind', 'dueAt', payload->'dueAt', 'workClass', payload->'workClass',
        'contentVersion', payload->'contentVersion', 'progress', payload->'progress'
      ) ELSE jsonb_build_object(
        'id', payload->'id', 'taskId', payload->'taskId', 'siteDomain', payload->'siteDomain',
        'pageUrl', payload->'pageUrl', 'title', payload->'title', 'status', payload->'status',
        'publishedAt', payload->'publishedAt', 'country', payload->'country', 'language', payload->'language',
        'keyword', payload->'keyword', 'kind', payload->'kind', 'contentVersion', payload->'contentVersion'
      ) END AS payload
      FROM "SeoWorkflowRecord"
      WHERE (kind = 'task' AND payload->>'deletedAt' IS NULL)
         OR (kind = 'publication' AND payload->>'status' IN ('published', 'verified'))
      ORDER BY "updatedAt" DESC
    `);
    const tasks = rows.flatMap(row => row.kind === "task" ? [row.payload as DashboardHistory["tasks"][number]] : []);
    const publications = rows.flatMap(row => row.kind === "publication" ? [row.payload as DashboardHistory["publications"][number]] : []);
    return { tasks: tasks.sort((a, b) => a.dueAt.localeCompare(b.dueAt)), publications: publications.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) };
  });
}

export function loadGrowthDashboardWorkspace(localPreview = false, now = new Date(), selectedSite?: string) {
  return readGrowthWorkspace(localPreview, now, selectedSite, { dashboard: true });
}

/** No import APIs, mutations, provider fetches, scheduling or paid switches. */
export function loadGrowthWorkspace(localPreview = false, now = new Date(), selectedSite?: string, transaction?: { db: Prisma.TransactionClient; workflow: WorkflowSnapshot }): Promise<GrowthWorkspace> {
  return readGrowthWorkspace(localPreview, now, selectedSite, { transaction });
}

async function readGrowthWorkspace(localPreview: boolean, now: Date, selectedSite: string | undefined, { dashboard = false, transaction }: { dashboard?: boolean; transaction?: { db: Prisma.TransactionClient; workflow: WorkflowSnapshot } }): Promise<GrowthWorkspace> {
  if (!process.env.DATABASE_URL) throw new Error("GROWTH_DATABASE_UNAVAILABLE");
  const db = transaction?.db ?? prisma;
  const goalSites = GROWTH_SITES.filter(site => site.keywordGoals).map(site => site.domain);
  const [topics, members, assignments, inventory, workflow, savedSites, planRows, quarterRow, membershipAudit, optional] = await Promise.all([
    db.topic.findMany({ select: { id: true, text: true, active: true, parentId: true, childEdges: { select: { parentId: true } }, sites: { select: { siteDomain: true } } } }),
    db.siteKeyword.findMany({ where: { siteDomain: { in: goalSites } }, select: { siteDomain: true, keywordId: true, active: true, topicId: true, pool: true, origin: true, targetUrls: true, mappingStatus: true, sourceUrl: true,
      topicAssignments: { select: { topicId: true } }, keyword: { select: { text: true, active: true } } } }),
    db.keywordSourceRow.findMany({ where: { siteDomain: { in: goalSites }, sourceId: MARKET_ASSIGNMENT_SOURCE_ID }, select: { siteDomain: true, rowKey: true, snapshot: true } }),
    db.seoPageInventory.findMany({ select: { url: true, lastSeen: true } }),
    transaction?.workflow ?? (dashboard ? loadGrowthDashboardHistory(localPreview) : loadWorkflowSnapshot({ allHistory: true }, localPreview)),
    db.seoSite.findMany({ select: { domain: true, active: true, ga4PropertyId: true } }),
    db.seoWorkflowRecord.findMany({where:{kind:"plan",status:{in:["scheduled","reviewed"]}},select:{recordId:true,status:true,payload:true}}),
    db.seoWorkflowRecord.findUnique({ where: { key: "growth-strategy:2026-close" }, select: { payload: true } }),
    db.keywordCurationAudit.findFirst({ where: { status: QUARTER_MEMBERSHIP_STATUS }, orderBy: { appliedAt: "desc" },
      select: { id: true, siteDomain: true, status: true, payloadHash: true, before: true, after: true, summary: true, appliedAt: true, restoredAt: true } }),
    Promise.allSettled([savedSerpEvidence(db, dashboard ? now : undefined),
      dashboard ? Promise.resolve([]) : savedDiscoveryEvidence(db),
      dashboard ? Promise.resolve([]) : db.keywordPageObservation.findMany({ where: { siteDomain: { in: goalSites }, rank: { gte: 1, lte: 100 } }, select: { keywordId: true, keyword: { select: { text: true } }, siteDomain: true, region: true, source: true, rank: true, url: true, dataUpdatedAt: true, collectedAt: true } })]),
  ]);
  const humanLanguageRows = await db.keywordSourceRow.findMany({ where: { siteDomain: { in: goalSites }, sourceId: HUMAN_WORD_LANGUAGE_SOURCE_ID }, select: { siteDomain: true, sourceId: true, rowKey: true, snapshotHash: true, snapshot: true } });
  const humanAuditIds = [...new Set(humanLanguageRows.flatMap(row => typeof object(row.snapshot).auditId === "string" ? [String(object(row.snapshot).auditId)] : []))];
  const humanAudits = humanAuditIds.length ? await db.keywordCurationAudit.findMany({ where: { id: { in: humanAuditIds }, status: PRE_FREEZE_IDENTITY_AUDIT }, select: { id: true, status: true, summary: true, payloadHash: true } }) : [];
  const humanLanguages = auditedHumanWordLanguages(humanLanguageRows as IdentitySourceRow[], humanAudits);
  const sources: GrowthWorkspace["reconciliation"]["sources"] = [{ name: "TopicMap／站点成员／真实页面库存／跨周原任务", available: true, reason: null }];
  const plans=planRows.flatMap(row=>{const plan=object(row.payload);return plan.id===row.recordId&&plan.status===row.status&&Array.isArray(plan.taskIds)&&plan.taskIds.every(id=>typeof id==="string")?[{id:row.recordId,status:row.status,taskIds:plan.taskIds as string[]}]:[];});
  sources.push({name:"原全历史正式计划与原市场源交付",available:true,reason:`只读核验${plans.length}条scheduled/reviewed原计划；DB研究池不改，无对应证据保留待核`});
  sources.push({name:"原1031诊断提案语种证据",available:true,reason:"仅复用原词span/rule/sourcehash；diagnosticOnly=true，未批准长期主国，不据收费清单分配国家"});
  const ranks: GrowthRankEvidence[] = [];
  const names = ["全部已存SERP（含1499诊断批次）", "已存域名发现（供应商数据库）", "已存逐页搜索观测"];
  optional.forEach((result, index) => {
    if (dashboard && index > 0) return;
    sources.push({ name: dashboard ? "最近14天的已存SERP" : names[index], available: result.status === "fulfilled", reason: result.status === "rejected" ? "来源读取失败；未补采、未将缺项填0" : null });
    if (result.status !== "fulfilled") return;
    if (index < 2) ranks.push(...result.value as GrowthRankEvidence[]);
    else for (const row of result.value as { keywordId: string; keyword: { text: string }; siteDomain: string; region: string; source: string; rank: number | null; url: string; dataUpdatedAt: Date | null; collectedAt: Date }[]) {
      if (!row.siteDomain || !growthPublicUrl(row.url, row.siteDomain)) continue;
      ranks.push({ site: row.siteDomain, keywordId: row.keywordId, keyword: row.keyword.text, country: row.region, language: languageFor(row.region), rank: row.rank, url: row.url,
        source: /gsc|google_search_console/i.test(row.source) ? "gsc" : "database", checkedAt: date(row.dataUpdatedAt), exact: true, complete: false });
    }
  });
  const assignmentById = new Map(assignments.map(row => [`${row.siteDomain}:${row.rowKey}`, row.snapshot]));
  const input: GrowthWorkspaceInput = { generatedAt: now.toISOString(), topics: topics.map(topic => ({ id: topic.id, text: topic.text, active: topic.active, parentId: topic.parentId, parentIds: topic.childEdges.map(edge => edge.parentId), sites: topic.sites.map(site => site.siteDomain) })),
    memberships: members.map(row => ({ site: row.siteDomain, keywordId: row.keywordId, keyword: row.keyword.text, keywordActive: row.keyword.active, active: row.active, topicId: row.topicId, topicIds: row.topicAssignments.map(assignment => assignment.topicId), pool: row.pool, origin: row.origin,
      targetUrls: row.targetUrls, sourceUrl: row.sourceUrl, mappingStatus: row.mappingStatus, marketAssignment: assignmentById.get(`${row.siteDomain}:keyword:${row.keywordId}`) })),
    inventory: inventory.map(row => ({ url: row.url, lastSeen: row.lastSeen.toISOString() })), tasks: workflow.tasks, publications: workflow.publications, plans,wordLanguageEvidence:[...approvedDiagnosticWordLanguages(), ...humanLanguages],ranks, sources };
  const currentTopics = projectAppliedQuarterManifestTopics(input, membershipAudit, savedSites);
  sources.push({ name: "当前季度已应用人审主话题清单", available: Boolean(currentTopics.applied),
    reason: currentTopics.applied
      ? `仅当前视图投影${currentTopics.projections.length}项本站原ID主话题，${currentTopics.skipped}项当前关系/启用条件不符保留原值；审计${currentTopics.applied.auditId}，清单SHA ${currentTopics.applied.selectionHash}。数据库主父、旧边和历史期次未改。`
      : membershipAudit ? "最新成员审计未通过确切apply/来源/成员哈希校验，未借用预览或回退旧清单改主话题。" : "尚无已应用的完整1600人审成员清单，保留当前数据库主话题。" });
  const workspace = buildGrowthWorkspace(currentTopics.input, selectedSite);
  // Export the original stored primary alongside the current-only preference;
  // consumers must not interpret this as a database relationship migration.
  const topicProvenance = new Map(currentTopics.projections.map(row => [`${row.site}\u0000${row.keywordId}`, row]));
  const withTopicProvenance = (target: GrowthWorkspace["targets"][number]) => {
    const proof = target.keywordId ? topicProvenance.get(`${target.site}\u0000${target.keywordId}`) : undefined;
    return proof && proof.keyword === target.keyword && target.topicId === proof.topicId ? { ...target, currentQuarterTopicProjection: proof } : target;
  };
  workspace.targets = workspace.targets.map(withTopicProvenance);
  workspace.opportunities = workspace.opportunities.map(withTopicProvenance);
  const quarterState = object(quarterRow?.payload), baseline = object(quarterState.baseline), quarterPlan = object(quarterState.quarterPlanning), approved = object(quarterPlan.approval);
  const quarterTargets = Array.isArray(baseline.targets) ? baseline.targets.flatMap(value => { const row = object(value); return typeof row.id === "string" ? [row.id] : []; }) : [];
  const approvedHistory = Array.isArray(quarterState.quarterPlanningHistory) ? quarterState.quarterPlanningHistory.map(object).filter(row => object(row.approval).hash === row.hash).at(-1) : undefined;
  const approvedHash = typeof quarterPlan.hash === "string" && approved.hash === quarterPlan.hash ? quarterPlan.hash : approvedHistory?.hash ?? baseline.sourceVersion;
  if (quarterTargets.length && typeof approvedHash === "string") workspace.quarter = { targetIds: quarterTargets, keywordCount: quarterTargets.length, hash: approvedHash };
  workspace.sites = workspace.sites.map(site => {
    const savedProperty = savedSites.find(saved => saved.domain === site.domain)?.ga4PropertyId;
    return { ...site, dataReadiness: siteSourceReadiness(site.domain, savedProperty) };
  });
  if (dashboard) return workspace;
  let pageAuditAvailable = true;
  const pageAudits = await db.keywordSourceRow.findMany({ where: { siteDomain: { in: goalSites }, sourceId: PAGE_AUDIT_SOURCE_ID,
    rowKey: { in: [...new Set(members.map(member => `keyword:${member.keywordId}`))] } }, select: { siteDomain: true, sourceId: true, rowKey: true, snapshotHash: true, snapshot: true } }).catch(() => { pageAuditAvailable = false; return []; });
  workspace.pageLiveChecks = [...growthPageAuditChecks(pageAudits, workspace.targets), ...growthPublicationPageChecks(workflow, workspace.targets)]
    .sort((a, b) => JSON.stringify([a.site, a.keywordId, a.url, a.checkedAt, a.source]).localeCompare(JSON.stringify([b.site, b.keywordId, b.url, b.checkedAt, b.source])));
  workspace.pageLiveEvidenceComplete = pageAuditAvailable;
  workspace.reconciliation.sources.push({ name: "现有逐页上线验收及反证", available: pageAuditAvailable, reason: pageAuditAvailable ? "仅复用正常page-audit/liveCheck回执；库存不代表当前HTTP200。缺少新24小时真实证据不授付费资格，不影响季度N/已有排名事实。" : "逐页QA来源未读齐；普通目标/历史保留，新的付费候选全部暂缓。" });
  const parsedStrategy = growthStrategyStoredSchema.safeParse(quarterRow?.payload);
  const authorizedHotTaskIds = new Set(parsedStrategy.success ? [...buildGrowthHotspotView(parsedStrategy.data, workflow, plans, now).items.filter(item => item.researchComplete && item.admission.status === "scheduled").flatMap(item => item.taskIds), ...publishedGrowthHotspotTaskIds(parsedStrategy.data, workflow, plans, now)] : []);
  const extraTasks = workflow.tasks.filter(task => task.capacityClass === "authorized_hotspot_extra" && !task.deletedAt && authorizedHotTaskIds.has(task.id));
  workspace.hotspotTargetIds = workspace.targets.filter(target => extraTasks.some(task => target.site === task.siteDomain && target.keywordId === task.keywordId && target.country === task.country && target.language === task.language && growthWordKey(target.keyword) === growthWordKey(task.keyword ?? ""))).map(target => target.id);
  workspace.monitoringQuote = growthCollectionMonitoringQuote(buildGrowthCollectionManifest(workspace, serpPeriod(now).key, { revision: 0, connectionVersion: 0 }, now));
  return workspace;
}
