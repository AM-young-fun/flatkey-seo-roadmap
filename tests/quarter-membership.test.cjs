const assert = require('node:assert/strict'), { test, beforeEach } = require('node:test'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), load = Module._load;
let state, writes, session, routeReads, updateCalls, beforeUpdate, forcedCount;
const copy = value => JSON.parse(JSON.stringify(value));
const topic = { id: 'real-topic', text: '模型API真实成本', active: true, sites: [{ siteDomain: 'flatkey.ai' }, { siteDomain: 'modelfit.cc' }] };
const selection = () => ({ version: 'quarter-membership-v1', quarterId: '2026-close', sourceReference: '/saved/exact-1600-source.json', sourceHash: 'a'.repeat(64), members: Array.from({ length: 1600 }, (_, i) => ({ siteDomain: 'flatkey.ai', keywordId: 'word-' + i, keyword: 'model api original word ' + i, topicId: topic.id })) });
const rows = sel => sel.members.map(row => ({ siteDomain: row.siteDomain, keywordId: row.keywordId, topicId: row.topicId, active: true, pool: 'RESEARCH', reviewStatus: 'UNREVIEWED', protected: true, curationId: 'old-audit', targetUrls: ['https://flatkey.ai/blog/original'], candidateUrls: [], keyword: { id: row.keywordId, text: row.keyword, active: true, updatedAt: '2026-11-24T01:00:00Z' }, topicAssignments: [], origin: 'PLANNED' }));
const tx = {
  $executeRaw: async () => 1,
  siteKeyword: { findMany: async () => copy(state.rows).sort((a, b) => a.siteDomain.localeCompare(b.siteDomain) || a.keywordId.localeCompare(b.keywordId)), updateMany: async ({ where, data }) => {
    updateCalls.push(copy({ where, data })); if (beforeUpdate) beforeUpdate();
    const predicates = where.OR ?? [where];
    const matches = (row, p) => ['siteDomain', 'keywordId', 'active', 'pool', 'topicId', 'protected', 'reviewStatus', 'curationId'].every(key => row[key] === p[key])
      && JSON.stringify(row.targetUrls) === JSON.stringify(p.targetUrls.equals) && JSON.stringify(row.candidateUrls) === JSON.stringify(p.candidateUrls.equals) && row.keyword.active === p.keyword.active;
    const selected = state.rows.filter(row => predicates.some(p => matches(row, p)));
    for (const row of selected) { writes.push({ id: row.keywordId, data }); Object.assign(row, data); }
    return { count: forcedCount ?? selected.length };
  } },
  topic: { findMany: async () => copy(state.topics) }, seoSite: { findMany: async () => [{ domain: 'flatkey.ai', active: true }, { domain: 'modelfit.cc', active: true }] },
  keywordCurationAudit: { findUnique: async ({ where }) => state.audits.get(where.id) ?? null, create: async ({ data }) => { state.audits.set(data.id, { ...copy(data), appliedAt: new Date() }); return data; } },
};
const prisma = { $transaction: async action => { const oldRows = copy(state.rows), oldAudits = new Map(state.audits); try { return await action(tx); } catch (error) { state.rows = oldRows; state.audits = oldAudits; throw error; } } };
Module._load = function (name, parent, ...args) {
  if (name === 'server-only') return {};
  if (name === './growth-strategy' && parent?.filename.endsWith('/services/quarter-membership.ts')) return { readGrowthStrategy: async () => state.strategy };
  if (name === '@/lib/prisma') return { prisma };
  if (name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: 'test-cookie' }) }) };
  if (name === '@/lib/auth') return { AUTH_COOKIE_NAME: 'auth', isAuthEnabled: () => true, isValidAuthToken: async () => session };
  if (name === '@/lib/services/display-change') return { displayDataChanged: async () => {} };
  if (name === '@/lib/services/quarter-membership') return { saveQuarterMembership: async () => { routeReads++; return { status: 'PREVIEW' }; }, loadQuarterMembership: async () => { routeReads++; return {}; }, loadQuarterMembershipReceipt: async () => { routeReads++; return { status: 'APPLIED' }; } };
  if (name === '@/lib/services/pre-freeze-market-identities') return { savePreFreezeIdentities: async () => { routeReads++; return { status: 'IDENTITIES_PREVIEW', stored: false }; }, loadPreFreezeIdentityReceipt: async () => { routeReads++; return { replay: true }; } };
  if (name.startsWith('@/')) return load.call(this, path.join(root, 'src', name.slice(2)) + '.ts', parent, ...args);
  return load.call(this, name, parent, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { quarterMembershipSelectionSchema, canonicalQuarterSelection, planQuarterMembership } = require('../src/lib/quarter-membership.ts');
const { saveQuarterMembership, loadQuarterMembershipReceipt } = require('../src/lib/services/quarter-membership.ts');
const { POST, GET } = require('../src/app/api/keywords/quarter-membership/route.ts');
beforeEach(() => { state = { rows: rows(selection()), topics: [copy(topic)], audits: new Map() }; writes = []; updateCalls = []; beforeUpdate = undefined; forcedCount = undefined; session = false; routeReads = 0; });
test('exactly1600 original words include cross-site memberships once and reject duplicate IDs or changed source selection', () => {
  const sel = selection(); sel.members.push({ ...sel.members[0], siteDomain: 'modelfit.cc' });
  assert.equal(quarterMembershipSelectionSchema.safeParse(sel).success, true);
  assert.equal(quarterMembershipSelectionSchema.safeParse({ ...sel, members: sel.members.slice(1, -1) }).success, false);
  assert.equal(quarterMembershipSelectionSchema.safeParse({ ...sel, members: [...sel.members, sel.members[0]] }).success, false);
  assert.throws(() => planQuarterMembership({ action: 'preview', requestId: 'preview', selection: selection(), selectionHash: 'b'.repeat(64) }, state.rows, state.topics), { code: 'selection_changed' });
});
test('preview has no writes; apply changes only selected pools, retains complete identities and reads back an idempotent audit', async () => {
  const sel = selection(), original = copy(state.rows), preview = await saveQuarterMembership({ action: 'preview', requestId: 'human-exact-1600', selection: sel });
  assert.equal(preview.uniqueWords, 1600); assert.equal(writes.length, 0); assert.equal(state.audits.size, 0);
  const command = { action: 'apply', requestId: 'human-exact-1600', selection: sel, selectionHash: preview.selectionHash, expectedStateHash: preview.stateHash };
  const result = await saveQuarterMembership(command);
  assert.equal(result.readbackVerified, true); assert.equal(result.replay, false); assert.equal(writes.length, 1600); assert.equal(state.audits.size, 1);
  assert.equal(updateCalls.length, 1); assert.equal(updateCalls[0].where.OR.length, 1600);
  assert.ok(writes.every(write => JSON.stringify(write.data) === JSON.stringify({ pool: 'FORMAL' })));
  assert.deepEqual(state.rows, original.map(row => ({ ...row, pool: 'FORMAL' })));
  assert.equal((await saveQuarterMembership(command)).replay, true); assert.equal(writes.length, 1600);
  await assert.rejects(saveQuarterMembership({ ...command, expectedStateHash: 'b'.repeat(64) }), { code: 'idempotency_conflict' });
  assert.deepEqual(result.manifest, canonicalQuarterSelection(sel));
});
test('1060 guarded research rows use one update and retain the original540 formal rows and every old predicate', async () => {
  state.rows.slice(0, 540).forEach(row => row.pool = 'FORMAL');
  const original = copy(state.rows), sel = selection(), preview = await saveQuarterMembership({ action: 'preview', requestId: 'real-sized-1060', selection: sel });
  assert.equal(preview.changed, 1060);
  const result = await saveQuarterMembership({ action: 'apply', requestId: 'real-sized-1060', selection: sel, selectionHash: preview.selectionHash, expectedStateHash: preview.stateHash });
  assert.equal(result.changed, 1060); assert.equal(updateCalls.length, 1); assert.equal(updateCalls[0].where.OR.length, 1060); assert.equal(writes.length, 1060);
  const expected = original.filter(row => row.pool === 'RESEARCH').sort((a, b) => a.keywordId.localeCompare(b.keywordId)).map(row => ({ siteDomain: row.siteDomain, keywordId: row.keywordId, active: true, pool: 'RESEARCH', topicId: row.topicId, protected: row.protected, reviewStatus: row.reviewStatus, curationId: row.curationId, targetUrls: { equals: row.targetUrls }, candidateUrls: { equals: row.candidateUrls }, keyword: { active: true } }));
  assert.deepEqual(updateCalls[0].where.OR, expected);
  assert.deepEqual(state.rows.slice(0, 540), original.slice(0, 540));
  assert.deepEqual(state.rows, original.map(row => ({ ...row, pool: 'FORMAL' })));
});
test('a1059 bulk count rolls back the complete1060 approval and writes no audit', async () => {
  state.rows.slice(0, 540).forEach(row => row.pool = 'FORMAL');
  const original = copy(state.rows), sel = selection(), preview = await saveQuarterMembership({ action: 'preview', requestId: 'bulk-conflict-count', selection: sel }); forcedCount = 1059;
  await assert.rejects(saveQuarterMembership({ action: 'apply', requestId: 'bulk-conflict-count', selection: sel, selectionHash: preview.selectionHash, expectedStateHash: preview.stateHash }), { code: 'state_changed' });
  assert.equal(updateCalls.length, 1); assert.deepEqual(state.rows, original); assert.equal(state.audits.size, 0);
});
test('every per-row protection remains effective when one selected row changes after preview state was read', async () => {
  const edits = [row => row.active = false, row => row.pool = 'ARCHIVED', row => row.topicId = 'another-topic', row => row.protected = false, row => row.reviewStatus = 'changed', row => row.curationId = 'another-audit', row => row.targetUrls.push('https://flatkey.ai/blog/later'), row => row.candidateUrls.push('https://flatkey.ai/blog/later'), row => row.keyword.active = false];
  for (const [i, edit] of edits.entries()) {
    state = { rows: rows(selection()), topics: [copy(topic)], audits: new Map() }; state.rows.slice(0, 540).forEach(row => row.pool = 'FORMAL'); updateCalls = []; writes = [];
    const original = copy(state.rows), sel = selection(), preview = await saveQuarterMembership({ action: 'preview', requestId: 'bulk-guard-' + i, selection: sel }); beforeUpdate = () => edit(state.rows[600]);
    await assert.rejects(saveQuarterMembership({ action: 'apply', requestId: 'bulk-guard-' + i, selection: sel, selectionHash: preview.selectionHash, expectedStateHash: preview.stateHash }), { code: 'state_changed' });
    assert.equal(updateCalls.length, 1); assert.deepEqual(state.rows, original); assert.equal(state.audits.size, 0); beforeUpdate = undefined;
  }
});
test('an already formal exact selection uses no update statement but still verifies its complete audit', async () => {
  state.rows.forEach(row => row.pool = 'FORMAL'); const sel = selection(), preview = await saveQuarterMembership({ action: 'preview', requestId: 'no-missing-pool', selection: sel });
  const result = await saveQuarterMembership({ action: 'apply', requestId: 'no-missing-pool', selection: sel, selectionHash: preview.selectionHash, expectedStateHash: preview.stateHash });
  assert.equal(result.changed, 0); assert.equal(updateCalls.length, 0); assert.equal(result.readbackVerified, true);
});
test('changed membership and false or cross-site TopicMap evidence fail before pool writes', async () => {
  const sel = selection(), preview = await saveQuarterMembership({ action: 'preview', requestId: 'before-change', selection: sel });
  state.rows[0].targetUrls.push('https://flatkey.ai/blog/subsequent');
  await assert.rejects(saveQuarterMembership({ action: 'apply', requestId: 'changed-original', selection: sel, selectionHash: preview.selectionHash, expectedStateHash: preview.stateHash }), { code: 'state_changed' });
  assert.equal(writes.length, 0);
  for (const badTopic of [{ ...topic, active: false }, { ...topic, text: '自然搜索发现' }, { ...topic, sites: [{ siteDomain: 'rackrate.org' }] }]) assert.throws(() => planQuarterMembership({ action: 'preview', requestId: 'invalid-topic', selection: sel }, state.rows, [badTopic]), { code: 'topic_relation_missing' });
  state.rows[0].active = false;
  assert.throws(() => planQuarterMembership({ action: 'preview', requestId: 'inactive', selection: sel }, state.rows, state.topics), { code: 'inactive_member' });
});
test('an audit replay never overwrites later library edits', async () => {
  const sel = selection(), preview = await saveQuarterMembership({ action: 'preview', requestId: 'with-later-change', selection: sel });
  const command = { action: 'apply', requestId: 'with-later-change', selection: sel, selectionHash: preview.selectionHash, expectedStateHash: preview.stateHash };
  await saveQuarterMembership(command); state.rows[0].targetUrls = ['https://flatkey.ai/blog/later'];
  await assert.rejects(saveQuarterMembership(command), { code: 'readback_changed' }); assert.equal(writes.length, 1600);
});
test('exact original membership receipt reads its human audit and all current members without another pool mutation', async () => {
  const sel = selection(), preview = await saveQuarterMembership({ action: 'preview', requestId: 'exact-receipt', selection: sel });
  await saveQuarterMembership({ action: 'apply', requestId: 'exact-receipt', selection: preview.manifest, selectionHash: preview.selectionHash, expectedStateHash: preview.stateHash });
  const count = writes.length, original = await loadQuarterMembershipReceipt('exact-receipt'); assert.equal(original.requestId, 'exact-receipt'); assert.equal(original.actor, 'human'); assert.equal(original.readbackVerified, true);
  assert.equal(writes.length, count); state.rows[0].targetUrls.push('https://flatkey.ai/blog/later-change');
  assert.equal((await loadQuarterMembershipReceipt('exact-receipt')).readbackVerified, false); assert.equal(writes.length, count);
  await assert.rejects(loadQuarterMembershipReceipt('never-applied'), { status: 404 });
});
test('route rejects collectors, missing human login and foreign origin before any source access', async () => {
  const url = 'https://seo.test/api/keywords/quarter-membership';
  const post = headers => POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ action: 'preview' }) }));
  assert.equal((await post({ origin: 'https://seo.test', authorization: 'Bearer collector' })).status, 403);
  assert.equal((await GET(new Request(url))).status, 403); session = true;
  assert.equal((await post({ origin: 'https://other.test' })).status, 403); assert.equal(routeReads, 0);
  assert.equal((await post({ origin: 'https://seo.test' })).status, 200); assert.equal(routeReads, 1);
});
test('pre-freeze identity actions use the same real human origin gate and expose only normal original-receipt reads', async () => {
  const url = 'https://seo.test/api/keywords/quarter-membership';
  const post = headers => POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ action: 'preview_identities' }) }));
  assert.equal((await post({ origin: 'https://seo.test' })).status, 403);
  session = true; assert.equal((await post({ origin: 'https://seo.test', authorization: 'Bearer collector' })).status, 403);
  assert.equal((await post({ origin: 'https://other.test' })).status, 403); assert.equal(routeReads, 0);
  assert.equal((await post({ origin: 'https://seo.test' })).status, 200); assert.equal(routeReads, 1);
  assert.equal((await GET(new Request(url + '?identityRequestId=human-original'))).status, 200); assert.equal(routeReads, 2);
  assert.equal((await GET(new Request(url + '?membershipRequestId=human-original'))).status, 200); assert.equal(routeReads, 3);
  assert.equal((await GET(new Request(url + '?membershipRequestId=human-original', { headers: { authorization: 'Bearer collector' } }))).status, 403); assert.equal(routeReads, 3);
  assert.equal(writes.length, 0);
});

test('a new 1000-word membership uses separate proof and leaves the frozen 1600 unchanged', async () => {
  const old = selection(), legacy = { frozenAt: '2026-11-24T10:00:00Z', targets: old.members.map(row => ({ keyword: row.keyword })) };
  const sel = { ...old, version: 'quarter-membership-v2', members: old.members.slice(0, 1000).map(row => ({ ...row, keyword: 'new ' + row.keyword })) };
  state.rows = rows(sel);
  state.strategy = { baseline: legacy };
  assert.equal(quarterMembershipSelectionSchema.safeParse(sel).success, true);
  assert.equal(quarterMembershipSelectionSchema.safeParse({ ...sel, members: sel.members.slice(1) }).success, false);
  assert.equal(quarterMembershipSelectionSchema.safeParse({ ...sel, members: [...sel.members, { ...sel.members[0], siteDomain: 'modelfit.cc' }] }).success, false);
  const requestId = 'new-exact-1000';
  const preview = await saveQuarterMembership({ action: 'preview', requestId, selection: sel });
  assert.equal(preview.uniqueWords, 1000);
  await saveQuarterMembership({ action: 'apply', requestId, selection: preview.manifest, selectionHash: preview.selectionHash, expectedStateHash: preview.stateHash });
  assert.equal(state.audits.values().next().value.status, 'QUARTER_NEW_WORD_MEMBERSHIP_APPLIED');
  assert.equal((await loadQuarterMembershipReceipt(requestId)).uniqueWords, 1000);
  assert.deepEqual(state.strategy.baseline, legacy);
  const reuse = { ...sel, members: [old.members[0], ...sel.members.slice(1)] };
  await assert.rejects(saveQuarterMembership({ action: 'preview', requestId: 'reuse-old', selection: reuse }), { code: 'new_quarter_reuses_old_word' });
});

test('the Ahrefs staging contract binds the original exported CSV row, market, language, and local demand', () => {
  const { quarterWordResearchProblem, quarterWordResearchSchema } = require('../src/lib/quarter-word-research.ts');
  const row = {
    siteDomain: 'flatkey.ai', topicId: topic.id, keyword: '大模型微调', country: 'SG', language: 'zh-CN', volume: 50,
    sourceUrl: 'https://app.ahrefs.com/keywords-explorer/list/new/example/google/sg/ideas/matchingTerms',
    sourceFile: 'google_sg_example.csv', sourceSha256: 'a'.repeat(64), sourceRow: 56, observedAt: '2026-11-25T14:55:16+08:00',
    excerpt: '#,Keyword,Country,Volume,Languages\n56,大模型微调,sg,50,Chinese',
  };
  const time = new Date('2026-11-25T12:00:00Z');
  assert.equal(quarterWordResearchSchema.safeParse({ action: 'stage_new_words', requestId: 'exact', rows: [row] }).success, true);
  assert.equal(quarterWordResearchProblem(row, time), null);
  for (const patch of [{ language: 'en' }, { sourceRow: 55 }, { volume: 55 }, { keyword: '微调大模型' },
    { excerpt: row.excerpt + '\n57,另一词,sg,100,Chinese' },
    { sourceUrl: row.sourceUrl.replace('app.ahrefs.com', 'ahrefs.example') },
    { sourceUrl: row.sourceUrl.replace('/google/sg/', '/google/us/') }]) {
    assert.ok(quarterWordResearchProblem({ ...row, ...patch }, time));
  }
});
