const { test, beforeEach } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), load = Module._load;
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const copy = value => structuredClone(value), key = (site, id) => `${site}:${id}`;
let state, writes, queries, transactions, session, collector, localPreview, failAudit, corruptAfter, displayInvalidations;
const tx = {
  $executeRaw: async strings => { queries.push(strings.join('?')); return 1; },
  $queryRaw: async strings => { queries.push(strings.join('?')); return []; },
  seoSite: { findUnique: async ({ where }) => copy(state.sites.get(where.domain) ?? null) },
  keyword: { findUnique: async ({ where }) => copy(state.keywords.get(where.id) ?? null) },
  siteKeyword: { findUnique: async ({ where }) => { const w = where.siteDomain_keywordId; return copy(state.members.get(key(w.siteDomain, w.keywordId)) ?? null); } },
  topic: { findUnique: async ({ where }) => copy(state.topics.get(where.id) ?? null),
    findMany: async ({ where }) => copy([...state.topics.values()].filter(topic => where.id.in.includes(topic.id)).map(({ id, text }) => ({ id, text }))) },
  siteTopic: { findUnique: async ({ where }) => { const w = where.siteDomain_topicId; return copy(state.siteTopics.get(key(w.siteDomain, w.topicId)) ?? null); } },
  siteKeywordTopic: {
    findMany: async ({ where }) => copy(state.edges.filter(edge => edge.siteDomain === where.siteDomain && edge.keywordId === where.keywordId)),
    upsert: async ({ where, create, update }) => {
      assert.deepEqual(update, {}); assert.deepEqual(where.siteDomain_keywordId_topicId, create);
      if (!state.edges.some(edge => JSON.stringify(edge) === JSON.stringify(create))) state.edges.push(copy(create));
      writes.push({ kind: 'one-edge', create: copy(create), update });
      if (corruptAfter) state.members.get(key('flatkey.ai', 'word-1')).pool = 'FORMAL';
      return copy(create);
    },
  },
  keywordCurationAudit: {
    findUnique: async ({ where }) => {
      const audit = copy(state.audits.get(where.id) ?? null);
      if (audit && failAudit === 'readback') audit.summary.receiptHash = '0'.repeat(64);
      return audit;
    },
    create: async ({ data }) => {
      if (failAudit === 'create') throw Error('fixture_audit_create_failed');
      assert.equal(state.audits.has(data.id), false);
      state.audits.set(data.id, copy(data)); writes.push({ kind: 'audit', id: data.id }); return copy(data);
    },
  },
};
const prisma = {
  keywordCurationAudit: tx.keywordCurationAudit,
  $transaction: async (action, options) => {
    transactions++; assert.ok(['RepeatableRead', 'Serializable'].includes(options.isolationLevel));
    const before = copy(state), previousWrites = writes.length;
    try { return await action(tx); } catch (error) { state = before; writes.splice(previousWrites); throw error; }
  },
};
Module._load = function (name, parent, ...rest) {
  if (name === 'server-only') return {};
  if (name === '@/lib/prisma') return { prisma };
  if (name === '@/lib/services/display-change') return { displayDataChanged: async () => { displayInvalidations++; } };
  if (parent?.filename.endsWith('/seo-workflow-http.ts') && name === './seo-analytics-access') return {
    analyticsLocalPreview: () => localPreview, authorizeAnalyticsRead: async () => session || localPreview,
    privateAnalyticsHeaders: { 'Cache-Control': 'private, no-store' },
  };
  if (parent?.filename.endsWith('/seo-workflow-http.ts') && name === './services/import-tokens') return {
    authenticateImportToken: async () => collector,
  };
  if (name.startsWith('@/')) return load.call(this, path.join(root, 'src', name.slice(2)) + '.ts', parent, ...rest);
  return load.call(this, name, parent, ...rest);
};
const { previewTopicAssociation, prepareTopicAssociation, associationHash } = require('../src/lib/site-topic-association.ts');
const { loadTopicAssociationPreview, loadTopicAssociationReceipt, saveTopicAssociation } = require('../src/lib/services/site-topic-association.ts');
const { GET, POST } = require('../src/app/api/keywords/topic-associations/route.ts');
const identity = { siteDomain: 'flatkey.ai', keywordId: 'word-1', keyword: 'moe expert streaming', topicId: 'real-topic' };
function pureState(topicId = 'real-topic') {
  return { site: state.sites.get('flatkey.ai'), keyword: state.keywords.get('word-1'), member: state.members.get(key('flatkey.ai', 'word-1')) ?? null,
    topic: state.topics.get(topicId), siteTopic: state.siteTopics.get(key('flatkey.ai', topicId)) ?? null, assignments: state.edges.filter(edge => edge.siteDomain === 'flatkey.ai') };
}
async function command(requestId = 'topic-association:test-1', topicId = 'real-topic') {
  const original = { ...identity, topicId }, preview = await loadTopicAssociationPreview(original, 'human');
  return { ...original, action: 'add', requestId, expectedStateHash: preview.stateHash };
}
beforeEach(() => {
  const member = { siteDomain: 'flatkey.ai', keywordId: 'word-1', topicId: 'candidate-container', origin: 'RESEARCH', active: true,
    exclusionReason: null, excludedAt: null, restoredAt: null, targetUrls: ['https://flatkey.ai/blog/original'], sourceUrl: 'https://official.test/source',
    pool: 'RESEARCH', reviewStatus: 'UNREVIEWED', mappingStatus: 'UNMAPPED', candidateUrls: ['https://flatkey.ai/blog/old-candidate'],
    auditReason: 'original research', protected: true, curatedAt: null, curationId: 'old-curation', createdAt: '2026-11-23T07:00:14.348Z' };
  state = { sites: new Map([['flatkey.ai', { domain: 'flatkey.ai', name: 'Flatkey', active: true, ga4PropertyId: '541304395', initializedAt: '2026-01-01T00:00:00Z' }]]),
    keywords: new Map([['word-1', { id: 'word-1', text: identity.keyword, type: 'SUB', active: true, defaultVolume: 300,
      topicId: 'modelfit-original-global-topic', parentId: 'modelfit-original-parent', lastSyncedAt: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z' }]]),
    members: new Map([[key('flatkey.ai', 'word-1'), member], [key('modelfit.cc', 'word-1'), { ...copy(member), siteDomain: 'modelfit.cc', pool: 'FORMAL', topicId: 'mf-topic' }]]),
    topics: new Map(['real-topic', 'second-topic'].map(id => [id, { id, text: id === 'real-topic' ? 'LLM GPU memory requirements' : 'Mixture of experts inference',
      active: true, type: 'SUB', parentId: 'original-topic-parent', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z' }])),
    siteTopics: new Map(['real-topic', 'second-topic'].map(topicId => [key('flatkey.ai', topicId), { siteDomain: 'flatkey.ai', topicId }])),
    edges: [{ siteDomain: 'flatkey.ai', keywordId: 'word-1', topicId: 'candidate-container' }, { siteDomain: 'modelfit.cc', keywordId: 'word-1', topicId: 'mf-topic' }], audits: new Map() };
  writes = []; queries = []; transactions = 0; session = false; collector = false; localPreview = false; failAudit = null; corruptAfter = false; displayInvalidations = 0;
});

test('pure preview and add preserve every scalar, original parent and old edges and only append one same-site edge', () => {
  const original = copy(pureState()), preview = previewTopicAssociation(identity, original, 'human');
  const plan = prepareTopicAssociation({ ...identity, action: 'add', requestId: 'topic-association:pure', expectedStateHash: preview.stateHash }, original, 'human');
  assert.equal(plan.createdEdge, true); assert.equal(plan.after.assignments.length, original.assignments.length + 1);
  for (const field of ['site', 'keyword', 'member', 'topic', 'siteTopic']) assert.deepEqual(plan.after[field], original[field]);
  assert.ok(plan.after.assignments.some(edge => edge.topicId === 'candidate-container'));
  assert.deepEqual(original, pureState());
  assert.throws(() => prepareTopicAssociation({ ...plan.command, actor: 'human' }, original, 'human'));
  assert.equal(writes.length, 0);
});
test('normal transaction adds exactly one edge and audit; repeated request returns original receipt without changing anything', async () => {
  const input = await command(), before = copy(state), fixedTime = new Date('2026-11-24T12:00:00Z');
  const result = await saveTopicAssociation(input, 'human', fixedTime);
  assert.equal(result.receipt.createdEdge, true); assert.equal(result.replay, false); assert.equal(result.currentStateVerified, true);
  assert.equal(state.edges.length, before.edges.length + 1); assert.equal(state.audits.size, 1);
  for (const field of ['sites', 'keywords', 'members', 'topics', 'siteTopics']) assert.deepEqual(state[field], before[field]);
  assert.ok(before.edges.every(edge => state.edges.some(actual => JSON.stringify(actual) === JSON.stringify(edge))));
  assert.deepEqual(writes.map(x => x.kind), ['one-edge', 'audit']);
  const replay = await saveTopicAssociation(input, 'human', new Date('2026-11-25T12:00:00Z'));
  assert.equal(replay.replay, true); assert.equal(replay.currentStateVerified, false); assert.deepEqual(replay.receipt, result.receipt);
  assert.equal(writes.length, 2); assert.equal(replay.receipt.appliedAt, fixedTime.toISOString());
  assert.ok(queries.some(sql => sql.includes('SiteKeyword') && sql.includes('FOR UPDATE')));
  assert.ok(queries.some(sql => sql.includes('SiteTopic') && sql.includes('FOR SHARE')));
  assert.ok(queries.some(sql => sql.includes('SiteKeywordTopic') && sql.includes('FOR UPDATE')));
});
test('same request with another payload fails 409 and later library edits cannot turn a replay into a new write', async () => {
  const input = await command(), result = await saveTopicAssociation(input, 'human');
  state.members.get(key('flatkey.ai', 'word-1')).sourceUrl = 'https://official.test/later';
  state.edges.push({ siteDomain: 'flatkey.ai', keywordId: 'word-1', topicId: 'second-topic' });
  const before = copy(state), replay = await saveTopicAssociation(input, 'human');
  assert.deepEqual(replay.receipt, result.receipt); assert.equal(replay.currentStateVerified, false); assert.deepEqual(state, before);
  assert.deepEqual((await loadTopicAssociationReceipt(input.requestId, 'human')).receipt, result.receipt);
  await assert.rejects(saveTopicAssociation({ ...input, expectedStateHash: 'b'.repeat(64) }, 'human'), { code: 'association_request_conflict', status: 409 });
  await assert.rejects(saveTopicAssociation({ ...input, siteDomain: 'modelfit.cc' }, 'human'), { code: 'association_request_conflict', status: 409 });
  assert.deepEqual(state, before); assert.equal(writes.length, 2);
});
test('an already-present exact edge is reused with one audit and zero edge writes', async () => {
  state.edges.push({ siteDomain: 'flatkey.ai', keywordId: 'word-1', topicId: 'real-topic' });
  const input = await command(), before = copy(state), result = await saveTopicAssociation(input, 'human');
  assert.equal(result.receipt.status, 'reused'); assert.equal(result.receipt.createdEdge, false);
  assert.deepEqual(state.edges, before.edges); assert.deepEqual(state.members, before.members);
  assert.deepEqual(writes.map(x => x.kind), ['audit']);
});
test('stale preview detects changes to protected fields, original word, active state, target topic and old edge list before writes', async () => {
  const input = await command(), original = copy(state);
  for (const mutate of [
    () => { state.keywords.get('word-1').text = 'another original word'; },
    () => { state.keywords.get('word-1').parentId = 'another-parent'; },
    () => { state.members.get(key('flatkey.ai', 'word-1')).pool = 'FORMAL'; },
    () => { state.members.get(key('flatkey.ai', 'word-1')).curationId = 'new-curation'; },
    () => { state.members.get(key('flatkey.ai', 'word-1')).targetUrls.reverse(); state.members.get(key('flatkey.ai', 'word-1')).targetUrls.push('https://flatkey.ai/new'); },
    () => { state.members.get(key('flatkey.ai', 'word-1')).active = false; },
    () => { state.topics.get('real-topic').updatedAt = '2026-11-24T13:00:00Z'; },
    () => { state.edges.push({ siteDomain: 'flatkey.ai', keywordId: 'word-1', topicId: 'second-topic' }); },
  ]) {
    state = copy(original); mutate(); const changed = copy(state);
    await assert.rejects(saveTopicAssociation(input, 'human'), { code: 'association_state_changed', status: 409 });
    assert.deepEqual(state, changed); assert.equal(writes.length, 0);
  }
});
test('two independently previewed additions cannot both consume the same old assignment state', async () => {
  const first = await command('topic-association:first'), second = await command('topic-association:second', 'second-topic');
  await saveTopicAssociation(first, 'human'); const before = copy(state);
  await assert.rejects(saveTopicAssociation(second, 'human'), { code: 'association_state_changed', status: 409 });
  assert.deepEqual(state, before); assert.equal(state.audits.size, 1);
});
test('collector, cross-site, missing member, inactive or placeholder sources are rejected with no mutation', async () => {
  const input = await command(), original = copy(state), count = transactions;
  await assert.rejects(saveTopicAssociation(input, 'collector'), { status: 403 }); assert.equal(transactions, count);
  for (const mutate of [
    () => state.siteTopics.delete(key('flatkey.ai', 'real-topic')),
    () => state.members.delete(key('flatkey.ai', 'word-1')),
    () => { state.sites.get('flatkey.ai').active = false; },
    () => { state.keywords.get('word-1').active = false; },
    () => { state.topics.get('real-topic').active = false; },
    () => { state.topics.get('real-topic').text = '自然搜索发现'; },
    () => { state.topics.get('real-topic').text = '候选容器'; },
  ]) {
    state = copy(original); mutate(); const changed = copy(state), fresh = { ...input, expectedStateHash: associationHash(pureState()) };
    await assert.rejects(saveTopicAssociation(fresh, 'human'), error => [404, 422].includes(error.status));
    assert.deepEqual(state, changed); assert.equal(writes.length, 0);
  }
  await assert.rejects(saveTopicAssociation({ ...input, siteDomain: 'rougecue.org' }, 'human'));
});
test('a protected-field readback mismatch or failed audit rolls back both the edge and audit', async () => {
  const input = await command(), original = copy(state);
  for (const failure of ['create', 'readback', 'protected-field']) {
    state = copy(original); failAudit = failure; corruptAfter = failure === 'protected-field';
    await assert.rejects(saveTopicAssociation(input, 'human'));
    assert.deepEqual(state, original); assert.equal(writes.length, 0);
  }
});
test('normal route requires human same-origin session and rejects collector/local-preview/foreign-origin before DB access', async () => {
  const url = 'https://seo.test/api/keywords/topic-associations', body = { ...identity, action: 'add', requestId: 'topic-association:route', expectedStateHash: associationHash(pureState()) };
  const post = (origin = 'https://seo.test', extra = {}) => POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify({ ...body, ...extra }) }));
  assert.equal((await post()).status, 401); assert.equal((await GET(new Request(url))).status, 401);
  collector = true; assert.equal((await post(null)).status, 403); session = true; assert.equal((await post(null)).status, 403);
  collector = false; assert.equal((await post('https://foreign.test')).status, 403); assert.equal((await post(null)).status, 403);
  localPreview = true; assert.equal((await GET(new Request(url))).status, 403); localPreview = false;
  assert.equal(transactions, 0); assert.equal(writes.length, 0);
  const response = await post(); assert.equal(response.status, 200); assert.equal((await response.json()).receipt.createdEdge, true);
  assert.equal(displayInvalidations, 1);
  assert.equal((await post()).status, 200); assert.equal(displayInvalidations, 1);
  const receipt = await GET(new Request(url + '?requestId=' + encodeURIComponent(body.requestId)));
  assert.equal(receipt.status, 200); assert.equal((await receipt.json()).currentStateVerified, false);
  assert.equal((await post('https://seo.test', { source: 'human' })).status, 400);
  assert.equal((await GET(new Request(url + '?requestId=' + encodeURIComponent(body.requestId) + '&siteDomain=flatkey.ai'))).status, 400);
});
