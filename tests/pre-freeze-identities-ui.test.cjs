const { test } = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module'), path = require('node:path');
require('./register-ui-modules.cjs');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), load = Module._load;
let presets = [], cursor = 0;
const component = path.resolve(__dirname, '../src/components/PreFreezeIdentityReview.tsx');
Module._load = function (name, parent, ...rest) {
  if (name === 'react' && parent?.filename === component) return { useState(initial) { const n = cursor++; return [n in presets ? presets[n] : typeof initial === 'function' ? initial() : initial, () => {}]; }, useEffect() {}, useRef: value => ({ current: value }) };
  if (name.endsWith('.module.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
  return load.call(this, name, parent, ...rest);
};
const { PreFreezeIdentityReview } = require(component);
const entry = { siteDomain: 'flatkey.ai', keywordId: 'real-original', keyword: 'gpu rental', topicId: 'real-topic', country: 'US', language: 'en',
  demand: { metric: 'monthly_searches', value: 10, reference: '/actual/local.json', observedAt: '2026-11-23T10:00:00Z', quote: 'gpu rental 10', sha256: 'd'.repeat(64) },
  wordLanguage: { spans: [{ text: 'rental' }], reference: '/actual/language.json', quote: 'original English rental', reason: 'Explicit human word-language evidence', sha256: 'e'.repeat(64) } };
const bundle = { review: { assignments: [entry], selection: { members: Array(1600).fill({}) } } }, preview = { results: [{ ...entry, market: 'create' }], stateHash: 'a'.repeat(64) };
const render = state => { presets = state; cursor = 0; return renderToStaticMarkup(React.createElement(PreFreezeIdentityReview, { onChanged: async () => {} })); };
test('normal quarter UI initially offers only source upload, no automatic identity or direction approval', () => {
  const html = render([]); assert.match(html, /季度身份审核包/); assert.match(html, /每批最多200项/); assert.match(html, /不会升池/);
  assert.doesNotMatch(html, /确认本批缺失身份|批准当前范围|保存此版待审季度方案/);
});
test('a real preview shows exact word, old source quotes/hash and only explicit identity confirmation', () => {
  const html = render([bundle, preview, null, null, '', false, false]);
  assert.match(html, /gpu rental/); assert.match(html, /real-original/); assert.match(html, /gpu rental 10/); assert.match(html, /原词语种证明/);
  assert.match(html, /确认本批缺失身份/); assert.doesNotMatch(html, /批准完整季度方案并锁定/);
});
test('uncertain identity results lock file and confirmation and expose original receipt reconciliation', () => {
  const html = render([bundle, preview, { command: { requestId: 'same-original' } }, null, '原请求未核实', false, false]);
  assert.match(html, /disabled=""[^>]*>确认本批缺失身份/); assert.match(html, /核对原请求回执/); assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /本批身份与人审来源完整读回一致/);
});
test('only verified source readback exposes separate draft refresh; an attempted plan cannot POST again', () => {
  const html = render([bundle, preview, null, { createdSourceRows: 2 }, '', false, true, { plan: { targetIds: ['shown full proposed draft'] }, version: 1 }, false, true]);
  assert.match(html, /身份与人审来源完整读回一致/); assert.match(html, /disabled=""[^>]*>保存此版待审季度方案/);
  assert.match(html, /核对原季度待审稿/); assert.match(html, /不自动批准或冻结/);
});
