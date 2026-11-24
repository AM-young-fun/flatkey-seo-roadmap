import type { GrowthObservation } from "./growth-strategy";
import type { WorkflowSnapshot, WorkflowHistoricalImport } from "./seo-workflow";

export type DueGrowthObservation = {
  publicationId: string; taskId: string; contentVersion: string; pageUrl: string;
  checkpoint: 7 | 14 | 28; dueDay: string | null; timezone: string | null; reason: string;
};
export type HistoricalDueGrowthObservation = DueGrowthObservation & {
  archiveId: string; sourceTaskId: string; sourceVerification: WorkflowHistoricalImport["publications"][number]["verificationState"];
  country: string | null; language: string; publishedAt: string;
  writeMode: "original_daily_run_only" | "linked_task_evidence_and_daily_run";
  evidenceTaskId: string | null; recordObservationAllowed: false;
  provenance: { archiveId: string; publicationId: string; sourceTaskId: string }[];
};
const kinds = new Set(["source_blog", "translation", "backfill_translation", "landing", "cluster", "optimization"]);
const checkpoints = [7, 14, 28] as const;
const shift = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
function allowed(site: string, pageUrl: string) {
  try {
    const url = new URL(pageUrl);
    return ["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(site) && url.protocol === "https:" && !url.username && !url.password && !url.port
      && [site, "www." + site].includes(url.hostname) && !/^\/(?:api|console|router|admin)(?:\/|$)/.test(url.pathname)
      && (!/\/blog(?:\/|$)/.test(url.pathname) || site !== "rackrate.org");
  } catch { return false; }
}
function windowFor(publishedAt: string, checkpoint: number, timezone: string | null, now: Date) {
  if (!timezone || !Number.isFinite(Date.parse(publishedAt))) return { dueDay: null, timezone: null };
  try {
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }), today = format.format(now);
    const dueDay = shift(format.format(new Date(publishedAt)), checkpoint);
    return dueDay < today ? { dueDay, timezone } : undefined;
  } catch { return { dueDay: null, timezone: null }; }
}
/** Historical import rows remain immutable sources. A missing writable original
 * task is exposed in a separate inventory; it never becomes a fabricated task
 * or authority to call record_observation. */
export function growthDueObservationInventory(workflow: Pick<WorkflowSnapshot, "publications" | "historicalImports" | "tasks">,
  observations: GrowthObservation[], sourceTimezones: Record<string, string | null>, now = new Date()) {
  const modern = workflow.publications.filter(publication => publication.status === "verified" && kinds.has(publication.kind) && allowed(publication.siteDomain, publication.pageUrl));
  const dueObservations = modern.flatMap<DueGrowthObservation>(publication => checkpoints.flatMap(checkpoint => {
    const window = windowFor(publication.publishedAt, checkpoint, sourceTimezones[publication.siteDomain], now);
    if (!window) return [];
    const complete = observations.some(row => row.publicationId === publication.id && row.taskId === publication.taskId && row.contentVersion === publication.contentVersion && row.checkpoint === checkpoint
      && row.coverage?.indexing === "verified" && row.coverage.ranking === "verified" && row.coverage.traffic === "verified" && ["complete", "new_page"].includes(row.comparison?.status ?? ""));
    if (complete && window.timezone) return [];
    return [{ publicationId: publication.id, taskId: publication.taskId, contentVersion: publication.contentVersion, pageUrl: publication.pageUrl, checkpoint, ...window,
      reason: window.timezone ? "沿原窗口分别补收录、原词原市场排名、等长前后完整日的页面自然流量比较" : "来源时区或实际上线日未核定，保留待补" }];
  }));
  const archiveSources = new Map<string, { archive: WorkflowHistoricalImport; publication: WorkflowHistoricalImport["publications"][number]; provenance: HistoricalDueGrowthObservation["provenance"] }>();
  let archivedRows = 0, excludedArchiveRows = 0;
  for (const archive of [...(workflow.historicalImports ?? [])].sort((a, b) => a.id.localeCompare(b.id))) for (const publication of archive.publications) {
    archivedRows++;
    if (!allowed(archive.siteDomain, publication.pageUrl) || !kinds.has(publication.kind)) { excludedArchiveRows++; continue; }
    const key = JSON.stringify([archive.siteDomain, publication.pageUrl, publication.language, publication.contentVersion, publication.publishedAt]);
    const provenance = { archiveId: archive.id, publicationId: publication.id, sourceTaskId: publication.sourceTaskId };
    const saved = archiveSources.get(key);
    if (saved) { saved.provenance.push(provenance); continue; }
    archiveSources.set(key, { archive, publication, provenance: [provenance] });
  }
  const historicalDueObservations = [...archiveSources.values()].flatMap<HistoricalDueGrowthObservation>(({ archive, publication, provenance }) => {
    // Only a real same-CMS, exact-page version chain can carry evidence on a
    // later task. Its market never replaces the historical source's scope.
    const linked = workflow.publications.find(row => row.kind === "optimization" && ["published", "verified"].includes(row.status)
      && row.siteDomain === archive.siteDomain && row.pageUrl === publication.pageUrl && row.language === publication.language
      && row.automaticWrite?.operation === "update" && row.automaticWrite.sourceId === publication.cmsId && row.automaticWrite.baseContentVersion === publication.contentVersion
      && workflow.tasks.some(task => task.id === row.taskId && !task.deletedAt && task.channel !== "product" && task.siteDomain === archive.siteDomain && task.pageUrl === publication.pageUrl));
    return checkpoints.flatMap(checkpoint => {
      const window = windowFor(publication.publishedAt, checkpoint, sourceTimezones[archive.siteDomain], now);
      if (!window) return [];
      return [{ publicationId: publication.id, taskId: publication.sourceTaskId, sourceTaskId: publication.sourceTaskId, archiveId: archive.id,
        contentVersion: publication.contentVersion, pageUrl: publication.pageUrl, publishedAt: publication.publishedAt, country: publication.country, language: publication.language,
        sourceVerification: publication.verificationState, checkpoint, ...window, provenance,
        writeMode: linked ? "linked_task_evidence_and_daily_run" : "original_daily_run_only", evidenceTaskId: linked?.taskId ?? null, recordObservationAllowed: false,
        reason: !window.timezone ? "历史来源时区或实际上线日未核定，沿原每日run保留待补，不创建替代任务"
          : linked ? "历史版本由真实同CMS/原页面更新链承接；复用原任务证据和每日run，保留原历史市场及首次发布窗口"
            : "历史源发布到期；先复用原每日run回执，原sourceTask不可写时仅留原run，不伪造taskId或重复交付" }];
    });
  });
  return { dueObservations, historicalDueObservations, effectReviewCoverage: { verifiedPublicationsScanned: modern.length, historicalPublicationRowsScanned: archivedRows,
    uniqueHistoricalPublications: archiveSources.size, duplicateHistoricalRows: archivedRows - excludedArchiveRows - archiveSources.size, excludedArchiveRows,
    modernDueWindows: dueObservations.length, historicalDueWindows: historicalDueObservations.length,
    historicalCompletionPolicy: "reuse_exact_original_daily_run_receipts_no_new_task_or_publication_authority" as const } };
}

