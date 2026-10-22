import { prisma } from "@/lib/prisma";
import { settleReads } from "@/lib/database-read";
import { timedRead } from "@/lib/read-profile";
import { weeklyPeriods, activeReportPeriods, registrationRate, relativeChange } from "@/lib/weekly-traffic";
import { weeklyTrafficEvidence } from "@/lib/weekly-traffic-evidence";
import { weeklyReportDraftSchema } from "@/lib/weekly-report-draft";
import { weeklyEvidenceSchema } from "@/lib/weekly-evidence-schema";
import { auditedWeeklyDiagnosis } from "@/lib/weekly-audit-diagnosis";
import { diagnoseWeeklyReport } from "@/lib/weekly-report-diagnosis";
import { loadWeeklySerp } from "@/lib/services/weekly-serp";
import { comparableWeeklyCutoffs, reportingCutoff } from "@/lib/weekly-cutoff";

export async function buildWeeklyReport(periods: ReturnType<typeof weeklyPeriods>) {
  const domains = ["flatkey.ai", "rackrate.org", "modelfit.cc"];
  const archiveEvidence = weeklyTrafficEvidence(periods.current.start);
  const [weekly, weeks, serp, savedDraft] = await settleReads([
    timedRead("weekly.traffic", () => prisma.weeklyTraffic.findMany({ where: { siteDomain: { in: domains }, periodStart: { in: [new Date(periods.current.start), new Date(periods.previous.start)] } }, orderBy: [{ collectedAt: "desc" }, { importedAt: "desc" }] })),
    prisma.weeklyTraffic.findMany({ where: { siteDomain: { in: domains }, periodStart: { lte: new Date(weeklyPeriods().current.start) } }, distinct: ["periodStart"], select: { periodStart: true }, orderBy: { periodStart: "desc" } }),
    timedRead("weekly.serp", () => loadWeeklySerp(periods)),
    prisma.weeklyReportDraft.findUnique({where:{siteDomain_periodStart:{siteDomain:"flatkey.ai",periodStart:new Date(periods.current.start)}}}),
  ]);
  const parsedDraft=weeklyReportDraftSchema.safeParse(savedDraft?.payload);
  const preparedDraft=parsedDraft.success && !weekly.some(row=>row.siteDomain === "flatkey.ai" && row.periodStart.toISOString().slice(0,10) === periods.current.start) ? parsedDraft.data : null;
  const draft = archiveEvidence && !archiveEvidence.complete ? { siteDomain: "flatkey.ai", ...archiveEvidence.totals.current, periodStart: new Date(periods.current.start), periodEnd: new Date(periods.current.end), collectedAt: new Date(archiveEvidence.collectedAt), timezone: archiveEvidence.timezone, ga4PropertyId: archiveEvidence.propertyId, registrationMetric: "sign_up_success_distinct_users" } : null;
  const siteTraffic = domains.map(siteDomain=>({ siteDomain,
    current: weekly.find(row=>row.siteDomain===siteDomain && row.periodStart.toISOString().slice(0,10)===periods.current.start && row.periodEnd.toISOString().slice(0,10)===periods.current.end) ?? (siteDomain === "flatkey.ai" ? draft : null),
    previous: weekly.find(row=>row.siteDomain===siteDomain && row.periodStart.toISOString().slice(0,10)===periods.previous.start && row.periodEnd.toISOString().slice(0,10)===periods.previous.end) ?? null,
  }));
  const total = (period: "current"|"previous") => {
    const rows = siteTraffic.flatMap(site=>site[period] ? [site[period]!] : []);
    if (!rows.length) return null;
    const newUsers = rows.reduce((sum,row)=>sum+row.newUsers,0), newRegistrations=rows.reduce((sum,row)=>sum+row.newRegistrations,0);
    return {newUsers,newRegistrations,registrationRate:registrationRate(newUsers,newRegistrations),collectedAt:rows.map(row=>row.collectedAt.toISOString()).sort().at(-1),sites:rows.length,timezones:[...new Set(rows.map(row=>row.timezone))],registrationMetrics:[...new Set(rows.map(row=>row.registrationMetric))]};
  };
  const current=total("current"), previous=total("previous");
  const currentSites=siteTraffic.filter(site=>site.current).map(site=>site.siteDomain), previousSites=siteTraffic.filter(site=>site.previous).map(site=>site.siteDomain);
  const complete = Boolean(current) && (!draft || weekly.some(row=>row.siteDomain === "flatkey.ai" && row.periodStart.toISOString().slice(0,10) === periods.current.start));
  const flatkey = weekly.find(row=>row.siteDomain === "flatkey.ai" && row.periodStart.toISOString().slice(0,10) === periods.current.start);
  const parsedEvidence = weeklyEvidenceSchema.safeParse(flatkey?.analysis);
  // Page visitors have their own paired GA4 counts. A missing previous
  // registration/channel import must not hide the current page visitors.
  let pageVisitors = !preparedDraft && parsedEvidence.success && flatkey &&
    flatkey.periodEnd.toISOString().slice(0,10) === periods.current.end &&
    parsedEvidence.data.totals.current.newUsers === flatkey.newUsers &&
    parsedEvidence.data.totals.current.newRegistrations === flatkey.newRegistrations
      ? parsedEvidence.data.pageVisitors ?? null : null;
  const candidateEvidence = parsedEvidence.success && flatkey ? { ...parsedEvidence.data, siteDomain:"flatkey.ai", timezone:flatkey.timezone, propertyId:flatkey.ga4PropertyId ?? "", collectedAt:flatkey.collectedAt.toISOString() }
    : complete && archiveEvidence?.complete === false ? null : archiveEvidence;
  const flatkeyPrevious = siteTraffic.find(row=>row.siteDomain === "flatkey.ai")?.previous;
  const cutoff = !preparedDraft ? reportingCutoff(flatkey?.analysis) : null;
  const sameCutoff = comparableWeeklyCutoffs(flatkey?.analysis, flatkeyPrevious?.analysis);
  if (cutoff && !sameCutoff && pageVisitors) pageVisitors = {...pageVisitors,groups:pageVisitors.groups.map(group=>({...group,users:{...group.users,previous:null}}))};
  const evidence = preparedDraft?.evidence ?? (candidateEvidence && flatkey && flatkeyPrevious &&
    candidateEvidence.totals.current.newUsers === flatkey.newUsers && candidateEvidence.totals.current.newRegistrations === flatkey.newRegistrations &&
    candidateEvidence.totals.previous.newUsers === flatkeyPrevious.newUsers && candidateEvidence.totals.previous.newRegistrations === flatkeyPrevious.newRegistrations ? candidateEvidence : null);
  const comparable=Boolean(complete && current && previous && currentSites.join()===previousSites.join() && siteTraffic.every(site=>!site.current || (site.previous && site.current.timezone===site.previous.timezone && site.current.ga4PropertyId===site.previous.ga4PropertyId && site.current.registrationMetric===site.previous.registrationMetric && comparableWeeklyCutoffs("analysis" in site.current ? site.current.analysis : null,site.previous.analysis))));
  const movements = serp;
  const comparableRanks = movements.ranking.baseline || movements.ranking.noNewCapture || movements.ranking.waiting ? null : movements.comparison;
  const diagnosis = preparedDraft ? {significant:true,findings:preparedDraft.findings} : evidence?.codexSummary ? {significant:true,findings:evidence.codexSummary.findings} : evidence?.complete ? auditedWeeklyDiagnosis(evidence) : await diagnoseWeeklyReport({ current, previous, currentSites, previousSites, comparable, siteTraffic }, comparableRanks, periods.current.end);
  return {periods,evidence,pageVisitors,reportingCutoff:cutoff ? {...cutoff,collectedAt:flatkey!.collectedAt.toISOString(),comparable:sameCutoff}:null,draft:preparedDraft,history:[...new Set([activeReportPeriods().current.start,...weeks.map(row=>row.periodStart.toISOString().slice(0,10))])].sort().reverse(),
    traffic:{current,previous,complete,currentSites,previousSites,comparable,siteTraffic:siteTraffic.map(site=>({siteDomain:site.siteDomain,current:site.current ? {newUsers:site.current.newUsers,newRegistrations:site.current.newRegistrations,registrationRate:registrationRate(site.current.newUsers,site.current.newRegistrations)}:null})),changes:{
      newUsers:comparable?relativeChange(current!.newUsers,previous!.newUsers):null,newRegistrations:comparable?relativeChange(current!.newRegistrations,previous!.newRegistrations):null,
      registrationRate:comparable?relativeChange(current!.registrationRate,previous!.registrationRate):null,
      ratePoints:comparable && current!.registrationRate!==null && previous!.registrationRate!==null?(current!.registrationRate-previous!.registrationRate)*100:null,
    }},...movements,diagnosis,pages:[],
  };
}
