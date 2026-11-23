const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
const first = require("../src/lib/approved-keyword-review.ts"), other = require("../src/lib/approved-other-keyword-review.ts");
const { buildApprovedWeeklyKeywordCapture } = require("../src/lib/approved-weekly-keyword-capture.ts");
let snapshots, metadata, calls;
mock("src/lib/prisma.ts", { prisma: { serpMonitorRun: { findMany: async input => {
  calls.metadata++; assert.deepEqual(input.where.id.in, [first.RUN_ID, other.RUN_ID]);
  assert.deepEqual(Object.keys(input.select).sort(), ["id", "scope", "periodKey", "cohortHash", "targetCount", "queryCount", "estimatedCostMicros", "reservedCostMicros", "configJson"].sort());
  return structuredClone(metadata);
} } } });
mock("src/lib/services/approved-keyword-review.ts", { loadApprovedKeywordReview: async () => { calls.first++; return structuredClone(snapshots.first); } });
mock("src/lib/services/approved-other-keyword-review.ts", { loadApprovedOtherKeywordReview: async () => { calls.other++; return structuredClone(snapshots.other); } });
const { loadApprovedWeeklyKeywordCapture } = require("../src/lib/services/approved-weekly-keyword-capture.ts");
const window = { start: "2026-11-19", end: "2026-11-25" };
const checkedAt = "2026-11-23T03:30:00.000Z";
function receipt(query, sourceRunId, reused = false) {
  return { keywordId: query.keywordId, keyword: query.keyword, country: query.region, language: query.language, sourceRunId, reused,
    state: "COMPLETE", providerTaskId: `saved-${query.keywordId}`, checkedAt, captureComplete: true, queryStatus: "EXACT", rankingVerified: true,
    completeDepth: false, organicCount: 10, coveredThroughRank: 10, ranked: null, rank: null, pages: [] };
}
function snapshot(definition, plan, count, quoteId) {
  return { quoteId, runId: definition.RUN_ID, scope: definition === first ? definition.APPROVED_KEYWORD_REVIEW_SCOPE : definition.APPROVED_OTHER_KEYWORD_REVIEW_SCOPE,
    quoteSha256: definition === first ? definition.APPROVAL_QUOTE_SHA256 : definition.QUOTE_SHA256,
    approved: true, queryCount: count, maxCostMicros: definition.MAX_COST_MICROS,
    run: { status: "COMPLETED", completedAt: "2026-11-23T04:00:00.000Z", taskCounts: { COMPLETE: count } },
    items: plan.queries.map(query => receipt(query, definition.RUN_ID)) };
}
function meta(definition, plan, count, namespace) {
  return { id: definition.RUN_ID, periodKey: definition.PERIOD_KEY,
    scope: definition === first ? definition.APPROVED_KEYWORD_REVIEW_SCOPE : definition.APPROVED_OTHER_KEYWORD_REVIEW_SCOPE,
    cohortHash: plan.queryHash, targetCount: count, queryCount: count, estimatedCostMicros: definition.MAX_COST_MICROS, reservedCostMicros: definition.MAX_COST_MICROS,
    configJson: { connectionHash: "PRIVATE_CONNECTION_HASH_MUST_NOT_ESCAPE", [namespace]: {
      userApproved: true, quoteSha256: definition === first ? definition.APPROVAL_QUOTE_SHA256 : definition.QUOTE_SHA256, queryHash: plan.queryHash } } };
}
beforeEach(t => {
  calls = { first: 0, other: 0, metadata: 0 };
  const a = first.getApprovedKeywordReviewPlan(), b = other.getApprovedOtherKeywordReviewPlan();
  snapshots = { first: snapshot(first, a, 1031, "keyword-fee-review-20261123-v1"), other: snapshot(other, b, 467, "other-country-query-proposal-v2") };
  snapshots.other.totalKeywordCount = 468; snapshots.other.reuseCount = 1;
  const reused = receipt(b.reused[0], b.reused[0].sourceRunId, true);
  reused.checkedAt = b.reused[0].checkedAt; reused.rank = 15; reused.ranked = true;
  reused.pages = [{ url: b.reused[0].url, rank: 15, title: "真实 B300 原页面标题" }];
  snapshots.other.items.push(reused);
  snapshots.first.items[0].pages = [{ title: "真实原页面标题", url: "https://flatkey.ai/blog/ranked-original", rank: 2 },
    { title: "同词第二真实页面", url: "https://flatkey.ai/models/original", rank: 6 }];
  snapshots.first.items[0].rank = 2; snapshots.first.items[0].ranked = true;
  metadata = [meta(first, a, 1031, "approvedKeywordReview"), meta(other, b, 467, "approvedOtherKeywordReview")];
  t.mock.method(globalThis, "fetch", async () => assert.fail("weekly approved capture must never contact a provider or other network source"));
});

test("the saved November 22 LA captures populate only November 19–25, preserving all 1499 frozen words and explicit reuse", async () => {
  const packet = await loadApprovedWeeklyKeywordCapture(window);
  assert.equal(packet.targetCount, 1499); assert.equal(packet.newQueryCount, 1498); assert.equal(packet.reusedQueryCount, 1);
  assert.equal(packet.capturedKeywords, 1499); assert.equal(packet.rankedKeywords, 2);
  assert.equal(packet.verifiedOutsideTop100, 0); assert.equal(packet.unresolvedKeywords, 1497);
  assert.equal(packet.complete, true, "collection completion does not pretend short misses were full Top100 absences");
  assert.equal(packet.comparable, false); assert.equal(packet.countries.find(row => row.country === "CN").targetCount, 16);
  assert.deepEqual(calls, { first: 1, other: 1, metadata: 1 });
  const reused = packet.pages.find(page => page.reused);
  assert.equal(reused.rank, 15); assert.equal(reused.checkedAt, "2026-11-22T11:49:22.000Z");
  assert.equal(reused.sourceRunId, "serp-cycle-2026-11-17"); assert.equal(reused.title, "真实 B300 原页面标题");
  assert.ok(packet.notes.some(note => note.includes("真实原页面标题") && note.includes("https://flatkey.ai/blog/ranked-original")));
  assert.ok(packet.notes.some(note => note.includes("中性词") && note.includes("一次性")));
  assert.ok(packet.notes.some(note => note.includes("CN16")));
  assert.ok(!JSON.stringify(packet).includes("PRIVATE_CONNECTION_HASH_MUST_NOT_ESCAPE"));
});

test("old November 12–18 reports and later weeks receive null rather than a relabelled scheduled capture or an old baseline", () => {
  assert.equal(buildApprovedWeeklyKeywordCapture({ start: "2026-11-12", end: "2026-11-18" }, snapshots, metadata), null);
  assert.equal(buildApprovedWeeklyKeywordCapture({ start: "2026-11-26", end: "2026-12-02" }, snapshots, metadata), null);
  assert.equal(buildApprovedWeeklyKeywordCapture({ ...window, asOf: new Date("2026-11-21T23:00:00Z") }, snapshots, metadata), null);
});

test("the actual LA day is authoritative at both week boundaries and asOf excludes later provider timestamps", () => {
  snapshots.first.items[0].checkedAt = "2026-11-19T07:59:59Z"; // LA Nov18
  snapshots.first.items[1].checkedAt = "2026-11-26T08:00:00Z"; // LA Nov26
  const packet = buildApprovedWeeklyKeywordCapture({ ...window, asOf: new Date("2026-11-23T03:35:00Z") }, snapshots, metadata);
  assert.equal(packet.capturedKeywords, 1497); assert.equal(packet.complete, false);
  assert.equal(packet.rankedKeywords, 1, "the previous LA week's positive hit cannot leak into this week");
  assert.ok(packet.pages.every(page => page.keywordId !== snapshots.first.items[0].keywordId));
});

test("partial submission results remain partial and unknown, account or cost stops do not erase already verified saved hits", () => {
  snapshots.other.run.status = "RUNNING"; snapshots.other.run.completedAt = null;
  snapshots.other.run.taskCounts = { COMPLETE: 462, QUEUED: 5 };
  snapshots.other.items.slice(0, 5).forEach(row => { row.state = "QUEUED"; row.checkedAt = null; row.captureComplete = null; });
  snapshots.first.run.status = "UNKNOWN";
  const packet = buildApprovedWeeklyKeywordCapture(window, snapshots, metadata);
  assert.equal(packet.complete, false); assert.equal(packet.capturedKeywords, 1494); assert.equal(packet.rankedKeywords, 2);
  assert.equal(packet.unresolvedKeywords, 1497); assert.ok(packet.notes.some(note => note.includes("尚未全部齐")));
});

test("short misses, corrected keywords and invalid ranks cannot become confirmed absences or positive rankings", () => {
  const corrected = snapshots.first.items[0]; corrected.queryStatus = "AUTOCORRECTED"; corrected.rankingVerified = false;
  const invalid = snapshots.first.items[1]; invalid.pages = [
    { url: "https://flatkey.ai.attacker.test/", rank: 1 }, { url: "https://flatkey.ai/zero", rank: 0 },
    { url: "https://flatkey.ai/fraction", rank: 1.5 }, { url: "https://flatkey.ai/deep", rank: 101 },
    { url: "https://flatkey.ai/string", rank: "1" }, { url: "javascript:alert(1)", rank: 1 },
  ];
  const outside = snapshots.first.items[2]; outside.completeDepth = true; outside.organicCount = 100; outside.coveredThroughRank = 100;
  const packet = buildApprovedWeeklyKeywordCapture(window, snapshots, metadata);
  assert.equal(packet.rankedKeywords, 1); assert.equal(packet.verifiedOutsideTop100, 1);
  assert.equal(packet.unresolvedKeywords, 1497); assert.equal(packet.capturedKeywords, 1499);
});

test("rank buckets use every saved page and each original word's best rank across the approved countries, never just five examples", () => {
  const rows = [...snapshots.first.items, ...snapshots.other.items];
  rows.forEach(row => { row.pages = []; row.rank = null; row.ranked = null; });
  const selected = [rows.find(row => row.country === "US"), rows.find(row => row.country === "JP"),
    rows.find(row => row.country === "ES"), rows.find(row => row.country === "BR"), rows.find(row => row.country === "CN"),
    rows.filter(row => row.country === "US")[1]];
  const ranks = [4, 11, 30, 31, 75, 100];
  selected.forEach((row, index) => { row.pages = [
    { title: `真实结果${index}`, url: `https://flatkey.ai/blog/country-result-${index}`, rank: ranks[index] },
    { title: `同词较后页面${index}`, url: `https://flatkey.ai/models/country-result-${index}`, rank: Math.min(100, ranks[index] + 10) },
    { title: `同URL较差重复${index}`, url: `https://flatkey.ai/blog/country-result-${index}`, rank: Math.min(100, ranks[index] + 3) },
  ]; });
  const packet = buildApprovedWeeklyKeywordCapture(window, snapshots, metadata);
  assert.equal(packet.rankedKeywords, 6);
  assert.deepEqual(packet.rankBuckets, { top10: 1, rank11to30: 2, rank31to50: 1, rank51to100: 2 });
  assert.equal(Object.values(packet.rankBuckets).reduce((sum, value) => sum + value, 0), packet.rankedKeywords);
  assert.equal(packet.notes.filter(note => note.startsWith("排名例证：")).length, 5, "the sixth saved word is counted although example notes stop at five");
});

test("immutable DB metadata must match the exact scope, quote, frozen cohort and caps even though getter top-level identity is fixed", () => {
  const mutations = [
    row => row.scope = "SCHEDULED", row => row.periodKey += "-retry", row => row.cohortHash = "0".repeat(64),
    row => row.queryCount++, row => row.targetCount--, row => row.estimatedCostMicros++, row => row.reservedCostMicros++,
    row => row.configJson.approvedKeywordReview.quoteSha256 = "0".repeat(64),
    row => row.configJson.approvedKeywordReview.queryHash = "0".repeat(64), row => row.configJson.approvedKeywordReview.userApproved = false,
  ];
  for (const mutate of mutations) { const changed = structuredClone(metadata); mutate(changed[0]); assert.throws(() => buildApprovedWeeklyKeywordCapture(window, snapshots, changed), /METADATA_IDENTITY/); }
  assert.throws(() => buildApprovedWeeklyKeywordCapture(window, snapshots, metadata.slice(0, 1)), /METADATA_MISSING/);
});

test("a run created after a getter saw no run cannot inject unread captures through newer metadata", () => {
  snapshots.first.run = null; snapshots.other.run = null;
  const packet = buildApprovedWeeklyKeywordCapture(window, snapshots, metadata);
  assert.equal(packet.capturedKeywords, 1); assert.equal(packet.rankedKeywords, 1); assert.equal(packet.complete, false);
  assert.ok(packet.pages.every(page => page.reused && page.sourceRunId === "serp-cycle-2026-11-17"));
});

test("an expanded, duplicated, renamed or differently assigned word never enters the frozen weekly source", () => {
  const mutations = [
    value => value.first.items.push(value.first.items[0]),
    value => value.first.items[0].keyword += " changed",
    value => value.first.items[0].country = "CN",
    value => value.first.items[0].keywordId = "different-id",
    value => value.other.items[0].language = "en-unknown",
    value => value.other.items.at(-1).sourceRunId = first.RUN_ID,
    value => value.other.items.at(-1).reused = false,
  ];
  for (const mutate of mutations) { const changed = structuredClone(snapshots); mutate(changed); assert.throws(() => buildApprovedWeeklyKeywordCapture(window, changed, metadata), /TASK_IDENTITY/); }
});

test("source hashes are stable across row and object order but bind the actual page, provider receipt and cutoff", () => {
  const original = buildApprovedWeeklyKeywordCapture(window, snapshots, metadata);
  snapshots.first.items.reverse(); snapshots.other.items.reverse(); metadata.reverse();
  assert.equal(buildApprovedWeeklyKeywordCapture(window, snapshots, metadata).sourceHash, original.sourceHash);
  const changed = structuredClone(snapshots); changed.first.items.find(row => row.pages.length).pages[0].title += " 实际更正";
  assert.notEqual(buildApprovedWeeklyKeywordCapture(window, changed, metadata).sourceHash, original.sourceHash);
  const receiptChanged = structuredClone(snapshots); receiptChanged.first.items[0].providerTaskId += "-corrected";
  assert.notEqual(buildApprovedWeeklyKeywordCapture(window, receiptChanged, metadata).sourceHash, original.sourceHash);
  assert.notEqual(buildApprovedWeeklyKeywordCapture({ ...window, asOf: new Date("2026-11-24T00:00:00Z") }, snapshots, metadata).sourceHash, original.sourceHash);
});

test("invalid report dates and cutoffs are rejected without inventing a source packet", () => {
  for (const value of [{ start: "2026-02-30", end: "2026-03-02" }, { start: "2026-11-25", end: "2026-11-19" },
    { ...window, asOf: new Date("invalid") }]) assert.throws(() => buildApprovedWeeklyKeywordCapture(value, snapshots, metadata), /INVALID_WINDOW/);
});
