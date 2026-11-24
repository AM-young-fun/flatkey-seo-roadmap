const { test } = require('node:test'), assert = require('node:assert/strict');
require('./register-ui-modules.cjs');
const { verifyIdentityOperation, rebindInitialQuarterPlan, canonicalIdentityClient } = require('../src/lib/pre-freeze-identities-client.ts');
const row = { siteDomain: 'flatkey.ai', keywordId: 'original-0', keyword: 'gpu rental 0', topicId: 'topic', country: 'US', language: 'en', market: 'create', languageReview: 'create', targetIdAfter: 'current-target' };
const original = { status: 'IDENTITIES_PREVIEW', stateHash: 'a'.repeat(64), readbackHash: 'b'.repeat(64), reviewHash: 'c'.repeat(64), selectionHash: 'd'.repeat(64), createSourceRows: 2, results: [row] };
const command = { action: 'apply_identities', requestId: 'human-once', expectedStateHash: original.stateHash, review: { selectionHash: original.selectionHash } };
const receipt = { actor: 'human', requestId: command.requestId, reviewHash: original.reviewHash, selectionHash: original.selectionHash,
  beforeHash: original.readbackHash, afterHash: 'e'.repeat(64), createdSourceRows: 2, results: [row] };
const readback = { ...original, readbackHash: receipt.afterHash, createSourceRows: 0 };
test('normal confirmation performs one identity write then a complete source preview and binds exact receipt to the original review', async () => {
  const calls = [], api = async (url, body) => { calls.push({ url, body }); return body?.action === 'apply_identities' ? { receipt } : readback; };
  const result = await verifyIdentityOperation(command, original, true, api);
  assert.equal(result.status, 'verified'); assert.deepEqual(calls.map(call => call.body?.action), ['apply_identities', 'preview_identities']);
  assert.equal(calls[0].body.requestId, calls[1].body.requestId);
});
test('lost or unknown responses only GET the same receipt; reconciliation cannot re-POST apply or silently mint another ID', async () => {
  const calls = [], api = async (url, body) => {
    calls.push({ url, body }); if (body?.action === 'apply_identities') throw Error('lost response');
    return body ? readback : { receipt };
  };
  assert.equal((await verifyIdentityOperation(command, original, true, api)).status, 'verified');
  assert.equal(calls.filter(call => call.body?.action === 'apply_identities').length, 1);
  const unknown = async () => { throw Object.assign(Error('not yet found'), { status: 404 }); };
  assert.equal((await verifyIdentityOperation(command, original, false, unknown)).status, 'unknown');
  const noResend = [];
  await verifyIdentityOperation(command, original, false, async (url, body) => { noResend.push(body?.action ?? 'GET'); return body ? readback : { receipt }; });
  assert.deepEqual(noResend, ['GET', 'preview_identities']);
});
test('wrong review/identity or changed after-state cannot report full success; a definite409 with no receipt stays rejected', async () => {
  for (const changed of [{ ...receipt, reviewHash: '0'.repeat(64) }, { ...receipt, results: [{ ...row, country: 'JP' }] }]) {
    const result = await verifyIdentityOperation(command, original, true, async () => ({ receipt: changed })); assert.equal(result.status, 'unknown');
  }
  const changed = await verifyIdentityOperation(command, original, true, async (_url, body) => body.action === 'apply_identities' ? { receipt } : { ...readback, readbackHash: 'f'.repeat(64) });
  assert.equal(changed.status, 'changed');
  const rejected = await verifyIdentityOperation(command, original, true, async (_url, body) => { throw Object.assign(Error('original conflict'), { status: body ? 409 : 404 }); });
  assert.equal(rejected.status, 'rejected');
});
test('a definitely rejected draft permits a fresh preview; unknown transport or later freeze remains read-only', () => {
  const { identityDraftReadback } = require('../src/lib/pre-freeze-identities-client.ts');
  const plan = { version: 'quarter-planning-v2', targetIds: ['original'], sourceVersion: 'exact' };
  const different = { state: { baseline: null, quarterPlanning: { approval: null, plan: { ...plan, sourceVersion: 'old' } } } };
  assert.equal(identityDraftReadback(different, plan, 409), 'rejected');
  for (const status of [undefined, 500, 503]) assert.equal(identityDraftReadback(different, plan, status), 'unknown');
  assert.equal(identityDraftReadback({ state: { quarterPlanning: { plan: { sourceVersion: 'exact', targetIds: ['original'], version: 'quarter-planning-v2' } } } }, plan, 409), 'verified');
  assert.equal(identityDraftReadback({ state: { baseline: { targets: ['original'] }, quarterPlanning: { plan } } }, plan, 409), 'unknown');
});
test('quarter rebind changes only current IDs/sourceVersion from the same1600 originals and refuses missing/cross-site replacement identities', () => {
  const members = Array.from({ length: 1600 }, (_, i) => ({ siteDomain: 'flatkey.ai', keywordId: `original-${i}`, keyword: `gpu rental ${i}`, topicId: 'topic' }));
  const ids = members.map(member => [member.siteDomain, member.keyword, 'unassigned', 'unassigned'].map(encodeURIComponent).join(':'));
  const plan = { version: 'quarter-planning-v2', targetIds: ids, sourceVersion: 'old', title: 'original complete decisions', deliveryBudget: { total: 100, counts: { gpu: 70, api: 25, other: 5 } }, reservedOriginalTaskIds: ['keep-original'] };
  const targets = members.map(member => ({ site: member.siteDomain, keywordId: member.keywordId, keyword: member.keyword, membership: 'formal', id: [member.siteDomain, member.keyword, 'US', 'en'].map(encodeURIComponent).join(':') }));
  const review = { selection: { members } }, updated = rebindInitialQuarterPlan(plan, review, targets, 'new');
  assert.deepEqual({ ...updated, targetIds: ids, sourceVersion: 'old' }, plan); assert.equal(updated.targetIds.length, 1600);
  assert.throws(() => rebindInitialQuarterPlan(plan, review, targets.slice(1), 'new'), /原成员/);
  assert.throws(() => rebindInitialQuarterPlan(plan, review, [{ ...targets[0], site: 'modelfit.cc' }, ...targets.slice(1)], 'new'), /原成员/);
  assert.equal(canonicalIdentityClient({ z: 1, a: { y: 2, b: 3 } }), canonicalIdentityClient({ a: { b: 3, y: 2 }, z: 1 }));
});
