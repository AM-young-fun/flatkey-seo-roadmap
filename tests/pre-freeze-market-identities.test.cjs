const { test, beforeEach } = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module'), crypto = require('node:crypto');
require('./register-ui-modules.cjs');
const path = require('node:path'), root = path.resolve(__dirname, '..'), load = Module._load;
const copy = value => structuredClone(value), now = new Date('2026-11-24T10:00:00.123Z');
let db, writes, failAudit, mutateOnReadback;
const sourceKey = row => `${row.siteDomain}:${row.sourceId}:${row.rowKey}`;
const tx = {
  $executeRaw: async () => 1, $queryRaw: async () => [],
  siteKeyword: { findMany: async ({ where }) => copy(db.members.filter(row => where.OR.some(scope => scope.siteDomain === row.siteDomain && scope.keywordId.in.includes(row.keywordId)))),
    findUnique: async ({ where }) => { const scope = where.siteDomain_keywordId; return copy(db.members.find(row => row.siteDomain === scope.siteDomain && row.keywordId === scope.keywordId)); } },
  topic: { findMany: async ({ where }) => copy(db.topics.filter(row => where.id.in.includes(row.id))) },
  seoSite: { findMany: async ({ where }) => copy(db.sites.filter(row => where.domain.in.includes(row.domain))) },
  seoWorkflowRecord: { findUnique: async () => copy(db.quarter) },
  keywordSourceRow: {
    findMany: async ({ where }) => copy([...db.sources.values()].filter(row => where.OR ? where.OR.some(scope => scope.siteDomain === row.siteDomain && scope.rowKey === row.rowKey && scope.sourceId.in.includes(row.sourceId)) : row.sourceId === where.sourceId)),
    findUnique: async ({ where }) => copy(db.sources.get(sourceKey(where.siteDomain_sourceId_rowKey)) ?? null),
    create: async ({ data }) => { assert.equal(db.sources.has(sourceKey(data)), false); db.sources.set(sourceKey(data), { ...copy(data), createdAt: now, updatedAt: now }); writes.push(data.sourceId); if (mutateOnReadback) db.members[0].pool = 'RESEARCH'; return copy(data); },
    upsert: async ({ where, create, update }) => { const key = sourceKey(where.siteDomain_sourceId_rowKey), old = db.sources.get(key); db.sources.set(key, old ? { ...old, ...copy(update) } : copy(create)); writes.push('normal-research-source'); },
  },
  keywordCurationAudit: {
    findUnique: async ({ where }) => { const row = copy(db.audits.get(where.id) ?? null); if (row && failAudit === 'read') row.summary.receiptHash = '0'.repeat(64); return row; },
    findMany: async ({ where }) => copy([...db.audits.values()].filter(row => where.id.in.includes(row.id) && row.status === where.status)),
    create: async ({ data }) => { if (failAudit === 'create') throw Error('audit unavailable'); db.audits.set(data.id, copy(data)); writes.push('audit'); return data; },
  },
};
const prisma = { keywordCurationAudit: tx.keywordCurationAudit, $transaction: async (action, options) => {
  assert.equal(options.isolationLevel, 'Serializable'); const before = copy(db), size = writes.length;
  try { return await action(tx); } catch (error) { db = before; writes.splice(size); throw error; }
} };
Module._load = function (name, parent, ...rest) {
  if (name === 'server-only') return {};
  if (name === '@/lib/prisma') return { prisma };
  if (name.startsWith('@/')) return load.call(this, path.join(root, 'src', name.slice(2)) + '.ts', parent, ...rest);
  return load.call(this, name, parent, ...rest);
};
const lib = require('../src/lib/pre-freeze-market-identities.ts');
const { savePreFreezeIdentities, loadPreFreezeIdentityReceipt } = require('../src/lib/services/pre-freeze-market-identities.ts');
const { syncWorkflowMarketAssignment } = require('../src/lib/services/keyword-market-assignment.ts');
const { preFreezeHash: hash, HUMAN_WORD_LANGUAGE_SOURCE_ID: languageSource, auditedHumanWordLanguages, preFreezeCommandSchema, planPreFreezeIdentities } = lib;
const evidence = content => ({ reference: '/reviewed/real-local-source.json', content, quote: content, sha256: crypto.createHash('sha256').update(content).digest('hex'), observedAt: '2026-11-23T10:00:00Z' });
function review() {
  const members = db.members.map(row => ({ siteDomain: row.siteDomain, keywordId: row.keywordId, keyword: row.keyword.text, topicId: row.topicId }));
  const selection = { version: 'quarter-membership-v1', quarterId: '2026-close', sourceReference: '/reviewed/exact-quarter.json', sourceHash: 'a'.repeat(64), members };
  selection.members.sort((a, b) => a.siteDomain.localeCompare(b.siteDomain) || a.keywordId.localeCompare(b.keywordId));
  const word = db.members[0].keyword.text, spanText = word.includes('offloading') ? 'offloading' : 'rental', start = word.indexOf(spanText);
  return { version: 'pre-freeze-identities-v1', selection, selectionHash: hash(selection), assignments: [{ ...members.find(row => row.keywordId === 'keyword-0'), country: 'US', language: 'en',
    demand: { ...evidence(JSON.stringify({ keyword: word, monthlySearches: 10, country: 'US' })), exactKeyword: word, country: 'US', language: 'en', metric: 'monthly_searches', value: 10 },
    wordLanguage: { ...evidence(`The original phrase '${word}' uses the English word '${spanText}'.`), language: 'en', spans: [{ text: spanText, start, end: start + spanText.length }], reason: 'Human reviewed the original English lexical phrase and exact local demand record; not its query locale.' } }] };
}
const prepare = async (value = review(), requestId = 'human-prefreeze-once') => {
  const result = await savePreFreezeIdentities({ action: 'preview_identities', requestId, review: value }, 'human', now);
  return { command: { action: 'apply_identities', requestId, review: value, expectedStateHash: result.stateHash }, result };
};
beforeEach(() => {
  db = { members: Array.from({ length: 1600 }, (_, i) => ({ siteDomain: 'flatkey.ai', keywordId: `keyword-${i}`, topicId: 'topic1', origin: 'PLANNED', active: true, pool: 'FORMAL', protected: true, reviewStatus: 'REVIEWED', sourceUrl: 'https://official.test/original', targetUrls: [], candidateUrls: [], curationId: 'old-curation',
    keyword: { id: `keyword-${i}`, text: `gpu rental keyword ${i}`, active: true, type: 'SUB', parentId: 'original-mf-parent', topicId: 'original-mf-topic', updatedAt: now }, topicAssignments: [{ siteDomain: 'flatkey.ai', keywordId: `keyword-${i}`, topicId: 'topic1' }] })),
    topics: [{ id: 'topic1', text: 'GPU rental', active: true, sites: [{ siteDomain: 'flatkey.ai', topicId: 'topic1' }] }], sites: [{ domain: 'flatkey.ai', active: true }], sources: new Map(), audits: new Map(),
    quarter: { key: 'growth-strategy:2026-close', version: 1, payload: { baseline: null, quarterPlanning: { exactOriginalDraft: true } } },
    untouchedTasks: [{ id: 'original-task', status: 'verified', dueAt: '2026-11-20', keywordId: 'keyword-0' }], untouchedRankings: [{ keywordId: 'keyword-0', country: 'JP', rank: 12, period: 'old' }] };
  writes = []; failAudit = null; mutateOnReadback = false;
});
test('pre-freeze preview is read-only and apply creates only missing source rows plus one immutable human audit', async () => {
  const { command, result } = await prepare(), before = copy(db);
  assert.equal(result.createSourceRows, 2); assert.equal(writes.length, 0);
  const applied = await savePreFreezeIdentities(command, 'human', now);
  assert.equal(applied.currentStateVerified, true); assert.equal(applied.receipt.createdSourceRows, 2);
  assert.deepEqual(db.members, before.members); assert.deepEqual(db.topics, before.topics); assert.deepEqual(db.quarter, before.quarter);
  assert.deepEqual(db.untouchedTasks, before.untouchedTasks); assert.deepEqual(db.untouchedRankings, before.untouchedRankings);
  assert.deepEqual(writes, ['SEO_MARKET_ASSIGNMENT', languageSource, 'audit']);
  const again = await savePreFreezeIdentities(command, 'human', new Date(now.getTime() + 2000));
  assert.equal(again.replay, true); assert.deepEqual(again.receipt, applied.receipt); assert.equal(writes.length, 3);
  assert.deepEqual((await loadPreFreezeIdentityReceipt(command.requestId, 'human')).receipt, applied.receipt);
  const readback = await savePreFreezeIdentities({ action: 'preview_identities', requestId: command.requestId, review: command.review }, 'human', now);
  assert.equal(readback.readbackHash, applied.receipt.afterHash); assert.equal(readback.createSourceRows, 0);
});
test('same valid primary country is reused byte-for-byte; a different or invalid old market is 409 with zero committed changes', async () => {
  const old = { siteDomain: 'flatkey.ai', sourceId: 'SEO_MARKET_ASSIGNMENT', rowKey: 'keyword:keyword-0', snapshotHash: 'old-hash', snapshot: { primaryCountry: 'US', language: 'en', secondaryMarkets: [], evidence: 'Original independently approved country source', reviewedAt: '2026-11-20T10:00:00Z' }, observedAt: new Date('2026-11-20T10:00:00Z'), createdAt: now, updatedAt: now };
  db.sources.set(sourceKey(old), copy(old)); const { command } = await prepare(); await savePreFreezeIdentities(command, 'human', now);
  assert.deepEqual(db.sources.get(sourceKey(old)), old); assert.deepEqual(writes, [languageSource, 'audit']);
  for (const snapshot of [{ ...old.snapshot, primaryCountry: 'JP', language: 'ja' }, { malformed: true }]) {
    db.sources = new Map([[sourceKey(old), { ...old, snapshot }]]); db.audits.clear(); writes = [];
    await assert.rejects(prepare(), { code: 'primary_market_conflict', status: 409 }); assert.equal(writes.length, 0);
  }
});
test('source SHA, stale protected state, collector, neutral/locale-only words and post-freeze initialization fail closed', async () => {
  const { command } = await prepare(), before = copy(db);
  await assert.rejects(savePreFreezeIdentities(command, 'collector'), { status: 403 }); assert.deepEqual(db, before);
  db.members[0].keyword.parentId = 'changed-parent'; const changed = copy(db);
  await assert.rejects(savePreFreezeIdentities(command, 'human', now), { code: 'state_changed', status: 409 }); assert.deepEqual(db, changed);
  db = copy(before); const bad = review(); bad.assignments[0].demand.sha256 = '0'.repeat(64);
  await assert.rejects(prepare(bad), { code: 'evidence_changed' });
  const wrongWordSource = review(); Object.assign(wrongWordSource.assignments[0].wordLanguage, evidence('A different Japanese phrase has its own language evidence.'));
  await assert.rejects(prepare(wrongWordSource), { code: 'word_language_source_mismatch' }); assert.equal(writes.length, 0);
  for (const model of ['nvidia b300', 'gpt-4.1', 'llama 3.1 70b instruct']) {
    db.members[0].keyword.text = model; const neutralReview = review(); neutralReview.assignments[0].wordLanguage.spans = [{ text: model, start: 0, end: model.length }];
    await assert.rejects(prepare(neutralReview), { code: 'neutral_word_language' });
  }
  db = copy(before); db.quarter.payload.baseline = { targets: ['original'] };
  await assert.rejects(prepare(), { code: 'baseline_frozen' }); assert.equal(writes.length, 0);
  db = copy(before); await assert.rejects(savePreFreezeIdentities({ action: 'preview_identities', requestId: 'closed-quarter', review: review() }, 'human', new Date('2027-02-06T00:00:00Z')), { code: 'quarter_closed' });
});
test('failed audit or protection mismatch rolls the source additions back; reusing a request with another review cannot override it', async () => {
  const { command } = await prepare(), before = copy(db);
  for (const mode of ['create', 'read', 'protected']) {
    db = copy(before); failAudit = mode; mutateOnReadback = mode === 'protected';
    await assert.rejects(savePreFreezeIdentities(command, 'human', now)); assert.deepEqual(db, before); assert.equal(writes.length, 0);
  }
  failAudit = null; mutateOnReadback = false; await savePreFreezeIdentities(command, 'human', now); const saved = copy(db);
  await assert.rejects(savePreFreezeIdentities({ ...command, expectedStateHash: '0'.repeat(64) }, 'human', now), { code: 'idempotency_conflict' }); assert.deepEqual(db, saved);
});
test('independent human language proof survives later normal research writes and cannot alter a historic snapshot', async () => {
  db.members[0].keyword.text = 'tensor offloading'; const { command } = await prepare(); await savePreFreezeIdentities(command, 'human', now);
  const proofBefore = copy(db.sources.get(`flatkey.ai:${languageSource}:keyword:keyword-0`));
  await syncWorkflowMarketAssignment(tx, { siteDomain: 'flatkey.ai', keywordId: 'keyword-0', keyword: 'tensor offloading', country: 'US', language: 'en',
    evidence: [{ label: 'Normal completed original research source retained', artifact: '/normal/research.json', observedAt: now.toISOString() }], reviewedAt: now.toISOString() });
  assert.deepEqual(db.sources.get(sourceKey(proofBefore)), proofBefore);
  const proofs = auditedHumanWordLanguages([...db.sources.values()], [...db.audits.values()]); assert.equal(proofs.length, 1);
  const { reviewGrowthLanguage, reviewGrowthHistoricalPeriods } = require('../src/lib/growth-workspace.ts');
  assert.equal(reviewGrowthLanguage('tensor offloading', 'US', 'en', [], proofs[0]).status, 'match');
  const ranks = [{ site: 'flatkey.ai', keywordId: 'keyword-0', keyword: 'tensor offloading', country: 'US', language: 'en', source: 'serp', exact: true, complete: true, rank: 8,
    period: { id: 'old', label: 'original old period', originalTargetCount: 1, originalQueryCount: 1 }, checkedAt: '2026-10-19T00:00:00Z' }];
  assert.deepEqual(reviewGrowthHistoricalPeriods(ranks, [], proofs), reviewGrowthHistoricalPeriods(ranks, [], []));
  assert.equal(auditedHumanWordLanguages([...db.sources.values()], [...db.audits.values()].map(row => ({ ...row, summary: { ...row.summary, receiptHash: '0'.repeat(64) } }))).length, 0);
});
test('the source planner cannot mark an incomplete list as1600 or initialize outside the exact original selection', () => {
  const value = review(); assert.equal(preFreezeCommandSchema.safeParse({ action: 'preview_identities', requestId: 'test', review: { ...value, selection: { ...value.selection, members: value.selection.members.slice(1) } } }).success, false);
  const command = preFreezeCommandSchema.parse({ action: 'preview_identities', requestId: 'test', review: value });
  const state = { members: db.members, topics: db.topics, sites: db.sites, sources: [], proofAudits: [], quarter: db.quarter };
  const outside = copy(command); outside.review.assignments[0].keywordId = 'not-original';
  assert.throws(() => planPreFreezeIdentities(outside, state, now), { code: 'outside_selection' });
  assert.equal(db.audits.size, 0);
});
test('historical unknown metric time is an exact human exception, stays null in audit and cannot relax language time, demand or market protection', async () => {
  const value = review(), item = value.assignments[0];
  item.demand.observedAt = null;
  await assert.rejects(prepare(value), { code: 'historical_time_exception_required' }); assert.equal(writes.length, 0);
  item.demand.historicalTimeUnknown = { acknowledgement: 'historical-time-unknown', selectionSourceHash: value.selection.sourceHash,
    keyword: item.keyword, country: item.country, language: item.language, sourceSha256: item.demand.sha256,
    reason: 'Explicitly reviewed historical positive demand cache; actual metric collection time remains unknown and is not this human review time.' };
  const { command, result } = await prepare(value); assert.equal(result.historicalTimeUnknown[0].observedAt, null);
  await assert.rejects(savePreFreezeIdentities(command, 'human', now), { code: 'historical_time_ack_required' }); assert.equal(writes.length, 0);
  await assert.rejects(savePreFreezeIdentities({ ...command, historicalTimeUnknownAcknowledged: true }, 'collector', now), { status: 403 });
  for (const change of [{ selectionSourceHash: '0'.repeat(64) }, { sourceSha256: '0'.repeat(64) }, { keyword: 'another original word' }, { country: 'JP' }, { language: 'ja' }]) {
    const invalid = copy(value); Object.assign(invalid.assignments[0].demand.historicalTimeUnknown, change);
    await assert.rejects(prepare(invalid), { code: 'historical_time_exception_required' }); assert.equal(writes.length, 0);
  }
  const noLanguageTime = copy(value); noLanguageTime.assignments[0].wordLanguage.observedAt = null;
  await assert.rejects(prepare(noLanguageTime)); assert.equal(writes.length, 0);
  const noDemand = copy(value); noDemand.assignments[0].demand.value = 0;
  await assert.rejects(prepare(noDemand)); assert.equal(writes.length, 0);
  const known = copy(value); known.assignments[0].demand.observedAt = '2026-11-23T10:00:00Z';
  await assert.rejects(prepare(known), { code: 'unexpected_time_exception' }); assert.equal(writes.length, 0);
  const applied = await savePreFreezeIdentities({ ...command, historicalTimeUnknownAcknowledged: true }, 'human', now);
  assert.equal(applied.receipt.historicalTimeUnknownAcknowledged, true);
  assert.equal(applied.receipt.historicalTimeUnknown[0].observedAt, null);
  assert.deepEqual(applied.receipt.historicalTimeUnknown[0].selectionSourceHash, value.selection.sourceHash);
  const market = db.sources.get('flatkey.ai:SEO_MARKET_ASSIGNMENT:keyword:keyword-0');
  assert.equal(market.snapshot.reviewedAt, now.toISOString()); assert.match(market.snapshot.evidence, /Historical metric time unknown/);
  assert.match(market.snapshot.evidence, /not metric collection/); assert.equal(applied.receipt.results[0].demandObservedAt, null);
});
test('a real demand calendar date preserves day precision and its original bytes without manufacturing midnight or expanding unknown-time exceptions', async () => {
  const value = review(), item = value.assignments[0], content = item.demand.content + '\nOriginal source date: 2026/10/10';
  Object.assign(item.demand, evidence(content), { observedAt: '2026-10-10', timePrecision: 'day', observedAtOriginal: '2026/10/10' });
  const { command, result } = await prepare(value); assert.deepEqual(result.historicalTimeUnknown, []);
  const applied = await savePreFreezeIdentities(command, 'human', now);
  assert.equal(applied.receipt.results[0].demandObservedAt, '2026-10-10'); assert.equal(applied.receipt.results[0].demandObservedAtOriginal, '2026/10/10');
  assert.equal(applied.receipt.results[0].demandTimePrecision, 'day'); assert.equal(applied.receipt.historicalTimeUnknownAcknowledged, false);
  const source = db.sources.get('flatkey.ai:SEO_MARKET_ASSIGNMENT:keyword:keyword-0'); assert.match(source.snapshot.evidence, /day precision; original=2026\/10\/10/); assert.doesNotMatch(source.snapshot.evidence, /2026-10-10T00:00/);
  for (const change of [{ timePrecision: 'instant' }, { observedAtOriginal: '2026/10/11' }, { observedAtOriginal: '2026-10-10' }]) {
    const invalid = copy(value); Object.assign(invalid.assignments[0].demand, change); await assert.rejects(prepare(invalid), { code: 'day_precision_required' });
  }
  const badLanguage = copy(value); badLanguage.assignments[0].wordLanguage.observedAt = '2026-10-10'; await assert.rejects(prepare(badLanguage));
});
test('English endpoint base URL and explicitly expanded German KI are precise lexical contexts, not a blanket model or acronym exemption', async () => {
  function lexical(word, country, language, spanText, languageQuote) {
    db.members[0].keyword.text = word; const value = review(), item = value.assignments[0]; item.country = country; item.language = language;
    item.demand = { ...evidence(JSON.stringify({ keyword: word, volume: 10, country })), exactKeyword: word, country, language, metric: 'monthly_searches', value: 10 };
    const start = word.indexOf(spanText); item.wordLanguage = { ...evidence(languageQuote), language, spans: [{ text: spanText, start, end: start + spanText.length }], reason: 'Human reviewed exact original lexical context from the cited language source, not the query locale.' }; return value;
  }
  for (const word of ['openai api base url', 'grok api base url', 'gemini api base url', 'claude api base url', 'gemini base url', 'kimi base url', 'mistral base url']) {
    await prepare(lexical(word, 'US', 'en', 'base', `The English endpoint phrase '${word}' uses base URL for its endpoint address.`));
  }
  await assert.rejects(prepare(lexical('llama base', 'US', 'en', 'base', 'llama base is a shared model base name, not an endpoint.')), { code: 'neutral_word_language' });
  for (const word of ['is claude openai compatible', 'is gemini api openai compatible']) {
    await assert.rejects(prepare(lexical(word, 'US', 'en', 'is', `The original English compatibility question is '${word}'.`)), { code: 'neutral_word_language' });
    await prepare(lexical(word, 'US', 'en', 'compatible', `The original English compatibility question is '${word}'; compatible expresses interoperability.`));
  }
  await prepare(lexical('ki api', 'DE', 'de', 'ki', 'Die deutsche Abkürzung KI bezeichnet Künstliche Intelligenz; der Originalbegriff lautet ki api.'));
  await assert.rejects(prepare(lexical('ki api', 'DE', 'de', 'ki', 'The query ki api was sent with German locale only.')), { code: 'neutral_word_language' });
  await assert.rejects(prepare(lexical('ki api', 'US', 'en', 'ki', 'KI bezeichnet Künstliche Intelligenz; der Begriff lautet ki api.')), { code: 'neutral_word_language' });
  await assert.rejects(prepare(lexical('ki model', 'DE', 'de', 'ki', 'KI bezeichnet Künstliche Intelligenz; der Begriff lautet ki model.')), { code: 'neutral_word_language' });
});
test('null identity first-freeze closes only after source apply and explicit stable-ID plan refresh; no implicit freeze or old draft rewrite', async () => {
  const { buildGrowthWorkspace } = require('../src/lib/growth-workspace.ts');
  const { emptyGrowthStrategy, prepareGrowthStrategyMutation, growthWorkspaceIdentity } = require('../src/lib/growth-strategy.ts');
  const { allocateIntegerBudget, BUSINESS_DELIVERY_WEIGHTS, MARKET_RESEARCH_WEIGHTS } = require('../src/lib/growth-quarter-planning.ts');
  const { rebindInitialQuarterPlan } = require('../src/lib/pre-freeze-identities-client.ts');
  const currentWorkspace = () => buildGrowthWorkspace({ generatedAt: now.toISOString(), topics: [{ id: 'topic1', text: 'GPU rental', active: true, sites: ['flatkey.ai'] }],
    memberships: db.members.map((member, i) => ({ site: member.siteDomain, keywordId: member.keywordId, keyword: member.keyword.text, active: true, keywordActive: true,
      topicId: 'topic1', pool: 'FORMAL', origin: 'PLANNED', targetUrls: [], marketAssignment: i ? { primaryCountry: 'US', language: 'en', secondaryMarkets: [], evidence: 'Original local English review before this operation', reviewedAt: '2026-11-23T10:00:00Z' } : db.sources.get('flatkey.ai:SEO_MARKET_ASSIGNMENT:keyword:keyword-0')?.snapshot })),
    wordLanguageEvidence: auditedHumanWordLanguages([...db.sources.values()], [...db.audits.values()]), tasks: [], publications: [], inventory: [], ranks: [] });
  const before = currentWorkspace(), sourceVersion = growthWorkspaceIdentity(before);
  const plan = { version: 'quarter-planning-v2', targetUnit: 'normalized_original_word', sourceVersion, title: 'Exact original quarterly GPU and API plan', targetIds: before.targets.map(row => row.id),
    artifact: { reference: '/reviewed/exact-plan.json', sha256: 'a'.repeat(64) }, executionStart: '2026-11-25', executionEnd: '2027-02-05',
    workstreams: [{ id: 'gpu', title: 'GPU growth original direction', bucket: 'gpu', topicIds: ['topic1'], taskIds: [], rationale: 'Use actual existing local GPU demand and original topic identity', verification: 'Original page delivery and seven fourteen twenty eight day observations', evidenceReferences: ['/reviewed/local.json'] }],
    researchBudget: { total: 100, counts: allocateIntegerBudget(100, MARKET_RESEARCH_WEIGHTS) }, deliveryBudget: { total: 100, counts: allocateIntegerBudget(100, BUSINESS_DELIVERY_WEIGHTS) }, reservedOriginalTaskIds: [], limitations: ['Paid data and final directions still need their own exact approvals.'] };
  plan.workstreams.push({ ...plan.workstreams[0], id: 'api', title: 'Original API secondary direction', bucket: 'api' });
  const mutate = (state, command, workspace) => prepareGrowthStrategyMutation(state, { requestId: 'normal-strategy-test', expectedVersion: state.version, ...command }, 'human', workspace, [], [], now);
  const old = mutate(emptyGrowthStrategy(), { action: 'save_quarter_plan', plan }, before);
  assert.throws(() => mutate(old, { action: 'approve_quarter_plan', hash: old.quarterPlanning.hash, sourceVersion, reason: 'Human reviewed the exact full plan and original selection' }, before), { code: 'ineligible_target' });
  db.quarter.payload = copy(old); const originalQuarter = copy(db.quarter), { command } = await prepare();
  await savePreFreezeIdentities(command, 'human', now); assert.deepEqual(db.quarter, originalQuarter); assert.equal(old.baseline, null);
  const after = currentWorkspace(); assert.notEqual(after.targets.find(row => row.keywordId === 'keyword-0').id, before.targets.find(row => row.keywordId === 'keyword-0').id);
  assert.throws(() => mutate(old, { action: 'approve_quarter_plan', hash: old.quarterPlanning.hash, sourceVersion, reason: 'Old source cannot approve the new current target identities' }, after), { code: 'quarter_plan_changed' });
  const refreshedPlan = rebindInitialQuarterPlan(old.quarterPlanning.plan, command.review, after.targets, growthWorkspaceIdentity(after));
  assert.deepEqual({ ...refreshedPlan, targetIds: plan.targetIds, sourceVersion }, plan);
  const freshDraft = mutate(old, { action: 'save_quarter_plan', plan: refreshedPlan }, after); assert.equal(freshDraft.baseline, null);
  const approved = mutate(freshDraft, { action: 'approve_quarter_plan', hash: freshDraft.quarterPlanning.hash, sourceVersion: growthWorkspaceIdentity(after), reason: 'Separate human approval of refreshed complete current quarter plan' }, after);
  assert.equal(approved.baseline.targets.length, 1600); assert.equal(old.baseline, null); assert.deepEqual(db.quarter, originalQuarter);
});

test('new quarter identity admits real Ahrefs evidence under the old frozen cohort and preserves it', async () => {
  db.members = db.members.slice(0, 1000);
  db.quarter.status = 'frozen';
  db.quarter.payload.baseline = { frozenAt: now.toISOString(), targets: Array.from({ length: 1600 }, (_, i) => ({ keyword: 'old term ' + i })) };
  const value = review();
  value.selection.version = 'quarter-membership-v2';
  value.selectionHash = hash(value.selection);
  await assert.rejects(prepare(value), { code: 'ahrefs_exact_source_required' });
  value.assignments[0].demand.reference = 'https://app.ahrefs.com/keywords-explorer/list/new/test/google/us/ideas/matchingTerms';
  const { command } = await prepare(value), old = copy(db.quarter);
  const saved = await savePreFreezeIdentities(command, 'human', now);
  assert.equal(saved.currentStateVerified, true);
  assert.deepEqual(db.quarter, old);
  assert.equal(saved.receipt.createdSourceRows, 2);
});
