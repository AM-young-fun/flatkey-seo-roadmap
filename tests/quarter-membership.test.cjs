const assert = require('node:assert/strict'), { test, beforeEach } = require('node:test'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), load = Module._load;
let state, writes, session, routeReads;
const copy = value => JSON.parse(JSON.stringify(value));
const topic = { id: 'real-topic', text: '模型API真实成本', active: true, sites: [{ siteDomain: 'flatkey.ai' }, { siteDomain: 'modelfit.cc' }] };
const selection = () => ({ version: 'quarter-membership-v1', quarterId: '2026-close', sourceReference: '/saved/exact-1600-source.json', sourceHash: 'a'.repeat(64), members: Array.from({ length: 1600 }, (_, i) => ({ siteDomain: 'flatkey.ai', keywordId: 'word-' + i, keyword: 'model api original word ' + i, topicId: topic.id })) });
const rows = sel => sel.members.map(row => ({ siteDomain: row.siteDomain, keywordId: row.keywordId, topicId: row.topicId, active: true, pool: 'RESEARCH', reviewStatus: 'UNREVIEWED', protected: true, curationId: 'old-audit', targetUrls: ['https://flatkey.ai/blog/original'], candidateUrls: [], keyword: { id: row.keywordId, text: row.keyword, active: true, updatedAt: '2026-11-24T01:00:00Z' }, topicAssignments: [], origin: 'PLANNED' }));
const tx = {
  $executeRaw: async () => 1,
  siteKeyword: { findMany: async () => copy(state.rows).sort((a, b) => a.siteDomain.localeCompare(b.siteDomain) || a.keywordId.localeCompare(b.keywordId)), updateMany: async ({ where, data }) => { const row = state.rows.find(row => row.siteDomain === where.siteDomain && row.keywordId === where.keywordId && row.pool === where.pool); if (!row) return { count: 0 }; writes.push({ id: row.keywordId, data }); Object.assign(row, data); return { count: 1 }; } },
  topic: { findMany: async () => copy(state.topics) }, seoSite: { findMany: async () => [{ domain: 'flatkey.ai', active: true }, { domain: 'modelfit.cc', active: true }] },
  keywordCurationAudit: { findUnique: async ({ where }) => state.audits.get(where.id) ?? null, create: async ({ data }) => { state.audits.set(data.id, { ...copy(data), appliedAt: new Date() }); return data; } },
};
const prisma = { $transaction: async action => { const oldRows = copy(state.rows), oldAudits = new Map(state.audits); try { return await action(tx); } catch (error) { state.rows = oldRows; state.audits = oldAudits; throw error; } } };
Module._load = function (name, parent, ...args) {
  if (name === 'server-only') return {};
  if (name === '@/lib/prisma') return { prisma };
  if (name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: 'test-cookie' }) }) };
  if (name === '@/lib/auth') return { AUTH_COOKIE_NAME: 'auth', isAuthEnabled: () => true, isValidAuthToken: async () => session };
  if (name === '@/lib/services/display-change') return { displayDataChanged: async () => {} };
  if (name === '@/lib/services/quarter-membership') return { saveQuarterMembership: async () => { routeReads++; return { status: 'PREVIEW' }; }, loadQuarterMembership: async () => { routeReads++; return {}; } };
  if (name === '@/lib/services/pre-freeze-market-identities') return { savePreFreezeIdentities: async () => { routeReads++; return { status: 'IDENTITIES_PREVIEW', stored: false }; }, loadPreFreezeIdentityReceipt: async () => { routeReads++; return { replay: true }; } };
  if (name.startsWith('@/')) return load.call(this, path.join(root, 'src', name.slice(2)) + '.ts', parent, ...args);
  return load.call(this, name, parent, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { quarterMembershipSelectionSchema, canonicalQuarterSelection, planQuarterMembership } = require('../src/lib/quarter-membership.ts');
const { saveQuarterMembership } = require('../src/lib/services/quarter-membership.ts');
const { POST, GET } = require('../src/app/api/keywords/quarter-membership/route.ts');
beforeEach(() => { state = { rows: rows(selection()), topics: [copy(topic)], audits: new Map() }; writes = []; session = false; routeReads = 0; });
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
  assert.ok(writes.every(write => JSON.stringify(write.data) === JSON.stringify({ pool: 'FORMAL' })));
  assert.deepEqual(state.rows, original.map(row => ({ ...row, pool: 'FORMAL' })));
  assert.equal((await saveQuarterMembership(command)).replay, true); assert.equal(writes.length, 1600);
  await assert.rejects(saveQuarterMembership({ ...command, expectedStateHash: 'b'.repeat(64) }), { code: 'idempotency_conflict' });
  assert.deepEqual(result.manifest, canonicalQuarterSelection(sel));
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
  assert.equal(writes.length, 0);
});
