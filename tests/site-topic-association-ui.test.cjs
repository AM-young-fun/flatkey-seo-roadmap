const { test } = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module');
require('./register-ui-modules.cjs');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), original = Module._load;
Module._load = function (name, parent, ...rest) {
  if (name === './PageHeader') return { PageHeader: () => null };
  if (name === './AppLink') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
  if (name.endsWith('.module.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
  return original.call(this, name, parent, ...rest);
};
const { TopicAssociationReviewPanel, KeywordTopicAssociation } = require('../src/components/KeywordTopicAssociation.tsx');
const { emptyAssociationReview } = require('../src/lib/site-topic-association-client.ts');
const identity = { siteDomain: 'flatkey.ai', keywordId: 'word-1', keyword: 'moe expert streaming', topicId: 'real-topic' };
const preview = { identity, stateHash: 'a'.repeat(64), edgeExists: false, topicLabels: { original: '自然搜索发现', global: '原ModelFit主话题' },
  state: { site: { name: 'Flatkey' }, member: { topicId: 'original' }, keyword: { topicId: 'global' },
    topic: { text: 'LLM GPU memory requirements' }, assignments: [{ siteDomain: 'flatkey.ai', keywordId: 'word-1', topicId: 'original' }] } };
const render = view => renderToStaticMarkup(React.createElement(TopicAssociationReviewPanel, { identity, view, onPreview() {}, onConfirm() {}, onReconcile() {} }));
test('review DOM shows actual original and target topics; confirmation is disabled until a source preview exists', () => {
  const idle = render(emptyAssociationReview()); assert.match(idle, /moe expert streaming/); assert.match(idle, /先读取当前真实状态/);
  assert.match(idle, /disabled=""[^>]*>确认仅新增此关联/);
  const ready = render({ ...emptyAssociationReview(), phase: 'ready', preview, requestId: 'topic-association:stable' });
  assert.match(ready, /自然搜索发现/); assert.match(ready, /原ModelFit主话题/); assert.match(ready, /LLM GPU memory requirements/);
  assert.match(ready, /原主话题、已有关联、正式池、页面和原任务完整保留/);
  assert.doesNotMatch(ready, /disabled=""[^>]*>确认仅新增此关联/);
});
test('unknown DOM offers receipt reconciliation and cannot present an unverified operation as a successful addition', () => {
  const unknown = render({ ...emptyAssociationReview(), phase: 'uncertain', preview, requestId: 'topic-association:stable', error: '结果未核实' });
  assert.match(unknown, /role="alert"/); assert.match(unknown, /核对原请求/); assert.match(unknown, /disabled=""[^>]*>确认仅新增此关联/);
  assert.match(unknown, /disabled=""[^>]*>读取关联预览/); assert.doesNotMatch(unknown, /已新增关联，完整读回一致/);
});
test('only full-readback success displays accurate new or reused status and original receipt', () => {
  for (const created of [true, false]) {
    const html = render({ ...emptyAssociationReview(), phase: 'saved', preview: { ...preview, edgeExists: true }, requestId: 'topic-association:stable',
      receipt: { requestId: 'topic-association:stable', identity, beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64), createdEdge: created,
        status: created ? 'created' : 'reused', appliedAt: '2026-11-24T12:00:00Z' } });
    assert.match(html, created ? /已新增关联，完整读回一致/ : /已复用原关联，完整读回一致/);
    assert.match(html, new RegExp('本次新增 ' + (created ? 1 : 0) + ' 条')); assert.match(html, /2026-11-24T12:00:00Z/);
  }
});
test('invalid management links cannot expose a confirmation control', () => {
  const html = renderToStaticMarkup(React.createElement(KeywordTopicAssociation, { identity: null }));
  assert.match(html, /管理链接须包含准确/); assert.doesNotMatch(html, /确认仅新增此关联/);
});
test('the page accepts exactly four original identities and never echoes extra URL fields or ambiguous duplicate values', async () => {
  const Page = require('../src/app/keyword-topic-association/page.tsx').default;
  const valid = await Page({ searchParams: Promise.resolve(identity) });
  assert.deepEqual(valid.props.identity, identity);
  for (const query of [{ ...identity, token: 'sensitive-extra-must-not-echo' }, { ...identity, keyword: [identity.keyword, 'other'] }]) {
    const element = await Page({ searchParams: Promise.resolve(query) });
    assert.equal(element.props.identity, null);
    const html = renderToStaticMarkup(element); assert.doesNotMatch(html, /sensitive-extra-must-not-echo/);
    assert.doesNotMatch(html, /确认仅新增此关联/);
  }
});
