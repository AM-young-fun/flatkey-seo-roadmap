const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..'), load = Module._load;
let counts = { originals: 6, translations: 9, backfillTranslations: 0, landingPages: 0, clusterPages: 0, optimizedPages: 0 };
const report = () => ({ id: 'seo-digest:2026-11-19:0123456789abcdef', date: '2026-11-19', kind: 'daily',
  title: 'Fixture report', generatedAt: '2026-11-20T02:00:00Z', text: 'Fixture report', detailText: 'Fixture report',
  counts, pagePerformance: [], organicRegistrations: { current: 5, previous: 15 }, coverage: { publications: 'verified', optimizations: 'verified' } });
Module._load = function (name, parent, ...rest) {
  if (name === 'next/navigation') return { useSearchParams: () => new URLSearchParams('period=daily&date=2026-11-19'), useRouter: () => ({ push() {} }) };
  if (name === 'next/link') return { __esModule: true, useLinkStatus: () => ({ pending: false }), default: props => React.createElement('a', { href: props.href }, props.children) };
  if (name === './useSeoAnalytics') return { numberText: String, shanghaiStamp: String, useSeoRead: () => ({ data: { report: report(), dates: ['2026-11-19'] }, retry() {} }) };
  if (name === './UiSelect' || name === './ReportLoading') return { UiSelect: () => null, ReportLoading: () => null };
  if (name.endsWith('.module.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
  return load.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...rest);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, f);
const { SeoDigestReports } = require('../src/components/SeoDigestReports.tsx');

test('the blog card displays all added language pages with the source/translation breakdown and keeps the snapshot unchanged', () => {
  const before = JSON.stringify(counts), html = renderToStaticMarkup(React.createElement(SeoDigestReports));
  assert.match(html, /<dt>新增博客页面<\/dt><dd>15<small>源文 6 · 译文 9 · 旧文补译 0<\/small>/);
  assert.equal(JSON.stringify(counts), before);
});

test('older snapshots without the new total field still show their recorded source/translation/backfill counts', () => {
  counts = { ...counts, originals: 21, translations: 63, backfillTranslations: 2 };
  const html = renderToStaticMarkup(React.createElement(SeoDigestReports));
  assert.match(html, /<dt>新增博客页面<\/dt><dd>86<small>源文 21 · 译文 63 · 旧文补译 2<\/small>/);
  assert.equal(counts.originals, 21); assert.equal(counts.blogPages, undefined);
});
