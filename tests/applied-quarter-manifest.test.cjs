const { test } = require('node:test'), assert = require('node:assert/strict');
require('./register-ui-modules.cjs');
const Module = require('node:module');
const { canonicalQuarterSelection, quarterMembershipHash: hash, planQuarterMembership, QUARTER_MEMBERSHIP_STATUS } = require('../src/lib/quarter-membership.ts');
const { readAppliedQuarterManifestAudit, projectAppliedQuarterManifestTopics } = require('../src/lib/applied-quarter-manifest.ts');
const { buildGrowthWorkspace } = require('../src/lib/growth-workspace.ts');
const copy = value => structuredClone(value), now = '2026-11-24T11:00:00Z';
function fixture() {
  const selection = canonicalQuarterSelection({ version: 'quarter-membership-v1', quarterId: '2026-close', sourceReference: '/approved/exact-original-1600.json',
    sourceHash: 'a'.repeat(64), members: Array.from({ length: 1600 }, (_, i) => ({ siteDomain: 'flatkey.ai', keywordId: `word-${i}`, keyword: `gpu rental original ${i}`, topicId: 'reviewed-topic' })) });
  const members = selection.members.map(row => ({ siteDomain: row.siteDomain, keywordId: row.keywordId, active: true, pool: row.keywordId === 'word-0' ? 'RESEARCH' : 'FORMAL',
    topicId: 'original-primary', origin: 'PLANNED', targetUrls: [], protected: true, curationId: 'old-audit',
    keyword: { id: row.keywordId, text: row.keyword, active: true, updatedAt: now }, topicAssignments: [{ topicId: 'reviewed-topic' }] }));
  const topics = [{ id: 'reviewed-topic', text: 'Reviewed GPU rental direction', active: true, sites: [{ siteDomain: 'flatkey.ai' }] }];
  const preview = planQuarterMembership({ action: 'preview', requestId: 'human-exact-1600', selection }, members, topics);
  const command = { action: 'apply', requestId: 'human-exact-1600', selection, selectionHash: preview.selectionHash, expectedStateHash: preview.stateHash };
  const after = members.map(row => ({ ...row, pool: 'FORMAL' }));
  const audit = { id: `quarter-membership:2026-close:${command.requestId}`, siteDomain: 'flatkey.ai', status: QUARTER_MEMBERSHIP_STATUS,
    payloadHash: hash(command), before: { members, topics }, after: { members: after, topics }, appliedAt: new Date(now), restoredAt: null,
    summary: { version: 'quarter-membership-v1', requestId: command.requestId, actor: 'human', selection, selectionHash: preview.selectionHash,
      sourceHash: selection.sourceHash, expectedStateHash: preview.stateHash, afterHash: hash(after), changed: 1, uniqueWords: 1600, membershipCount: 1600 } };
  const input = { generatedAt: now, topics: [{ id: 'original-primary', text: 'Original broader GPU direction', active: true, sites: ['flatkey.ai'] },
    { id: 'reviewed-topic', text: topics[0].text, active: true, sites: ['flatkey.ai'] }],
    memberships: after.map(row => ({ site: row.siteDomain, keywordId: row.keywordId, keyword: row.keyword.text, active: true, keywordActive: true,
      pool: row.pool, origin: row.origin, topicId: row.topicId, topicIds: row.topicAssignments.map(edge => edge.topicId), targetUrls: [],
      marketAssignment: { primaryCountry: 'US', language: 'en', secondaryMarkets: [], evidence: 'Original independent local English market review', reviewedAt: now } })),
    tasks: [], publications: [], inventory: [], ranks: [{ site: 'flatkey.ai', keywordId: 'word-0', keyword: 'gpu rental original 0', country: 'US', language: 'en', source: 'serp',
      rank: 12, url: 'https://flatkey.ai/blog/original', checkedAt: '2026-11-20T10:00:00Z', exact: true, complete: true,
      period: { id: 'original-history', label: 'Original saved collection', scope: 'tracked', cohortHash: 'b'.repeat(64), originalTargetCount: 1525, originalQueryCount: 1499 } }] };
  return { audit, command, input };
}
test('only an exact applied human1600 audit reconstructing command, source and full before/after hashes is authority', () => {
  const { audit } = fixture(), receipt = readAppliedQuarterManifestAudit(audit);
  assert.ok(receipt); assert.equal(receipt.auditId, audit.id); assert.equal(receipt.selectionHash, audit.summary.selectionHash);
  assert.equal(receipt.actor, 'human'); assert.equal(receipt.changed, 1); assert.equal(receipt.uniqueWords, 1600); assert.equal(receipt.afterHash, audit.summary.afterHash);
  for (const change of [
    row => { row.status = 'PREVIEW'; }, row => { row.summary.actor = 'collector'; }, row => { row.payloadHash = '0'.repeat(64); },
    row => { row.summary.sourceHash = '0'.repeat(64); }, row => { row.summary.selection.members[0].topicId = 'other'; },
    row => { row.summary.expectedStateHash = '0'.repeat(64); }, row => { row.summary.afterHash = '0'.repeat(64); },
    row => { row.before.members[0].targetUrls.push('https://flatkey.ai/later'); }, row => { row.after.members[0].topicId = 'rewritten-primary'; },
    row => { row.after.topics[0].text = 'Different direction'; }, row => { row.summary.changed = 0; },
    row => { row.id += '-another-request'; }, row => { row.restoredAt = new Date(now); }, row => { row.summary.selection.members.pop(); },
  ]) { const invalid = copy(audit); change(invalid); assert.equal(readAppliedQuarterManifestAudit(invalid), null); }
  const legacy = copy(audit), original = { ...fixture().command, selection: { ...audit.summary.selection, members: [...audit.summary.selection.members].reverse() } };
  legacy.payloadHash = hash(original); assert.equal(readAppliedQuarterManifestAudit(legacy), null, 'never guess an unsaved legacy input order');
});
test('approved current main topic wins original primary without mutating any source or historic denominator', () => {
  const { audit, input } = fixture(), savedInput = copy(input), savedAudit = copy(audit), original = buildGrowthWorkspace(input);
  const projected = projectAppliedQuarterManifestTopics(input, audit, [{ domain: 'flatkey.ai', active: true }]);
  const current = buildGrowthWorkspace(projected.input);
  assert.equal(projected.projections.length, 1600); assert.equal(projected.skipped, 0);
  assert.ok(current.targets.every(row => row.topicId === 'reviewed-topic'));
  assert.equal(current.topics.find(row => row.topicId === 'reviewed-topic').formalCount, 1600);
  assert.equal(current.topics.find(row => row.topicId === 'original-primary').formalCount, 0);
  assert.ok(current.targets.every(row => row.relatedTopicIds.includes('original-primary')));
  assert.deepEqual(current.targets.map(row => [row.id, row.rank, row.rankEligible, row.captureRunId]).sort(), original.targets.map(row => [row.id, row.rank, row.rankEligible, row.captureRunId]).sort());
  assert.deepEqual(current.reconciliation.historicalLanguageReview, original.reconciliation.historicalLanguageReview);
  assert.equal(current.reconciliation.uniqueKeywordCount, original.reconciliation.uniqueKeywordCount);
  assert.equal(current.reconciliation.historicalLanguageReview.periods[0].originalTargetCount, 1525);
  assert.equal(projected.projections[0].originalTopicId, 'original-primary'); assert.equal(projected.projections[0].scope, 'current-quarter-only');
  assert.deepEqual(input, savedInput); assert.deepEqual(audit, savedAudit); assert.equal(projected.input.ranks, input.ranks);
});
test('inactive, lost-edge, cross-site and changed raw identities never borrow the manifest preference', () => {
  const { audit, input } = fixture();
  for (const mutate of [
    value => { value.memberships[0].active = false; }, value => { value.memberships[0].keywordActive = false; },
    value => { value.memberships[0].topicIds = []; }, value => { value.memberships[0].pool = 'RESEARCH'; },
    value => { value.memberships[0].keyword = 'another original word'; }, value => { value.memberships[0].keywordId = 'unapproved-alias'; },
    value => { value.topics[1].active = false; }, value => { value.topics[1].sites = ['modelfit.cc']; },
    value => { value.topics[1].text = '自然搜索发现'; },
  ]) { const value = copy(input); mutate(value); const projected = projectAppliedQuarterManifestTopics(value, audit, [{ domain: 'flatkey.ai', active: true }]);
    assert.equal(projected.input.memberships[0].topicId, 'original-primary'); }
  assert.equal(projectAppliedQuarterManifestTopics(input, audit, [{ domain: 'flatkey.ai', active: false }]).projections.length, 0);
  assert.equal(projectAppliedQuarterManifestTopics(input, null, [{ domain: 'flatkey.ai', active: true }]).input, input);
  assert.equal(projectAppliedQuarterManifestTopics(input, { ...audit, status: 'PREVIEW' }, [{ domain: 'flatkey.ai', active: true }]).projections.length, 0);
  const historicalInput = { ...input, generatedAt: '2026-11-23T11:00:00Z' };
  assert.equal(projectAppliedQuarterManifestTopics(historicalInput, audit, [{ domain: 'flatkey.ai', active: true }]).input, historicalInput,
    'a later human apply never grants a current-topic preference to an earlier asOf view');
});
test('normal workspace reader consumes the committed audit and exports original primary provenance without writes', async () => {
  const { audit, input } = fixture(), sourceRows = input.memberships.map(row => ({ siteDomain: row.site, rowKey: `keyword:${row.keywordId}`, snapshot: row.marketAssignment }));
  const memberRows = input.memberships.map(row => ({ siteDomain: row.site, keywordId: row.keywordId, active: row.active, pool: row.pool, origin: row.origin,
    topicId: row.topicId, targetUrls: row.targetUrls, mappingStatus: 'UNMAPPED', sourceUrl: null,
    keyword: { text: row.keyword, active: row.keywordActive }, topicAssignments: row.topicIds.map(topicId => ({ topicId })) }));
  let readAudit = 0;
  const db = { topic: { findMany: async () => input.topics.map(row => ({ ...row, childEdges: [], parentId: null, sites: row.sites.map(siteDomain => ({ siteDomain })) })) },
    siteKeyword: { findMany: async () => memberRows }, keywordSourceRow: { findMany: async query => query.where.sourceId === 'SEO_MARKET_ASSIGNMENT' ? sourceRows : [] },
    seoPageInventory: { findMany: async () => [] }, seoSite: { findMany: async () => [{ domain: 'flatkey.ai', active: true, ga4PropertyId: '541304395' }] },
    seoWorkflowRecord: { findMany: async () => [], findUnique: async () => null },
    keywordCurationAudit: { findFirst: async query => { readAudit++; assert.equal(query.where.status, QUARTER_MEMBERSHIP_STATUS); assert.equal(query.orderBy.appliedAt, 'desc'); return audit; } },
    dataForSeoRun: { findMany: async () => [] }, keywordPageObservation: { findMany: async () => [] }, $queryRaw: async () => [] };
  const load = Module._load;
  Module._load = function (name, parent, ...args) {
    if (name === 'server-only') return {};
    if (name === '@/lib/prisma') return { prisma: db };
    if (name === './seo-workflow' && parent.filename.endsWith('/services/growth-workspace.ts')) return { loadWorkflowSnapshot: async () => ({ tasks: [], publications: [] }) };
    return load.call(this, name, parent, ...args);
  };
  const priorURL = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgresql://readonly-fixture';
  try {
    const { loadGrowthWorkspace } = require('../src/lib/services/growth-workspace.ts');
    const workspace = await loadGrowthWorkspace(false, new Date(now));
    assert.equal(readAudit, 1); assert.equal(workspace.targets.length, 1600);
    assert.ok(workspace.targets.every(row => row.topicId === 'reviewed-topic'));
    assert.equal(workspace.targets[0].currentQuarterTopicProjection.originalTopicId, 'original-primary');
    assert.equal(workspace.targets[0].currentQuarterTopicProjection.auditId, audit.id);
    assert.equal(workspace.quarter, undefined, 'member apply is not quarter baseline freeze');
  } finally { Module._load = load; if (priorURL === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorURL; }
});
