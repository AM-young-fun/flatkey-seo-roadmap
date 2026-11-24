const { test } = require('node:test'), assert = require('node:assert/strict');
require('./register-ui-modules.cjs');
const { createAssociationReview, associationBrowserTransport, associationIdentityQuery, AssociationRejected } = require('../src/lib/site-topic-association-client.ts');
const identity = { siteDomain: 'flatkey.ai', keywordId: 'word-1', keyword: 'moe expert streaming', topicId: 'real-topic' };
const before = 'a'.repeat(64), after = 'b'.repeat(64), requestId = 'topic-association:one-stable-operation';
const clone = value => structuredClone(value);
const edge = { siteDomain: identity.siteDomain, keywordId: identity.keywordId, topicId: identity.topicId };
const preview = (saved = false) => ({ identity: clone(identity), stateHash: saved ? after : before, edgeExists: saved,
  topicLabels: { 'old-topic': '自然搜索发现' }, state: { site: { domain: 'flatkey.ai', name: 'Flatkey', active: true },
    keyword: { id: 'word-1', topicId: 'old-topic' }, member: { topicId: 'old-topic' }, topic: { id: 'real-topic', text: 'LLM GPU memory requirements' },
    siteTopic: { siteDomain: identity.siteDomain, topicId: identity.topicId }, assignments: [{ ...edge, topicId: 'old-topic' }, ...(saved ? [edge] : [])] } });
const receipt = () => ({ receipt: { requestId, identity: clone(identity), beforeHash: before, afterHash: after,
  status: 'created', createdEdge: true, appliedAt: '2026-11-24T12:00:00Z' }, replay: false });
function fixture(patch = {}, initialPending = null) {
  const calls = [], seen = []; let pending = clone(initialPending), ids = 0;
  const store = { read: () => clone(pending), write: value => { pending = clone(value); calls.push('persist'); }, clear: () => { pending = null; calls.push('clear'); } };
  const transport = { preview: async () => { calls.push('preview'); return preview(calls.includes('add')); },
    add: async command => { calls.push('add'); assert.deepEqual(pending, command); return receipt(); },
    receipt: async () => { calls.push('receipt'); return receipt(); }, ...patch };
  const controller = createAssociationReview(identity, transport, store, () => { ids++; return requestId; }, view => seen.push(view));
  return { controller, calls, seen, pending: () => pending, ids: () => ids, transport, store };
}
test('only explicit preview then confirm can POST; source hash and one request ID are preserved through full readback', async () => {
  const f = fixture(); assert.equal(f.controller.snapshot().phase, 'idle'); assert.deepEqual(f.calls, []);
  await f.controller.confirm(); assert.deepEqual(f.calls, []);
  await f.controller.preview(); assert.equal(f.controller.snapshot().phase, 'ready'); assert.equal(f.ids(), 1);
  await f.controller.confirm(); assert.deepEqual(f.calls, ['preview', 'persist', 'add', 'preview', 'clear']);
  assert.equal(f.controller.snapshot().phase, 'saved'); assert.equal(f.controller.snapshot().receipt.createdEdge, true); assert.equal(f.pending(), null);
  await f.controller.confirm(); assert.equal(f.calls.filter(x => x === 'add').length, 1);
});
test('same-frame double confirmation cannot submit a second request while the first is in flight', async () => {
  let release, adds = 0; const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ preview: async () => preview(adds > 0), add: async () => { adds++; return pending; } });
  await f.controller.preview(); const first = f.controller.confirm(); await f.controller.confirm(); assert.equal(adds, 1);
  release(receipt()); await first; assert.equal(f.controller.snapshot().phase, 'saved'); assert.equal(adds, 1);
});
test('a lost response reconciles the original request and never repeats its POST', async () => {
  let saved = false, adds = 0, receipts = 0;
  const f = fixture({ preview: async () => preview(saved), add: async () => { adds++; saved = true; throw Error('network response lost'); },
    receipt: async id => { receipts++; assert.equal(id, requestId); return receipt(); } });
  await f.controller.preview(); await f.controller.confirm(); assert.equal(f.controller.snapshot().phase, 'saved'); assert.equal(adds, 1); assert.equal(receipts, 1);
});
test('unknown result without receipt blocks new preview and writes, including after a browser reload', async () => {
  let adds = 0;
  const f = fixture({ add: async () => { adds++; throw Error('network'); }, receipt: async () => null });
  await f.controller.preview(); await f.controller.confirm(); assert.equal(f.controller.snapshot().phase, 'uncertain'); assert.ok(f.pending());
  await f.controller.preview(); await f.controller.confirm(); assert.equal(adds, 1); assert.equal(f.ids(), 1);
  const restored = fixture({ preview: async () => preview(true), add: async () => assert.fail('must not resend after reload') }, f.pending());
  assert.equal(restored.controller.snapshot().phase, 'uncertain'); assert.equal(restored.ids(), 0);
  await restored.controller.confirm(); await restored.controller.reconcile();
  assert.equal(restored.controller.snapshot().phase, 'saved'); assert.equal(restored.pending(), null); assert.equal(restored.ids(), 0);
});
test('definite source rejection needs a new explicit preview; a mismatching receipt or after-state never reports success', async () => {
  const rejected = fixture({ add: async () => { throw new AssociationRejected('预览已经变化'); }, receipt: async () => null });
  await rejected.controller.preview(); await rejected.controller.confirm(); assert.equal(rejected.controller.snapshot().phase, 'rejected'); assert.equal(rejected.pending(), null);
  const mismatch = fixture({ add: async () => ({ ...receipt(), receipt: { ...receipt().receipt, identity: { ...identity, siteDomain: 'modelfit.cc' } } }) });
  await mismatch.controller.preview(); await mismatch.controller.confirm(); assert.equal(mismatch.controller.snapshot().phase, 'uncertain');
  let reads = 0; const changed = fixture({ preview: async () => ++reads === 1 ? preview() : { ...preview(true), stateHash: 'c'.repeat(64) } });
  await changed.controller.preview(); await changed.controller.confirm(); assert.equal(changed.controller.snapshot().phase, 'changed');
  assert.equal(changed.controller.snapshot().receipt.status, 'created'); assert.match(changed.controller.snapshot().error, /当前完整状态/);
});
test('failure to persist the stable request fails before POST', async () => {
  let adds = 0; const transport = { preview: async () => preview(), add: async () => { adds++; return receipt(); }, receipt: async () => null };
  const controller = createAssociationReview(identity, transport, { read: () => null, write: () => { throw Error('storage blocked'); }, clear() {} }, () => requestId, () => {});
  await controller.preview(); await controller.confirm(); assert.equal(adds, 0); assert.equal(controller.snapshot().phase, 'rejected');
});
test('browser transport uses only normal same-origin endpoints and the URL contains exactly four non-sensitive identities', async () => {
  const seen = [], fetcher = async (url, init) => { seen.push({ url, init }); return Response.json(url.includes('requestId=') || init.method === 'POST' ? receipt() : preview()); };
  const transport = associationBrowserTransport(fetcher);
  const command = { ...identity, action: 'add', requestId, expectedStateHash: before };
  await transport.preview(identity); await transport.add(command); await transport.receipt(requestId);
  const query = new URLSearchParams(associationIdentityQuery(identity)); assert.deepEqual([...query.keys()], ['siteDomain', 'keywordId', 'keyword', 'topicId']);
  for (const call of seen) { assert.equal(call.init.credentials, 'same-origin'); assert.equal(call.init.redirect, 'error'); assert.ok(!JSON.stringify(call.init.headers ?? {}).toLowerCase().includes('authorization')); }
  assert.equal(seen.filter(x => x.init.method === 'POST').length, 1); assert.deepEqual(JSON.parse(seen[1].init.body), command);
});

module.exports = { identity, preview, receipt };
