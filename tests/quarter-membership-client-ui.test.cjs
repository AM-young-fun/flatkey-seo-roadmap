const { test } = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module'), path = require('node:path');
require('./register-ui-modules.cjs');
const { verifyMembershipOperation } = require('../src/lib/quarter-membership-client.ts');
const selection = { version: 'quarter-membership-v1', quarterId: '2026-close', sourceReference: '/approved/immutable1600.json', sourceHash: 'a'.repeat(64),
  members: Array.from({ length: 1600 }, (_, i) => ({ siteDomain: 'flatkey.ai', keywordId: `original-${i}`, keyword: `gpu rental ${i}`, topicId: 'real-topic' })) };
const original = { status: 'PREVIEW', manifest: selection, selectionHash: 'b'.repeat(64), stateHash: 'c'.repeat(64), uniqueWords: 1600, membershipCount: 1600, changed: 1060, changes: [] };
const command = { action: 'apply', requestId: 'human-original-once', selection, selectionHash: original.selectionHash, expectedStateHash: original.stateHash };
const receipt = { status: 'APPLIED', actor: 'human', requestId: command.requestId, selectionHash: original.selectionHash, sourceHash: selection.sourceHash,
  expectedStateHash: original.stateHash, afterHash: 'd'.repeat(64), changed: 1060, uniqueWords: 1600, membershipCount: 1600, manifest: selection, readbackVerified: true, auditId: 'original-audit' };
test('membership normal confirmation writes once then reads the exact original human receipt and all current selected members', async () => {
  const calls = []; const result = await verifyMembershipOperation(command, original, true, async (url, body) => { calls.push({ url, body }); return body ? { status: 'APPLIED' } : receipt; });
  assert.equal(result.status, 'verified'); assert.equal(calls.length, 2); assert.deepEqual(calls[0].body, command);
  assert.match(calls[1].url, /membershipRequestId=human-original-once/); assert.equal(calls[1].body, undefined);
});
test('lost membership responses only read the same audit; definite rejection permits a fresh preview but never blind retry', async () => {
  const calls = []; const result = await verifyMembershipOperation(command, original, true, async (url, body) => { calls.push({ url, body }); if (body) throw Error('lost response'); return receipt; });
  assert.equal(result.status, 'verified'); assert.equal(calls.filter(row => row.body).length, 1);
  const reconciled = await verifyMembershipOperation(command, original, false, async (url, body) => { assert.equal(body, undefined); assert.match(url, /human-original-once/); return receipt; }); assert.equal(reconciled.status, 'verified');
  const unknown = await verifyMembershipOperation(command, original, false, async () => { throw Object.assign(Error('not found yet'), { status: 404 }); }); assert.equal(unknown.status, 'unknown');
  const rejected = await verifyMembershipOperation(command, original, true, async (_url, body) => { throw Object.assign(Error('definite reject'), { status: body ? 409 : 404 }); }); assert.equal(rejected.status, 'rejected');
});
test('the new 1000-word quarter reconciles its original receipt without submitting again', async () => {
  const newSelection = { ...selection, version: 'quarter-membership-v2', members: selection.members.slice(0, 1000) };
  const newPreview = { ...original, manifest: newSelection, uniqueWords: 1000, membershipCount: 1000, changed: 1000 };
  const newCommand = { ...command, selection: newSelection };
  const newReceipt = { ...receipt, manifest: newSelection, uniqueWords: 1000, membershipCount: 1000, changed: 1000 };
  const verified = await verifyMembershipOperation(newCommand, newPreview, false, async (_url, body) => {
    assert.equal(body, undefined);
    return newReceipt;
  });
  assert.equal(verified.status, 'verified');
  const wrongCount = await verifyMembershipOperation(newCommand, newPreview, false, async () => ({ ...newReceipt, uniqueWords: 1600 }));
  assert.equal(wrongCount.status, 'unknown');
});
test('wrong original audit or changed current member state cannot report a successful pool initialization', async () => {
  for (const changed of [{ ...receipt, actor: 'collector' }, { ...receipt, requestId: 'someone-else' }, { ...receipt, expectedStateHash: '0'.repeat(64) },
    { ...receipt, manifest: { ...selection, sourceHash: '0'.repeat(64) } }]) assert.equal((await verifyMembershipOperation(command, original, false, async () => changed)).status, 'unknown');
  assert.equal((await verifyMembershipOperation(command, original, false, async () => ({ ...receipt, readbackVerified: false }))).status, 'changed');
});
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), load = Module._load;
const file = path.resolve(__dirname, '../src/components/QuarterMembershipReview.tsx'); let presets = [], cursor = 0;
Module._load = function (name, parent, ...rest) {
  if (name === 'react' && parent?.filename === file) return { useState(initial) { const index = cursor++; return [index in presets ? presets[index] : initial, () => {}]; }, useEffect() {}, useRef: value => ({ current: value }) };
  if (name.endsWith('.module.css')) return new Proxy({}, { get: (_value, key) => key === '__esModule' ? false : String(key) });
  return load.call(this, name, parent, ...rest);
};
const { QuarterMembershipReview } = require(file);
const render = values => { presets = values; cursor = 0; return renderToStaticMarkup(React.createElement(QuarterMembershipReview, { onChanged: async () => {} })); };
test('normal member UI requires the original uploaded selection and real preview before explicit confirmation', () => {
  const initial = render([]); assert.match(initial, /季度正式成员审核包/); assert.doesNotMatch(initial, /确认此1600名单的正式成员/);
  const before = render([selection, null, null, null, false, '']); assert.match(before, /disabled=""[^>]*>确认此1600名单的正式成员/);
  const previewed = render([selection, original, null, null, false, '']); assert.match(previewed, /1060/); assert.match(previewed, /immutable1600.json/); assert.match(previewed, /real-topic/);
  assert.doesNotMatch(previewed, /disabled=""[^>]*>确认此1600名单的正式成员/); assert.doesNotMatch(previewed, /批准完整季度方案并锁定/);
});
test('pending member writes lock confirmation and expose only exact-receipt recovery; success needs complete readback', () => {
  const pending = render([selection, original, { command, original }, null, false, '尚未核实']);
  assert.match(pending, /disabled=""[^>]*>确认此1600名单的正式成员/); assert.match(pending, /核对原成员请求回执/); assert.doesNotMatch(pending, /完整读回一致/);
  assert.match(render([selection, original, null, receipt, false, '']), /原成员审计及当前成员完整读回一致/);
  assert.doesNotMatch(render([selection, original, { command, original }, { ...receipt, readbackVerified: false }, false, '当前成员另有变化']), /原成员审计及当前成员完整读回一致/);
});
