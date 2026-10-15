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
const { assessKeywordVolume, reviewRegionalVolume } = require("../src/lib/keyword-volume-review.ts");
const now = new Date("2026-10-15T02:30:00Z");
const daysAgo = days => new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
const sample = (days, volume = 0) => ({ dataDate: daysAgo(days), volume });
const histories = samples => Object.fromEntries(["US", "JP", "ES", "BR"].map(region => [region, [...samples]]));
const input = overrides => ({
  text: "obsolete integration connector", siteDomain: "flatkey.ai", firstTrackedAt: daysAgo(120),
  histories: histories([sample(60), sample(30), sample(0)]), now, ...overrides,
});

test("fresh terms retain explicit zero volume and unknown volume remains distinct", () => {
  const fresh = assessKeywordVolume(input({ firstTrackedAt: daysAgo(10), histories: histories([sample(0)]) }));
  assert.equal(fresh.status, "new_term");
  assert.equal(fresh.isCandidate, false);
  assert.equal(fresh.regions.US.latestVolume, 0);
  const unknown = reviewRegionalVolume([{ volume: null, dataDate: daysAgo(0) }], now);
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.latestVolume, null);
  assert.equal(unknown.sampleCount, 0);
});

test("all four markets need three dated samples spanning sixty days before a review candidate", () => {
  const review = assessKeywordVolume(input());
  assert.equal(review.status, "candidate");
  assert.equal(review.isCandidate, true);
  assert.equal(review.regions.US.zeroSpanDays, 60);
  assert.equal(review.regions.US.zeroSamples, 3);
  assert.equal(review.regions.US.largestGapDays, 30);
  const incomplete = assessKeywordVolume(input({ histories: { US: input().histories.US } }));
  assert.equal(incomplete.status, "insufficient_evidence");
  assert.equal(incomplete.regions.JP.status, "unknown");
});

test("stale samples, long gaps and missing firstTrackedAt cannot become candidates", () => {
  const stale = assessKeywordVolume(input({ histories: histories([sample(120), sample(90), sample(60)]) }));
  assert.equal(stale.regions.US.status, "stale");
  assert.equal(stale.isCandidate, false);
  const gaps = assessKeywordVolume(input({ histories: histories([sample(120), sample(60), sample(0)]) }));
  assert.equal(gaps.regions.US.largestGapDays, 60);
  assert.equal(gaps.isCandidate, false);
  assert.equal(assessKeywordVolume(input({ firstTrackedAt: null })).isCandidate, false);
});

test("positive demand in any market protects and resets the zero history", () => {
  const values = input().histories;
  values.JP = [sample(120), sample(90, 10), sample(60), sample(30), sample(0)];
  const review = assessKeywordVolume(input({ histories: values }));
  assert.equal(review.status, "protected");
  assert.equal(review.regions.JP.lastPositiveDate, daysAgo(90));
  assert.equal(review.regions.JP.zeroSamples, 3);
  assert.equal(review.regions.JP.zeroSpanDays, 60);
  assert.equal(review.regions.JP.isSustainedZero, false);
  assert.equal(assessKeywordVolume(input({ marketVolumes: { BR: 1 } })).status, "protected");
  assert.equal(reviewRegionalVolume([{ volume: 10, dataDate: null }], now).hasPositiveVolume, true);
});

test("undated Ahrefs zeros and repeated reads of one upstream data day prove no duration", () => {
  const undated = assessKeywordVolume(input({ histories: histories([{ volume: 0, dataDate: null }, { volume: 0, dataDate: null }, { volume: 0, dataDate: null }]) }));
  assert.equal(undated.regions.US.status, "unknown");
  assert.equal(undated.isCandidate, false);
  const repeated = reviewRegionalVolume([sample(0), sample(0), sample(0)], now);
  assert.equal(repeated.sampleCount, 1);
  assert.equal(repeated.isSustainedZero, false);
});

test("new model names and model target-page context retain zero-volume terms", () => {
  assert.equal(assessKeywordVolume(input({ text: "gpt-6 api" })).status, "protected");
  assert.equal(assessKeywordVolume(input({ text: "nova 2 api", targetUrls: ["https://flatkey.ai/models/nova-2"] })).status, "protected");
  assert.equal(assessKeywordVolume(input({ topicTexts: ["新发布模型"] })).status, "protected");
});

test("manual restoration adds a sixty-day observation window without changing the site's real first-tracked age", () => {
  const recent = assessKeywordVolume(input({ restoredAt: daysAgo(1) }));
  assert.equal(recent.status, "new_term");
  assert.equal(recent.trackedDays, 120);
  assert.match(recent.reasons[0], /人工恢复/);
  assert.equal(assessKeywordVolume(input({ restoredAt: daysAgo(60) })).isCandidate, true);
});

const report = overrides => ({ source: "gsc", scope: "query", rank: null, rankStatus: "no_data", clicks: 0, impressions: 0,
  ctr: null, url: null, periodStart: daysAgo(30), periodEnd: daysAgo(0), dataDate: daysAgo(0), checkedAt: now.toISOString(),
  dataUpdatedAt: null, importedAt: now.toISOString(), serpVerification: "unverified", pages: [], ...overrides });

test("real search activity, historical protection and actual valid pages retain demand", () => {
  assert.equal(assessKeywordVolume(input({ rankingEvidence: { US: [report({ impressions: 1 })] } })).status, "protected");
  assert.equal(assessKeywordVolume(input({ hasSearchActivity: true })).status, "protected");
  assert.equal(assessKeywordVolume(input({ hasObservedPage: true })).status, "protected");
  const page = { url: "https://flatkey.ai/connector", rank: 50, clicks: 0, impressions: 0 };
  assert.equal(assessKeywordVolume(input({ rankingEvidence: { US: [report({ pages: [page] })] } })).status, "protected");
  const foreign = { ...page, url: "https://flatkey.ai.evil.example/connector" };
  assert.equal(assessKeywordVolume(input({ rankingEvidence: { US: [report({ pages: [foreign] })] } })).status, "candidate");
});
