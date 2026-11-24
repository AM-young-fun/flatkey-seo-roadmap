const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { emptyGrowthStrategy, prepareGrowthStrategyMutation } = require("../src/lib/growth-strategy.ts");
const now = new Date("2026-11-24T12:00:00Z"), sampledAt = "2026-11-18T12:00:00Z";
function fixture() {
  const publication = { id: "actual-publication", taskId: "original-task", siteDomain: "flatkey.ai", pageUrl: "https://flatkey.ai/blog/original-page", contentVersion: "actual-live-version", publishedAt: "2026-11-01T00:00:00Z", status: "verified", kind: "source_blog", keyword: "GPU pricing", country: "US", language: "en" };
  const task = { id: publication.taskId, siteDomain: publication.siteDomain, pageUrl: publication.pageUrl, keyword: publication.keyword, keywordId: "original-keyword", country: publication.country, language: publication.language };
  const target = { id: "original-target", keywordId: task.keywordId, site: publication.siteDomain, country: publication.country, language: publication.language, keyword: "gpu pricing", rank: 20, rankUrl: publication.pageUrl, rankSource: "serp", languageStatus: "match", checkedAt: sampledAt, observationEligible: true, publishedUrls: [publication.pageUrl], taskIds: [task.id] };
  const observation = { id: "original-14d-observation", publicationId: publication.id, taskId: task.id, site: publication.siteDomain, pageUrl: publication.pageUrl, contentVersion: publication.contentVersion, publishedAt: publication.publishedAt, checkpoint: 14, checkedAt: now.toISOString(), timezone: "America/Los_Angeles", windowStart: "2026-11-01", windowEnd: "2026-11-14", indexing: "unknown", rank: target.rank, sessions: null,
    rankingEvidence: { source: "SERP", targetId: target.id, checkedAt: sampledAt, reference: "saved:exact-original-serp" }, evidence: [{ source: "SERP", reference: "saved:exact-original-serp", observedAt: sampledAt, supports: "同原词原市场真实采样；GA4仍缺，未填0" }], conclusion: "已核原词实测排名，其余效果证据待补", nextAction: "沿原任务补齐该窗口的GA4及收录证据",
    comparison: { status: "new_page", publicationId: publication.id, taskId: task.id, contentVersion: publication.contentVersion, site: publication.siteDomain, pageUrl: publication.pageUrl, country: publication.country, language: publication.language, source: "GA4", propertyId: null, sourceTimezone: "America/Los_Angeles", scope: "page-session-organic-search", before: { start: "2026-10-17", end: "2026-10-30", coveredDates: [], sessions: null, evidence: [], limitations: ["新页无上线前行为基线"] }, after: { start: "2026-11-01", end: "2026-11-14", coveredDates: [], sessions: null, evidence: [], limitations: ["该页面自然会话完整窗口尚缺"] }, reason: "新页排名独立核验，不伪造GA4窗口", limitations: ["GA4来源待补"] } };
  return { publication, task, target, observation };
}
function save(f, contextPatch = {}) {
  return prepareGrowthStrategyMutation(emptyGrowthStrategy(), { requestId: "local-ranking-test", expectedVersion: 0, action: "record_observation", observation: f.observation }, "collector", { version: "growth-v1.5", targets: [f.target], topics: [] }, [f.publication], [f.task.id], now, { taskReferences: [f.task], ...contextPatch });
}
const rejected = f => assert.throws(() => save(f), { code: "ranking_evidence_missing" });

test("exact original-task/word/page SERP evidence may complete ranking after the checkpoint day without inventing other metrics", () => {
  const f = fixture(), before = structuredClone(f), result = save(f).observations[0];
  assert.equal(result.rank, 20); assert.deepEqual(result.coverage, { indexing: "missing", ranking: "verified", traffic: "missing" });
  assert.equal(result.windowEnd, "2026-11-14"); assert.equal(result.rankingEvidence.checkedAt, sampledAt, "late existing sampling is allowed, not forced onto the target day");
  assert.deepEqual(f, before, "validation never changes the original task, page, word or source");
});

test("another word or task sharing the same URL cannot become the original publication's verified rank", () => {
  for (const patch of [{ keyword: "different original keyword" }, { taskIds: ["different-task"] }, { keywordId: "different-keyword-id" }, { rankUrl: "https://flatkey.ai/blog/another-page" }]) {
    const f = fixture(); Object.assign(f.target, patch); rejected(f);
  }
  for (const patch of [{ keyword: "different task keyword" }, { pageUrl: "https://flatkey.ai/blog/different-task-page" }, { country: "JP" }, { language: "ja" }, { siteDomain: "modelfit.cc" }, { deletedAt: "2026-11-20T12:00:00Z" }]) {
    const f = fixture(); Object.assign(f.task, patch); rejected(f);
  }
});

test("a SERP sample before actual publication, after this observation check, or in the future is rejected", () => {
  for (const checkedAt of ["2026-10-31T23:59:59Z", "2026-11-24T12:00:01Z", "2026-12-01T12:00:00Z"]) {
    const f = fixture(); f.target.checkedAt = checkedAt; f.observation.rankingEvidence.checkedAt = checkedAt; rejected(f);
  }
  for (const checkedAt of ["2026-11-01T00:00:00Z", now.toISOString()]) {
    const f = fixture(); f.target.checkedAt = checkedAt; f.observation.rankingEvidence.checkedAt = checkedAt;
    assert.equal(save(f).observations[0].coverage.ranking, "verified", checkedAt);
  }
});

test("missing historical identities remain partial and cannot be upgraded through caller-supplied references", () => {
  for (const object of ["publication", "task"]) { const f = fixture(); f[object].keyword = null; rejected(f); }
  assert.throws(() => save(fixture(), { taskReferences: [] }), { code: "ranking_evidence_missing" });
  const f = fixture(); f.publication.keyword = null; f.observation.rank = null; delete f.observation.rankingEvidence;
  const saved = save(f).observations[0]; assert.equal(saved.rank, null); assert.equal(saved.coverage.ranking, "missing");
  const smuggled = fixture(); smuggled.observation.taskReferences = [smuggled.task];
  assert.throws(() => save(smuggled), /Unrecognized key/);
});

test("existing native/exact/complete source gates remain and a true outside100 receipt is not a missing rank", () => {
  for (const patch of [{ observationEligible: false }, { rankSource: "gsc" }, { languageStatus: "mismatch" }, { country: "JP" }, { language: "ja" }, { site: "modelfit.cc" }]) {
    const f = fixture(); Object.assign(f.target, patch); rejected(f);
  }
  const f = fixture(); Object.assign(f.target, { rank: null, rankUrl: null, captureState: "outside100" }); f.observation.rank = null;
  const saved = save(f).observations[0]; assert.equal(saved.rank, null); assert.equal(saved.coverage.ranking, "verified");
});
