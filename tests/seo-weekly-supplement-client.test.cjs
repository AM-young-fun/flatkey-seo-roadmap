const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const componentFile = path.resolve(__dirname, '../src/components/WeeklyReportSupplement.tsx');
const reportId = 'seo-digest:2026-11-19:1234567890abcdef';
const tick = () => new Promise(resolve => setImmediate(resolve));
const supplement = (revision, text) => ({
  id: 'weekly-supplement:2026-11-12:2026-11-18',
  periodStart: '2026-11-12', periodEnd: '2026-11-18', revision, text,
  updatedAt: revision ? '2026-11-23T01:00:00Z' : null,
});

// Execute the real TSX handlers with isolated hooks and deferred HTTP responses.
// The harness inspects rendered controls and requests, not private state slots.
function editor(props = {}) {
  const states = [], effects = [], requests = [];
  let hook = 0, tree;
  const pendingEffects = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const react = {
    useId: () => 'supplement-field',
    useState(initial) {
      const index = hook++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
      }];
    },
    useEffect(effect, dependencies) {
      const index = hook++, previous = effects[index];
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        effects[index] = { dependencies, cleanup: previous?.cleanup };
        pendingEffects.push(() => {
          effects[index].cleanup?.();
          effects[index].cleanup = effect();
        });
      }
    },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(componentFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports, module: { exports }, AbortController, URLSearchParams,
    window: { confirm: () => true },
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name.endsWith('.module.css')) return new Proxy({}, { get: (_, key) => String(key) });
      throw new Error(`Unexpected component dependency: ${name}`);
    },
  }, { filename: componentFile });

  function render() {
    hook = 0;
    tree = exports.WeeklyReportSupplement({ reportId, ...props });
    while (pendingEffects.length) pendingEffects.shift()();
  }
  function nodes(predicate, node = tree) {
    if (!node || typeof node !== 'object') return [];
    return [
      ...(predicate(node) ? [node] : []),
      ...[].concat(node.props?.children ?? []).flatMap(child => nodes(predicate, child)),
    ];
  }
  const input = () => nodes(node => node.type === 'textarea')[0];
  const button = label => nodes(node => node.type === 'button' && node.props.children === label)[0];
  function click(label) {
    const control = button(label);
    assert.ok(control, `Missing ${label} button`);
    assert.equal(Boolean(control.props.disabled), false, `${label} must be enabled before clicking`);
    control.props.onClick();
    render();
  }
  function change(text) {
    assert.equal(Boolean(input().props.disabled), false, 'Typing requires an enabled editor');
    input().props.onChange({ target: { value: text } });
    render();
  }
  async function reply(index, body, status = 200) {
    assert.ok(requests[index], `Missing HTTP request ${index}`);
    requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
    await tick();
    render();
  }
  render();
  return {
    requests, input, button, click, change, reply,
    status: () => nodes(node => node.props?.role === 'status')[0]?.props.children,
    alerts: () => nodes(node => node.props?.role === 'alert').map(node => node.props.children),
    cleanup: () => effects.forEach(effect => effect?.cleanup?.()),
  };
}

test('a slow retry GET cannot overlap a newer save and restore an older note', async () => {
  const view = editor();
  try {
    await view.reply(0, { supplement: supplement(1, 'previously saved'), editable: true });
    view.change('draft whose first save fails');
    view.click('保存补充');
    await view.reply(1, { message: '保存暂时失败' }, 503);
    assert.deepEqual(view.alerts(), ['保存暂时失败']);

    // Keep the retry GET pending, as in the original stale-response regression.
    view.click('重新读取');
    assert.equal(view.requests.length, 3);
    assert.equal(view.requests[2].options.method, undefined);
    assert.equal(view.status(), '正在读取…');
    assert.equal(view.input().props.disabled, true);
    assert.equal(view.button('保存补充').props.disabled, true);
    assert.equal(view.button('重新读取').props.disabled, true);

    // Also exercise the handler guard, independently of the disabled DOM button.
    view.button('保存补充').props.onClick();
    await tick();
    assert.equal(view.requests.length, 3, 'No POST may race the retry GET');

    await view.reply(2, { supplement: supplement(1, 'previously saved'), editable: true });
    assert.equal(view.input().props.disabled, false);
    assert.equal(view.input().props.value, 'previously saved');
    view.change('new saved text');
    view.click('保存补充');
    const command = JSON.parse(view.requests[3].options.body);
    assert.deepEqual(command, { reportId, expectedRevision: 1, text: 'new saved text' });
    await view.reply(3, { supplement: supplement(2, 'new saved text') });
    assert.equal(view.input().props.value, 'new saved text');
    assert.equal(view.status(), '已保存');
    assert.equal(view.button('保存补充').props.disabled, true);
    assert.equal(view.requests.length, 4);
  } finally { view.cleanup(); }
});

test('a failed first read can be retried and then edited without leaving loading stuck', async () => {
  const view = editor();
  try {
    assert.equal(view.input().props.disabled, true);
    assert.equal(view.status(), '正在读取…');
    await view.reply(0, { message: '读取暂时失败' }, 503);
    assert.deepEqual(view.alerts(), ['读取暂时失败']);
    assert.equal(view.button('重新读取').props.disabled, false);

    view.click('重新读取');
    assert.equal(view.status(), '正在读取…');
    assert.equal(view.button('重新读取').props.disabled, true);
    await view.reply(1, { supplement: supplement(0, ''), editable: true });
    assert.equal(view.input().props.disabled, false);
    assert.deepEqual(view.alerts(), []);
    view.change('first note after retry');
    assert.equal(view.button('保存补充').props.disabled, false);
    view.click('保存补充');
    assert.deepEqual(JSON.parse(view.requests[2].options.body), {
      reportId, expectedRevision: 0, text: 'first note after retry',
    });
    await view.reply(2, { supplement: supplement(1, 'first note after retry') });
    assert.equal(view.status(), '已保存');
  } finally { view.cleanup(); }
});

test('bundled initial note is immediately usable without a second GET and preserves save revision and retry behavior', async () => {
  const view = editor({ initial: { supplement: supplement(3, 'bundled note'), editable: true } });
  try {
    assert.equal(view.requests.length, 0);
    assert.equal(view.input().props.disabled, false);
    assert.equal(view.input().props.value, 'bundled note');
    assert.equal(view.status(), '已保存');
    view.change('updated note'); view.click('保存补充');
    assert.deepEqual(JSON.parse(view.requests[0].options.body), { reportId, expectedRevision: 3, text: 'updated note' });
    await view.reply(0, { message: 'conflict' }, 409);
    view.click('重新读取');
    assert.equal(view.requests[1].options.method, undefined);
    await view.reply(1, { supplement: supplement(4, 'newer note'), editable: true });
    assert.equal(view.input().props.value, 'newer note');
  } finally { view.cleanup(); }
});

test('bundled read-only note retains disabled editing', () => {
  const view = editor({ initial: { supplement: supplement(1, 'read only'), editable: false } });
  try {
    assert.equal(view.requests.length, 0);
    assert.equal(view.input().props.value, 'read only');
    assert.equal(view.input().props.disabled, true);
    assert.equal(view.button('保存补充').props.disabled, true);
  } finally { view.cleanup(); }
});
