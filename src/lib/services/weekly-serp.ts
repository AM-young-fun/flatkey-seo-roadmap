import { prisma } from "@/lib/prisma";
import { buildSerpKeywordResults, serpTaskPeriod, type SerpKeywordResult } from "@/lib/serp-results";
import { loadSerpTasks } from "@/lib/services/serp-results";
import { loadSerpTargetCohort } from "@/lib/services/serp-targets";
import { REGION_CODES } from "@/lib/seo";
import { serpPeriod } from "@/lib/serp-periods";
import { weeklyKeywordComparison, type WeeklyPageRank, type WeeklyRankingReport } from "@/lib/weekly-keyword-comparison";
import type { reportPeriods } from "@/lib/weekly-traffic";
import { timedRead } from "@/lib/read-profile";

const nextDay = (value: string) => new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
export async function loadWeeklySerp(periods: ReturnType<typeof reportPeriods>) {
  const publicationDay = nextDay(periods.current.end), previousPublicationDay = nextDay(periods.previous.end);
  const slot = serpPeriod(`${publicationDay}T02:30:00Z`), captureWeek = slot.start === publicationDay;
  const cohort = await timedRead("weekly.cohort", () => loadSerpTargetCohort());
  const previousSlot = serpPeriod(`${previousPublicationDay}T02:30:00Z`);
  const [run, previousRun] = await timedRead("weekly.run-metadata", () => Promise.all([slot,previousSlot].map(period=>prisma.serpMonitorRun.findUnique({where:{periodKey_scope:{periodKey:period.key,scope:"SCHEDULED"}}}))));
  const targets = new Map(cohort.targets.map(target=>[`${target.siteDomain}:${target.keywordId}`,target]));
  const addCohort = (saved: {cohortJson: unknown} | null) => { for (const item of Array.isArray(saved?.cohortJson) ? saved.cohortJson : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (typeof item.keywordId === "string" && typeof item.keyword === "string" && typeof item.siteDomain === "string" && ["flatkey.ai","rackrate.org","modelfit.cc"].includes(item.siteDomain))
      targets.set(`${item.siteDomain}:${item.keywordId}`,{keywordId:item.keywordId,keyword:item.keyword,siteDomain:item.siteDomain,targetUrls:Array.isArray(item.targetUrls)?item.targetUrls.filter((value:unknown):value is string=>typeof value === "string"):[]});
  } };
  addCohort(run); addCohort(previousRun);
  const [currentTasks, weeklyPreviousTasks] = await Promise.all([
    loadSerpTasks("all", undefined, undefined, periods.current.start, publicationDay, run?.id),
    loadSerpTasks("all", undefined, undefined, periods.previous.start, previousPublicationDay, previousRun?.id),
  ]);
  let previousTasks = weeklyPreviousTasks;
  let comparisonReference: {kind:"FIRST_ISSUE"; label:string; checkedAt:string | null; capturedKeywords:number} | null = null;
  const valid = (item:SerpKeywordResult) => item.status === "RANKED" || item.status === "OUTSIDE_TOP100";
  if (captureWeek && run && !REGION_CODES.some(region => buildSerpKeywordResults([...targets.values()], previousTasks.filter(task=>task.region === region)).some(valid))) {
    // The previous traffic week can predate our first SERP check. Reuse the
    // first completed issue as requested, without relabeling its capture date
    // or mixing it with this issue's receipts.
    const firstRun = await prisma.serpMonitorRun.findFirst({where:{status:"COMPLETED", id:{not:run.id},
      createdAt:{lt:run.createdAt}, tasks:{some:{region:{in:[...REGION_CODES]}, state:"COMPLETE"}}},orderBy:[{createdAt:"asc"},{id:"asc"}]});
    if (firstRun) {
      addCohort(firstRun);
      const firstTasks = (await loadSerpTasks("all",undefined,undefined,firstRun.periodStart.toISOString().slice(0,10),publicationDay,firstRun.id)).filter(task=>task.runId === firstRun.id);
      const firstItems = REGION_CODES.flatMap(region=>buildSerpKeywordResults([...targets.values()],firstTasks.filter(task=>task.region === region)));
      if (firstItems.some(valid)) {
        previousTasks = firstTasks;
        comparisonReference = {kind:"FIRST_ISSUE",label:(firstTasks[0] && serpTaskPeriod(firstTasks[0])?.label) ?? firstRun.periodLabel,
          checkedAt:firstItems.flatMap(item=>item.checkedAt && item.captureComplete ? [item.checkedAt] : []).sort().at(-1) ?? null,
          capturedKeywords:new Set(firstItems.filter(item=>item.captureComplete).map(item=>item.keyword.normalize("NFKC").toLowerCase().trim())).size};
      }
    }
  }
  const markets = REGION_CODES.map(region => ({ region,
    current: buildSerpKeywordResults([...targets.values()], currentTasks.filter(task => task.region === region),{currentRunId:run?.id}),
    previous: buildSerpKeywordResults([...targets.values()], previousTasks.filter(task => task.region === region)),
  }));
  const reports: WeeklyRankingReport[] = [], pages: WeeklyPageRank[] = [], eligible = new Set<string>();
  const capturedWords = new Set<string>(), dates: string[] = [];
  let hadPrevious = false, fresh = false;
  const add = (items: SerpKeywordResult[], region: string, day: string) => {
    for (const siteDomain of ["flatkey.ai", "rackrate.org", "modelfit.cc"]) {
      const ranked = items.filter(item => item.siteDomain === siteDomain && (item.status === "RANKED" || item.status === "OUTSIDE_TOP100"));
      if (!items.some(item=>item.siteDomain === siteDomain && item.captureComplete)) continue;
      reports.push({ siteDomain, region, source: "dataforseo_serp", date: new Date(day), rankings: ranked.map(item => ({ keyword: item.keyword, rank: item.rank ?? 101 })) });
      for (const item of items.filter(item => item.siteDomain === siteDomain)) eligible.add(`${siteDomain}:${region}:${item.keyword.toLowerCase()}`);
      for (const item of ranked) for (const page of item.pages) pages.push({ siteDomain, region, source: "dataforseo_serp", date: day, keyword: item.keyword, url: page.url, rank: page.rankGroup });
    }
  };
  for (const market of markets) {
    hadPrevious ||= market.previous.some(item => item.status === "RANKED" || item.status === "OUTSIDE_TOP100");
    for (const item of market.current) if (item.captureComplete && item.checkedAt) {
      dates.push(item.checkedAt); capturedWords.add(item.keyword.normalize("NFKC").toLowerCase().trim());
      fresh ||= new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai"}).format(new Date(item.checkedAt)) >= periods.current.start;
    }
    add(market.current, market.region, periods.current.end); add(market.previous, market.region, periods.previous.end);
  }
  const waiting = Boolean(run && ["PLANNED", "RUNNING", "UNKNOWN"].includes(run.status));
  const noNewCapture = !fresh || (!captureWeek && hadPrevious);
  const hasResults = dates.length > 0;
  const currentValid = new Map<string, SerpKeywordResult>(markets.flatMap(market=>market.current.filter(item=>item.status === "RANKED" || item.status === "OUTSIDE_TOP100")
    .map(item=>[`${item.siteDomain}:${market.region}:${item.keyword.toLowerCase()}`,item] as const)));
  const previousRanked = markets.flatMap(market=>market.previous.filter(item=>item.status === "RANKED").map(item=>({item,region:market.region})));
  const beforeWords = new Set(previousRanked.map(({item})=>item.keyword.toLowerCase()));
  const afterWords = new Set(markets.flatMap(market=>market.current.filter(item=>item.status === "RANKED").map(item=>item.keyword.toLowerCase())));
  const missingWords = [...beforeWords].filter(word=>!afterWords.has(word));
  const confirmedLosses = missingWords.filter(word=>previousRanked.filter(({item})=>item.keyword.toLowerCase() === word)
    .every(({item,region})=>currentValid.get(`${item.siteDomain}:${region}:${word}`)?.status === "OUTSIDE_TOP100"));
  const safePages = pages.filter(page=>page.date === periods.current.end || currentValid.has(`${page.siteDomain}:${page.region}:${page.keyword.toLowerCase()}`));
  const comparison = hasResults && !waiting ? weeklyKeywordComparison(reports, eligible, periods.previous.end, periods.current.end, safePages) : null;
  if (comparison) comparison.removed = confirmedLosses.length;
  return { comparison, ranking: { source: "dataforseo_serp", captureWeek, publicationDay, waiting, baseline: hasResults && !hadPrevious,
    noNewCapture, comparisonReference, unresolvedWords: missingWords.length-confirmedLosses.length, capturedKeywords: capturedWords.size, latestCheckedAt: dates.sort().at(-1) ?? null,
    status: waiting ? "WAITING" : !captureWeek ? "NOT_SCHEDULED" : run?.status === "COMPLETED" ? "READY" : run ? "FAILED" : "PAID_DISABLED",
    sampleOnly: hasResults && !run, nextCaptureAt: captureWeek ? slot.dueAt : serpPeriod(`${nextDay(slot.end)}T02:30:00Z`).dueAt } };
}
