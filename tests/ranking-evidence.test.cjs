const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);

const { buildRankingEvidence, latestQueryEvidence, rankingDataDate, rankingReportingPeriod, labsReportingPeriod } = require("../src/lib/ranking-evidence.ts");
const row = (overrides = {}) => ({
  keywordId: "claude", siteDomain: "flatkey.ai", region: "US", source: "gsc", rank: 12.4,
  rankStatus: "ranked", rankReported: true, clicks: 3, impressions: 120, ctr: 0.025,
  url: null, periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-12"),
  collectedAt: new Date("2026-10-13T02:30:00Z"), importedAt: new Date("2026-10-13T02:35:00Z"),
  dataUpdatedAt: null, ...overrides,
});

test("new source-local no_data supersedes an old GSC rank without implying outside top100", () => {
  const evidence = buildRankingEvidence([
    row(), row({ rank: null, rankStatus: "no_data", periodEnd: new Date("2026-10-13"), collectedAt: new Date("2026-10-14T02:30:00Z") }),
  ], []);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].rank, null);
  assert.equal(evidence[0].rankStatus, "no_data");
  assert.equal(evidence[0].serpVerification, "unverified");
  assert.equal(latestQueryEvidence(evidence).rank, null);
});

test("collecting an older report today cannot replace fresher source data", () => {
  const evidence = buildRankingEvidence([
    row(), row({ rank: 1, periodEnd: new Date("2026-09-30"), collectedAt: new Date("2026-10-15T02:30:00Z") }),
  ], []);
  assert.equal(evidence[0].rank, 12.4);
  assert.equal(evidence[0].dataDate, "2026-10-12");
});

test("snapshot dataUpdatedAt precedes collection time and corrections use import time", () => {
  const base = row({ source: "ahrefs", periodStart: null, periodEnd: null, dataUpdatedAt: new Date("2026-10-12T00:00:00Z"), rank: 18 });
  const stale = { ...base, rank: 2, dataUpdatedAt: new Date("2026-10-10T00:00:00Z"), collectedAt: new Date("2026-10-15T00:00:00Z") };
  const correction = { ...base, rank: 20, importedAt: new Date("2026-10-13T03:00:00Z") };
  const evidence = buildRankingEvidence([base, stale, correction], []);
  assert.equal(evidence[0].rank, 20);
  assert.equal(rankingDataDate(base), "2026-10-12T00:00:00.000Z");
});

test("GSC and Ahrefs stay separate and the legacy choice follows effective data date", () => {
  const gsc = row({ periodEnd: new Date("2026-10-13"), rank: 8.5 });
  const ahrefs = row({ source: "ahrefs", periodStart: null, periodEnd: null, rank: 40, dataUpdatedAt: new Date("2026-10-12T12:00:00Z"), collectedAt: new Date("2026-10-15T02:30:00Z") });
  const evidence = buildRankingEvidence([gsc, ahrefs], []);
  assert.deepEqual(evidence.map(value => [value.source, value.rank]), [["gsc", 8.5], ["ahrefs", 40]]);
  assert.equal(latestQueryEvidence(evidence).source, "gsc");
});

test("page evidence uses the same source and exact period, keeping each page's own average", () => {
  const page = row({ url: "https://flatkey.ai/claude", rank: 15.6, impressions: 45 });
  const evidence = buildRankingEvidence([row()], [
    page,
    row({ url: "https://flatkey.ai/wrong-start", periodStart: new Date("2026-09-01") }),
    row({ url: "https://flatkey.ai/old", periodEnd: new Date("2026-10-11") }),
    row({ source: "ahrefs", url: "https://flatkey.ai/other-source", rank: 7 }),
  ]);
  const gsc = evidence.find(value => value.source === "gsc");
  assert.equal(gsc.rank, 12.4);
  assert.equal(gsc.clicks, 3);
  assert.equal(gsc.impressions, 120);
  assert.equal(gsc.pages.length, 1);
  assert.equal(gsc.pages[0].url, "https://flatkey.ai/claude");
  assert.equal(gsc.pages[0].rank, 15.6);
  assert.equal(gsc.pages[0].impressions, 45);
  assert.equal(gsc.url, null);
});

test("a pages-only report is visible but never becomes a query ranking", () => {
  const evidence = buildRankingEvidence([], [row({ url: "https://flatkey.ai/claude", rank: 4.8 })]);
  assert.equal(evidence[0].scope, "pages");
  assert.equal(evidence[0].rank, null);
  assert.equal(evidence[0].pages[0].rank, 4.8);
  assert.equal(latestQueryEvidence(evidence), undefined);
});

test("a newer unmatched page report stays distinct from an older query report", () => {
  const evidence = buildRankingEvidence([row()], [row({ url: "https://flatkey.ai/claude", rank: 3.2, periodEnd: new Date("2026-10-13") })]);
  assert.deepEqual(evidence.map(value => [value.scope, value.rank, value.pages.length]), [["query", 12.4, 0], ["pages", null, 1]]);
  assert.equal(latestQueryEvidence(evidence).rank, 12.4);
});

test("volume-only observations do not clear rankings or create query evidence", () => {
  const evidence = buildRankingEvidence([row(), row({ rankReported: false, rank: null, periodEnd: new Date("2026-10-13") })], []);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].rank, 12.4);
});

test("Ahrefs pages without periods require the same snapshot data day", () => {
  const query = row({ source: "ahrefs", rank: 9, periodStart: null, periodEnd: null });
  const evidence = buildRankingEvidence([query], [
    { ...query, url: "https://flatkey.ai/current", rank: 12 },
    { ...query, url: "https://flatkey.ai/stale", rank: 3, collectedAt: new Date("2026-10-12T02:30:00Z") },
  ]);
  assert.deepEqual(evidence[0].pages.map(value => value.url), ["https://flatkey.ai/current"]);
});

const prismaMock = {};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: prismaMock } };
const { assembleDashboard, loadDashboard } = require("../src/lib/services/dashboard-data.ts");
const inventory = (siteDomain = "flatkey.ai") => ({
  id: "claude", text: "claude api", type: "MAIN", siteDomain, topicId: "topic", topicText: "Claude",
  topicTexts: [], parentId: null, parentIds: [], origin: "DISCOVERED", targetUrls: [], defaultVolume: 0, lastSyncedAt: null,
});

test("dashboard assembly returns source evidence per site and region with raw GSC metrics", () => {
  const data = assembleDashboard("all", [], [inventory(), inventory("rackrate.org")], [
    row(), row({ source: "ahrefs", rank: 45 }),
    row({ siteDomain: "rackrate.org", region: "JP", rank: null, rankStatus: "no_data" }),
  ], [], null, null, [row({ url: "https://flatkey.ai/claude", rank: 18.2 })], null, "combined");
  const flatkey = data.keywords[0];
  assert.equal(flatkey.rankingEvidence.US.length, 2);
  assert.equal(flatkey.rankingEvidence.US.find(value => value.source === "gsc").impressions, 120);
  assert.equal(flatkey.rankingEvidence.US.find(value => value.source === "gsc").pages[0].rank, 18.2);
  assert.equal(flatkey.rankingEvidence.JP.length, 0);
  assert.equal(flatkey.latestRanks.US.serpVerification, "unverified");
  assert.equal(data.keywords[1].latestRanks.US, null);
  assert.equal(data.keywords[1].latestRanks.JP.rankStatus, "no_data");
});

test("dashboard preserves pages-only evidence without inventing latestRanks", () => {
  const data = assembleDashboard("flatkey.ai", [], [inventory()], [], [], null, null, [row({ url: "https://flatkey.ai/claude", rank: 5 })]);
  assert.equal(data.keywords[0].latestRanks.US, null);
  assert.equal(data.keywords[0].rankingEvidence.US[0].pages[0].rank, 5);
  assert.equal(data.keywords[0].lastSyncedAt, "2026-10-13T02:30:00.000Z");
});

test("rolling reporting week uses seven complete Shanghai dates and excludes today", () => {
  assert.deepEqual(rankingReportingPeriod(new Date("2026-10-14T16:00:00Z")), {
    start:"2026-10-08",end:"2026-10-14",label:"最近一周 · 2026-10-08 至 2026-10-14",
  });
  assert.equal(rankingReportingPeriod(new Date("2026-10-14T15:59:59Z")).end,"2026-10-13");
});

const week = rankingReportingPeriod(new Date("2026-10-15T02:30:00Z"));
test("weekly GSC evidence accepts only the exact period, never a newer 28-day report", () => {
  const weekly = row({periodStart:new Date(week.start),periodEnd:new Date(week.end),rank:15.5});
  const longReport = row({periodStart:new Date("2026-09-17"),periodEnd:new Date(week.end),rank:1,collectedAt:new Date("2026-10-15T06:00:00Z")});
  const evidence = buildRankingEvidence([weekly,longReport],[],week);
  assert.equal(evidence.length,1);
  assert.equal(evidence[0].rank,15.5);
  assert.deepEqual(buildRankingEvidence([longReport],[],week),[]);
});

test("weekly Ahrefs snapshots need an explicit upstream data date inside the reporting week", () => {
  const base = row({source:"ahrefs",periodStart:null,periodEnd:null,collectedAt:new Date("2026-10-15T02:30:00Z")});
  assert.deepEqual(buildRankingEvidence([base],[],week),[]);
  assert.deepEqual(buildRankingEvidence([{...base,dataUpdatedAt:new Date("2026-10-01T02:30:00Z")}],[],week),[]);
  assert.deepEqual(buildRankingEvidence([{...base,dataUpdatedAt:new Date("2026-10-14T16:00:00Z")}],[],week),[]);
  const evidence = buildRankingEvidence([{...base,dataUpdatedAt:new Date("2026-10-14T15:59:59Z")}],[],week);
  assert.equal(evidence[0].source,"ahrefs");
});

test("daily GSC data is kept as actual daily records without inventing a weekly rank", () => {
  const daily = row({periodStart:new Date("2026-10-12"),periodEnd:new Date("2026-10-12"),rank:6.3});
  const page = {...daily,url:"https://flatkey.ai/claude",rank:19.1,impressions:7};
  const evidence = buildRankingEvidence([daily],[page],week);
  assert.equal(evidence[0].scope,"daily");
  assert.equal(evidence[0].rank,null);
  assert.equal(evidence[0].daily[0].date,"2026-10-12");
  assert.equal(evidence[0].daily[0].rank,6.3);
  assert.equal(evidence[0].daily[0].pages[0].rank,19.1);
  assert.equal(latestQueryEvidence(evidence),undefined);
  const data = assembleDashboard("flatkey.ai",[],[inventory()],[daily],[],null,null,[page],week);
  assert.equal(data.keywords[0].latestRanks.US,null);
  assert.deepEqual(data.reportingPeriod,week);
});

test("weekly evidence includes corrected daily rows and never carries data into unobserved days", () => {
  const weekly = row({periodStart:new Date(week.start),periodEnd:new Date(week.end),rank:15.5});
  const daily = row({periodStart:new Date("2026-10-12"),periodEnd:new Date("2026-10-12"),rank:6.3});
  const correction = {...daily,rank:null,rankStatus:"no_data",importedAt:new Date("2026-10-15T02:35:00Z")};
  const evidence = buildRankingEvidence([weekly,daily,correction],[],week);
  assert.equal(evidence[0].scope,"query");
  assert.equal(evidence[0].rank,15.5);
  assert.equal(evidence[0].daily.length,1);
  assert.equal(evidence[0].daily[0].rankStatus,"no_data");
});

test("an Ahrefs page from a later upstream snapshot stays separate even if report period matches", () => {
  const query = row({source:"ahrefs",rank:10,dataUpdatedAt:new Date("2026-10-12T02:00:00Z")});
  const page = {...query,url:"https://flatkey.ai/claude",rank:20,dataUpdatedAt:new Date("2026-10-13T02:00:00Z")};
  const evidence = buildRankingEvidence([query],[page],week);
  assert.deepEqual(evidence.map(value=>[value.scope,value.pages.length]),[["query",0],["pages",1]]);
});

const labsRow = (overrides = {}) => row({ source:"dataforseo_labs", captureId:"labs-capture", captureStatus:"COMPLETE", rank:12, rankStatus:"ranked", periodStart:null, periodEnd:null,
  url:"https://flatkey.ai/models/claude", clicks:null, impressions:null, ctr:null,
  collectedAt:new Date("2026-10-16T02:00:00Z"),dataUpdatedAt:new Date("2026-10-01T00:00:00Z"),...overrides });
test("Labs collection window includes today without rewriting its older real SERP date", () => {
  const period=labsReportingPeriod(new Date("2026-10-16T04:00:00Z"));
  assert.deepEqual([period.start,period.end],["2026-10-10","2026-10-16"]);
  const evidence=buildRankingEvidence([labsRow()],[],period)[0];
  assert.equal(evidence.rank,12);assert.equal(evidence.dataDate,"2026-10-01T00:00:00.000Z");
  assert.equal(evidence.checkedAt,"2026-10-16T02:00:00.000Z");assert.equal(evidence.serpVerification,"unverified");
  assert.equal(rankingDataDate(labsRow({dataUpdatedAt:null})),null);
});
test("a newer Labs no_data snapshot supersedes an old hit despite missing SERP date and never becomes outside", () => {
  const evidence=buildRankingEvidence([labsRow(),labsRow({rank:null,rankStatus:"no_data",url:null,dataUpdatedAt:null,collectedAt:new Date("2026-10-16T03:00:00Z")})],[]);
  assert.equal(evidence[0].rank,null);assert.equal(evidence[0].rankStatus,"no_data");assert.equal(evidence[0].dataDate,null);
});
test("default dashboard ranks only Labs while retaining raw GSC and Ahrefs history outside its collection week", async () => {
  const originalUrl=process.env.DATABASE_URL;process.env.DATABASE_URL="postgresql://unused.invalid/labs-test";
  const history=row({periodStart:new Date("2026-09-01"),periodEnd:new Date("2026-09-28"),rank:1.4});
  const jp=row({region:"JP",rank:2.6});let sql=[];
  Object.assign(prismaMock,{$queryRaw:async query=>{sql.push(query);if(query.sql.includes("dashboard:keywords"))return[inventory()];if(query.sql.includes("dashboard:ranks"))return[labsRow(),history,jp];return[];},rankingImport:{findFirst:async()=>null},syncRun:{findFirst:async()=>null}});
  try {
    const data=await loadDashboard("flatkey.ai",undefined,"week",new Date("2026-10-16T04:00:00Z"));const keyword=data.keywords[0];
    assert.equal(keyword.latestRanks.US.source,"dataforseo_labs");assert.equal(keyword.latestRanks.US.rank,12);
    assert.equal(keyword.latestRanks.JP,null);assert.equal(keyword.rankingEvidence.JP[0].source,"gsc");
    assert.equal(keyword.rankingEvidence.US.find(value=>value.source==="gsc").rank,1.4);
    assert.equal(keyword.rankingEvidence.US.find(value=>value.source==="gsc").periodEnd,"2026-09-28");
    assert.deepEqual([data.reportingPeriod.start,data.reportingPeriod.end],["2026-10-10","2026-10-16"]);
    const ranks=sql.find(query=>query.sql.includes("dashboard:ranks"));assert.ok(ranks.values.includes("dataforseo_labs"));
    assert.ok(ranks.sql.includes("o.source IN ('gsc','ahrefs')"));assert.ok(ranks.sql.includes('THEN o."collectedAt"'));
    assert.ok(ranks.sql.includes("capture.status = 'COMPLETE'"));
    assert.ok(!ranks.sql.includes('o.source = \'dataforseo_labs\' AND (o."collectedAt"'));
    const volumes=sql.find(query=>query.sql.includes("dashboard:volumes"));assert.ok(volumes.sql.includes("THEN NULL::timestamp"));assert.ok(volumes.sql.includes("capture.status = 'COMPLETE'"));
    assert.ok(!sql.some(query=>query.sql.includes("ranking-period:recent-query-reports")));
  } finally {if(originalUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=originalUrl;}
});

test("latest published Labs snapshot remains on days 8 and 13; the trend window never expires the main table", () => {
  for(const age of [8,13]) {
    const now=new Date(Date.parse("2026-10-16T04:00:00Z")+age*86400000),period=labsReportingPeriod(now);
    const data=assembleDashboard("flatkey.ai",[],[inventory()],[labsRow()],[],null,null,[],period);
    assert.equal(data.keywords[0].latestRanks.US.rank,12);
    assert.equal(data.keywords[0].latestRanks.US.checkedAt,"2026-10-16T02:00:00.000Z");
    const updated=labsRow({rank:null,rankStatus:"no_data",url:null,dataUpdatedAt:null,collectedAt:new Date("2026-10-17T02:00:00Z")});
    const changed=assembleDashboard("flatkey.ai",[],[inventory()],[labsRow(),updated],[],null,null,[],period);
    assert.equal(changed.keywords[0].latestRanks.US.rank,null);assert.equal(changed.keywords[0].latestRanks.US.rankStatus,"no_data");
  }
});
test("partial Labs captures stay invisible and complete multi-page evidence retains each page's real SERP date", () => {
  const query=labsRow();const sameBatch=[labsRow({url:"https://flatkey.ai/one",rank:12}),labsRow({url:"https://flatkey.ai/two",rank:25,dataUpdatedAt:new Date("2026-09-29T00:00:00Z")})];
  const pending=labsRow({captureStatus:"PARTIAL",rank:1,collectedAt:new Date("2026-10-17T02:00:00Z")});
  const evidence=buildRankingEvidence([query,pending],[...sameBatch,{...pending,url:"https://flatkey.ai/partial"}]);
  assert.equal(evidence[0].rank,12);assert.equal(evidence[0].pages.length,2);
  assert.deepEqual(evidence[0].pages.map(page=>page.dataUpdatedAt),["2026-10-01T00:00:00.000Z","2026-09-29T00:00:00.000Z"]);
  assert.deepEqual(buildRankingEvidence([{...pending,captureStatus:null}],[]),[]);
});
