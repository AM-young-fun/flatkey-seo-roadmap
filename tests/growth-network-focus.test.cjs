require('./register-ui-modules.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const load = Module._load;
let harness;
const hooks = {
  useMemo: make => make(),
  useState(initial) {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = initial;
    return [harness.slots[index], value => { harness.slots[index] = value; }];
  },
  useRef(initial) {
    const index = harness.cursor++;
    return harness.slots[index] ??= { current: initial };
  },
};
Module._load = function (name, parent, ...rest) {
  if (parent?.filename.endsWith('/GrowthKeywordNetwork.tsx')) {
    if (name === 'react') return hooks;
    if (name === './GrowthKeywordNetwork.module.css') return new Proxy({}, { get: (_value, key) => key === '__esModule' ? false : key });
  }
  return load.call(this, name, parent, ...rest);
};
const { GrowthKeywordNetwork } = require('../src/components/GrowthKeywordNetwork.tsx');
const { keywordCircleLayout } = require('../src/components/growth-network-layout.ts');
const { defaultGrowthScope } = require('../src/components/growth-topic-view.ts');
Module._load = load;

const site = 'flatkey.ai';
const topics = [{ id: 'alpha', site, topicId: 'alpha', name: 'GPU租用' }, { id: 'beta', site, topicId: 'beta', name: '模型接口' }];
const targets = [
  { id: 'alpha/en', site, topicId: 'alpha', keyword: 'gpu rent', country: 'US', language: 'en', rank: 7, rankEligible: true },
  { id: 'alpha/ja', site, topicId: 'alpha', keyword: 'GPUの価格', country: 'JP', language: 'ja', rank: null, captureState: 'unqueried' },
  { id: 'beta/en', site, topicId: 'beta', keyword: 'api pricing', country: 'US', language: 'en', rank: 22, rankEligible: true },
].map(target => ({ ...target, publishedUrls: [], pageState: 'unmapped' }));
const data = { topics, targets, markets: [{ country: 'US', language: 'en', label: '美国 · 英语' }, { country: 'JP', language: 'ja', label: '日本 · 日语' }] };

function render(visible = targets) {
  harness.cursor = 0;
  return GrowthKeywordNetwork({ data, targets: visible, scope: defaultGrowthScope });
}

function flatten(value) {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value?.props) return [];
  return [value, ...flatten(value.props.children)];
}

const by = (tree, key, value) => flatten(tree).find(node => node.props[key] === value);
const pointsIn = tree => flatten(tree).flatMap(node => node.props['data-keyword-id'] ?? []);

test('topic activation fits the exact cluster and preserves keyword links, then Escape and reset return the whole view', () => {
  harness = { slots: [], cursor: 0 };
  let tree = render();
  assert.deepEqual(pointsIn(tree).sort(), targets.map(target => target.id).sort());
  const alpha = by(tree, 'aria-label', '放大话题 GPU租用');
  assert.equal(alpha.props.role, 'button');
  assert.equal(alpha.props.tabIndex, 0);
  let event = { key: ' ', preventDefault() { this.handled = true; } };
  alpha.props.onKeyDown(event);
  assert.ok(event.handled);
  tree = render();
  assert.deepEqual(pointsIn(tree).sort(), ['alpha/en', 'alpha/ja']);
  const focus = by(tree, 'aria-label', 'GPU租用的关键词列表');
  assert.ok(focus);
  assert.equal(flatten(focus).filter(node => node.type === 'li').length, 2);
  assert.ok(flatten(focus).some(node => node.props.href === '/topics/alpha?site=flatkey.ai&target=alpha%2Fen'));
  const geometry = flatten(tree).find(node => node.props.transform).props.transform.match(/translate\(([^ ]+) ([^)]+)\) translate\(300 300\) scale\(([^)]+)\)/);
  const [x, y, zoom] = geometry.slice(1).map(Number);
  const cluster = keywordCircleLayout(targets, topics).clusters.find(row => row.id === 'alpha');
  assert.ok(zoom > 1);
  assert.ok(Math.abs(x + (cluster.x - 300) * zoom) < 0.0001);
  assert.ok(Math.abs(y + (cluster.y - 300) * zoom) < 0.0001);
  assert.deepEqual(pointsIn(render([targets[2]])), ['beta/en']);

  event = { key: 'Escape', preventDefault() { this.handled = true; } };
  tree.props.onKeyDown(event);
  assert.ok(event.handled);
  tree = render();
  assert.equal(pointsIn(tree).length, 3);
  by(tree, 'aria-label', '放大话题 模型接口').props.onClick();
  tree = render();
  assert.deepEqual(pointsIn(tree), ['beta/en']);
  flatten(tree).find(node => node.type === 'button' && node.props.children === '返回全图').props.onClick();
  assert.equal(pointsIn(render()).length, 3);
});

test('dragging past the threshold suppresses the release click and leaves the graph unfocused', () => {
  harness = { slots: [], cursor: 0 };
  let tree = render();
  const svg = flatten(tree).find(node => node.type === 'svg').props;
  const down = { button: 0, pointerId: 1, clientX: 15, clientY: 15 };
  let captured;
  const currentTarget = { setPointerCapture(id) { captured = id; }, getBoundingClientRect: () => ({ width: 660, height: 300 }) };
  svg.onPointerDown(down);
  svg.onPointerMove({ ...down, clientX: 17, currentTarget });
  assert.equal(captured, undefined);
  svg.onPointerMove({ ...down, clientX: 30, currentTarget });
  assert.equal(captured, 1);
  svg.onPointerUp();
  const release = { detail: 1, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  svg.onClickCapture(release);
  assert.ok(release.prevented && release.stopped);
  tree = render();
  assert.equal(pointsIn(tree).length, 3);
  assert.match(flatten(tree).find(node => node.props.transform).props.transform, /^translate\(30 0\)/);
});

test('an overview dot is part of its cluster activation target and only the focused dot navigates to its exact keyword', () => {
  harness = { slots: [], cursor: 0 };
  let tree = render();
  const button = by(tree, 'aria-label', '放大话题 模型接口');
  const dot = by(button, 'data-keyword-id', 'beta/en');
  assert.ok(dot, 'the browser click on the dot bubbles to its own cluster button');
  assert.ok(!flatten(tree).some(node => node.props.href?.includes('target=beta')));
  dot.props.onMouseEnter();
  assert.ok(by(render(), 'role', 'status'));
  button.props.onClick();
  tree = render();
  assert.deepEqual(pointsIn(tree), ['beta/en']);
  const dotLink = flatten(tree).find(node => node.props['aria-label'] === 'api pricing');
  assert.equal(dotLink.props.href, '/topics/beta?site=flatkey.ai&target=beta%2Fen');
  assert.ok(by(dotLink, 'data-keyword-id', 'beta/en'));
});

test('topic labels cannot intercept pointer hits on nearby clusters', () => {
  harness = { slots: [], cursor: 0 };
  const labels = flatten(render()).filter(node => node.type === 'text');
  assert.equal(labels.length, topics.length);
  assert.ok(labels.every(label => label.props.pointerEvents === 'none'));
});
