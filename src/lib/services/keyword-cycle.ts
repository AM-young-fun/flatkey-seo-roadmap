import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { envBool } from "@/lib/env";
import { keywordCyclePlan, discoveryPageMatches } from "@/lib/keyword-cycle";
import { decryptDataForSeoCredentials } from "@/lib/dataforseo-credentials";
import { ENDPOINT, normalizeRankedKeywords, quoteForLimit, type DataForSeoNormalized } from "@/lib/dataforseo-labs.cjs";
import { buildDataForSeoImportPlan } from "@/lib/dataforseo-import-plan";
import { rankingImportSchema } from "@/lib/ranking-import";
import { importSeo } from "@/lib/services/seo-import";
import { keywordRelevance, normalizeKeywordText } from "@/lib/keyword-relevance";
import { SERP_CONFIG_ID } from "@/lib/dataforseo-serp";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const enabled = () => !envBool("DISABLE_EXTERNAL_FETCH");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
async function verifyPage(site: string, keyword: string, value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const own = (candidate: URL) => candidate.protocol === "https:" && !candidate.username && !candidate.password && !candidate.port &&
    (candidate.hostname === site || candidate.hostname === `www.${site}`);
  if (!own(url)) return null;
  const signal = AbortSignal.timeout(6000);
  try {
    for (let redirects = 0; redirects < 4; redirects++) {
      const response = await fetch(url, { redirect: "manual", signal, headers: { Accept: "text/html" } });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get("location"); await response.body?.cancel();
        if (!location) return null; url = new URL(location, url); if (!own(url)) return null; continue;
      }
      if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) { await response.body?.cancel(); return null; }
      const reader = response.body?.getReader(); if (!reader) return null;
      let html = "", size = 0; const decoder = new TextDecoder();
      try { while (size < 262144) { const chunk = await reader.read(); if (chunk.done) break; const remaining = 262144-size;
        html += decoder.decode(chunk.value.subarray(0,remaining), {stream:true}); size += chunk.value.length; } }
      finally { await reader.cancel(); }
      html = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
      const title = text(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""), h1 = text(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "");
      if (/noindex/i.test(response.headers.get("x-robots-tag") ?? "") || /<meta\b[^>]*(?:noindex|none)[^>]*>/i.test(html)) return null;
      const canonicalTag = (html.match(/<link\b[^>]*>/gi) ?? []).find(tag=>/\brel=["']canonical["']/i.test(tag));
      const canonical = canonicalTag ? /\bhref=["']([^"']+)["']/i.exec(canonicalTag)?.[1] : null;
      if (canonical && new URL(canonical,url).href.replace(/\/$/, "") !== url.href.replace(/\/$/, "")) return null;
      return discoveryPageMatches(site, keyword, title, h1) ? { url: url.href, title, h1, checkedAt: new Date().toISOString() } : null;
    }
  } catch { /* Failed validation never promotes or deletes a keyword. */ }
  return null;
}

async function applyDiscovery(snapshot: DataForSeoNormalized, requestId: string, deadline: number) {
  const site = snapshot.targetDomain;
  const memberships = await prisma.siteKeyword.findMany({ where: { siteDomain: site }, include: { keyword: true } });
  const known = new Set(memberships.map(row=>normalizeKeywordText(row.keyword.text)));
  const plan = buildDataForSeoImportPlan(snapshot, memberships, requestId);
  const run = await prisma.dataForSeoRun.findUniqueOrThrow({where:{requestId}});
  const saved = run.candidates && !Array.isArray(run.candidates) ? run.candidates as Record<string, unknown> : {};
  const best = new Map<string, typeof snapshot.rows[number]>();
  for (const row of plan.candidates) if (!known.has(row.keyword) && keywordRelevance(site,row.keyword).status !== "unrelated" && !best.has(row.keyword)) best.set(row.keyword,row);
  // New words are imported once as research. Existing manual classifications
  // and exclusions never get reactivated by a discovery response.
  const newRows = Array.isArray(saved.newWords) ? saved.newWords as typeof snapshot.rows : [...best.values()];
  const batches = [...plan.batches];
  const newWords = new Set(newRows.map(row=>row.keyword));
  const observation = (row: typeof snapshot.rows[number]) => ({keyword:row.keyword,region:row.region,source:"dataforseo_labs" as const,rank:row.rank_group,rankStatus:"ranked" as const,url:row.url,collectedAt:snapshot.collectedAt,
    ...(row.volume !== null ? {volume:row.volume} : {}),...(row.sourceSerpUpdatedAt ? {dataUpdatedAt:row.sourceSerpUpdatedAt} : {})});
  const pageRows = new Map<string, typeof snapshot.rows[number]>();
  for (const row of snapshot.rows) if (newWords.has(row.keyword)) {
    const key = `${row.keyword}\n${row.url}`, previous = pageRows.get(key);
    if (!previous || (row.sourceSerpUpdatedAt ?? "") > (previous.sourceSerpUpdatedAt ?? "") ||
      row.sourceSerpUpdatedAt === previous.sourceSerpUpdatedAt && row.rank_group < previous.rank_group) pageRows.set(key,row);
  }
  const records = [...newRows.map(row=>({kind:"word" as const,row})),...[...pageRows.values()].map(row=>({kind:"page" as const,row}))];
  for (let offset=0;offset<records.length;offset+=500) {
    const slice=records.slice(offset,offset+500);
    batches.push(rankingImportSchema.parse({requestId:`${requestId}-new-${offset}`,targetDomain:site,allowNewKeywords:true,
      observations:slice.filter(item=>item.kind === "word").map(item=>observation(item.row)),
      pages:slice.filter(item=>item.kind === "page").map(item=>observation(item.row))}));
  }
  const frozenBatches = Array.isArray(run.importPayload) ? run.importPayload.map(batch=>rankingImportSchema.parse(batch)) : batches;
  if (!Array.isArray(run.importPayload)) await prisma.dataForSeoRun.update({where:{requestId},data:{importPayload:json(frozenBatches),candidates:json({rows:plan.candidates,newWords:newRows}),summary:json(plan.summary)}});
  for (let index=run.importedBatches;index<frozenBatches.length;index++) {
    if (Date.now()+20_000 > deadline) return false;
    await importSeo(frozenBatches[index]);
    await prisma.dataForSeoRun.update({where:{requestId},data:{importedBatches:index+1}});
  }
  // Conservative automatic promotion; remaining discoveries stay in research.
  // No invented "missing page" or pending-review state enters formal targets.
  let inspected = 0;
  for (const row of newRows) {
    if (++inspected > 30 || Date.now()+20_000 > deadline) break;
    const proofs: NonNullable<Awaited<ReturnType<typeof verifyPage>>>[] = [];
    const urls = [...new Set(snapshot.rows.filter(page=>page.keyword === row.keyword).map(page=>page.url))].slice(0,3);
    for (const url of urls) {
      if (Date.now()+20_000 > deadline) break;
      const verified = await verifyPage(site,row.keyword,url);
      if (verified && !proofs.some(page=>page.url === verified.url)) proofs.push(verified);
    }
    const proof = proofs[0]; if (!proof) continue;
    await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${site}`}))`;
      const keyword = await tx.keyword.findUnique({where:{text:row.keyword}}); if (!keyword) return;
      const changed = await tx.siteKeyword.updateMany({where:{siteDomain:site,keywordId:keyword.id,active:true,pool:"RESEARCH",curationId:null,reviewStatus:"UNREVIEWED"},
        data:{pool:"FORMAL",mappingStatus:"READY",targetUrls:proofs.map(page=>page.url),reviewStatus:"DISCOVERY_PAGE_CONFIRMED",auditReason:"业务相关新词，当前公开页面标题或 H1 精确覆盖该搜索词，HTTP 200 且无收录禁止指令。"}});
      if (!changed.count) return;
      const snapshot = {keywordId:keyword.id,keyword:row.keyword,verdict:"VERIFIED",pageUrl:proof.url,canonicalUrl:proof.url,httpStatus:200,checkedAt:proof.checkedAt,
        reason:"DataForSEO 发现后重新访问本站页面，标题或 H1 精确覆盖业务词，保留真实页面证据。",evidence:{title:proof.title,h1:proof.h1},
        additionalPages:proofs.slice(1).map(page=>({pageUrl:page.url,canonicalUrl:page.url,httpStatus:200,checkedAt:page.checkedAt,reason:"逐页检查标题或 H1 精确覆盖该业务词，返回 HTTP 200，独立保留匹配证据。",evidence:{title:page.title,h1:page.h1}}))};
      await tx.keywordSourceRow.upsert({where:{siteDomain_sourceId_rowKey:{siteDomain:site,sourceId:"page_audit",rowKey:`keyword:${keyword.id}`}},
        create:{siteDomain:site,sourceId:"page_audit",rowKey:`keyword:${keyword.id}`,snapshot:json(snapshot),snapshotHash:createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),observedAt:new Date(proof.checkedAt)},
        update:{}});
    });
  }
  await prisma.dataForSeoRun.update({where:{requestId},data:{status:"COMPLETED",completedAt:new Date(),summary:json({...plan.summary,newResearchWords:newRows.length})}});
  return true;
}

/** One resumable market per worker pass. A paid POST is never retried. */
export async function runKeywordDiscoveryCycle(options: { deadline?: number; now?: Date; periodKey?: string } = {}) {
  const now = options.now ?? new Date(), plan = keywordCyclePlan(now, options.periodKey), deadline = options.deadline ?? Date.now()+210000;
  if (!enabled()) return {status:"DISABLED",ready:false,paidRequests:0};
  const config = await prisma.serpMonitorConfig.findUnique({where:{id:SERP_CONFIG_ID}});
  if (!config?.paidEnabled || config.authorizationVersion !== 1) return {status:"DISABLED",ready:false,paidRequests:0};
  const connection = await prisma.dataForSeoConnection.findUnique({where:{siteDomain:"flatkey.ai"}});
  if (!connection?.scheduleEnabled) return {status:"DISABLED",ready:false,paidRequests:0};
  const existing = await prisma.dataForSeoRun.findMany({where:{requestId:{in:plan.jobs.map(job=>job.requestId)}}});
  const unresolved = await prisma.dataForSeoRun.findFirst({where:{requestId:{startsWith:"discovery-",notIn:plan.jobs.map(job=>job.requestId)},status:{in:["PENDING","UNKNOWN","RECEIVED","IMPORT_FAILED"]}},select:{requestId:true}});
  if (unresolved) return {status:"NEEDS_REVIEW",ready:false,paidRequests:0,requestId:unresolved.requestId};
  const earlyAllowed = options.periodKey && config.nextDueAt?.toISOString() === plan.period.dueAt && Date.parse(plan.period.dueAt) - now.getTime() <= 86400000;
  if (!existing.length && !plan.mayStart && !earlyAllowed) return {status:"NOT_DUE",ready:false,paidRequests:0};
  const job = plan.jobs.find(job=>existing.find(row=>row.requestId===job.requestId)?.status !== "COMPLETED");
  if (!job) return {status:"COMPLETE",ready:true,paidRequests:0};
  let run = existing.find(row=>row.requestId===job.requestId), paidRequests = 0;
  if (run && !["RECEIVED","IMPORT_FAILED"].includes(run.status)) return {status:"NEEDS_REVIEW",ready:false,paidRequests:0,requestId:job.requestId};
  if (!run) {
    const cap = quoteForLimit(job.limit).maxCostMicros;
    const reserved = await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"dataforseo:discovery-budget"}))`;
      if (await tx.dataForSeoRun.findUnique({where:{requestId:job.requestId}})) return null;
      const used = await tx.dataForSeoRun.aggregate({where:{requestId:{startsWith:"discovery-"},createdAt:{gte:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1))}},_sum:{budgetCostMicros:true}});
      if ((used._sum.budgetCostMicros ?? 0)+cap>5_000_000) throw new Error("DISCOVERY_MONTH_BUDGET_EXCEEDED");
      return tx.dataForSeoRun.create({data:{requestId:job.requestId,siteDomain:job.targetDomain,status:"PENDING",requestHash:createHash("sha256").update(JSON.stringify(job.task)).digest("hex"),requestJson:json([job.task]),connectionVersion:connection.connectionVersion,estimatedCostMicros:cap,budgetCostMicros:cap}});
    });
    if (!reserved) return {status:"ACTIVE",ready:false,paidRequests:0};
    run = reserved;
    try {
      if (!enabled()) throw new Error("DISCOVERY_DISABLED_BEFORE_SUBMIT");
      const [live, liveConfig] = await Promise.all([prisma.dataForSeoConnection.findUnique({where:{siteDomain:"flatkey.ai"}}),prisma.serpMonitorConfig.findUnique({where:{id:SERP_CONFIG_ID}})]);
      if (!liveConfig?.paidEnabled || liveConfig.authorizationVersion !== 1 || !live?.scheduleEnabled || live.connectionVersion !== connection.connectionVersion || live.encryptedCredentials !== connection.encryptedCredentials) throw new Error("DISCOVERY_CONNECTION_CHANGED");
      const auth = decryptDataForSeoCredentials(live.encryptedCredentials);
      paidRequests=1;
      const response = await fetch(ENDPOINT,{method:"POST",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(30000),
        headers:{Authorization:`Basic ${Buffer.from(`${auth.apiLogin}:${auth.apiPassword}`).toString("base64")}`,"Content-Type":"application/json"},body:JSON.stringify([job.task])});
      const rawResponse = await response.text();
      run = await prisma.dataForSeoRun.update({where:{requestId:job.requestId},data:{rawResponse,collectedAt:new Date(),status:"RECEIVED"}});
    } catch {
      await prisma.dataForSeoRun.update({where:{requestId:job.requestId},data:{status:"UNKNOWN",errorCode:"DISCOVERY_RESPONSE_UNCONFIRMED"}});
      return {status:"NEEDS_REVIEW",ready:false,paidRequests,requestId:job.requestId};
    }
  }
  try {
    const snapshot = normalizeRankedKeywords(JSON.parse(run.rawResponse!),{runId:job.requestId,collectedAt:run.collectedAt!.toISOString(),limit:job.limit,scope:job});
    if (snapshot.actualCostMicros == null || snapshot.costWithinEstimate !== true) throw new Error("DISCOVERY_COST_UNCONFIRMED");
    await prisma.dataForSeoRun.update({where:{requestId:job.requestId},data:{normalized:json(snapshot),actualCostMicros:snapshot.actualCostMicros}});
    const done = await applyDiscovery(snapshot,job.requestId,deadline);
    return {status:"ACTIVE",ready:done && existing.filter(row=>row.status === "COMPLETED").length === plan.jobs.length-1,paidRequests,requestId:job.requestId};
  } catch {
    await prisma.dataForSeoRun.update({where:{requestId:job.requestId},data:{status:"IMPORT_FAILED",errorCode:"DISCOVERY_CACHED_RESULT_REQUIRES_REVIEW"}});
    return {status:"NEEDS_REVIEW",ready:false,paidRequests,requestId:job.requestId};
  }
}
