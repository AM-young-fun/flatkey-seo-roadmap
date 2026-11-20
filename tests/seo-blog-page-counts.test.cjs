const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, f);
const { blogPageCounts } = require('../src/lib/seo-blog-page-counts.ts');
const { buildSeoDigest } = require('../src/lib/seo-digest.ts');
const base = (date, kind = 'daily') => ({ date, kind, now: new Date(date + 'T18:00:00+08:00'), observations: [],
  publications: [], optimizations: [], effects: [], priorities: [], issues: [], runNotes: [],
  publicationCoverage: 'verified', optimizationCoverage: 'verified' });
const publication = (id, kind, stamp = '2026-11-17T12:00:00Z') => ({ id, kind, title: id,
  url: 'https://flatkey.ai/blog/' + id, publishedAt: stamp, verifiedAt: stamp, recordedAt: stamp });

test('source articles, translated pages and old-source backfills retain separate meaning and combine once', () => {
  const source = { originals: 6, translations: 9, backfillTranslations: 2 }, before = structuredClone(source);
  assert.deepEqual(blogPageCounts(source), { originals: 6, translations: 9, backfillTranslations: 2, total: 17 });
  assert.deepEqual(source, before);
  assert.deepEqual(blogPageCounts({ originals: 3 }), { originals: 3, translations: 0, backfillTranslations: 0, total: 3 });
});

test('weekly blog-page totals exclude other delivery kinds and duplicate URL receipts without redefining originals', () => {
  const publications = [
    ...Array.from({ length: 21 }, (_, i) => publication('source-' + i, 'source')),
    ...Array.from({ length: 63 }, (_, i) => publication('translation-' + i, 'translation')),
    publication('landing', 'landing'), publication('cluster', 'cluster'), publication('prompt', 'prompt'),
  ];
  publications.push({ ...publications[0], id: 'duplicate-source-receipt' });
  const before = structuredClone(publications);
  const report = buildSeoDigest({ ...base('2026-11-19', 'weekly'), publications });
  assert.equal(report.counts.originals, 21); assert.equal(report.counts.translations, 63);
  assert.equal(report.counts.backfillTranslations, 0); assert.equal(report.counts.blogPages, 84);
  assert.equal(report.counts.landingPages, 1); assert.equal(report.counts.clusterPages, 1);
  assert.match(report.detailText, /新增博客页面 84 页（源文 21 篇、译文 63 页、旧文补译 0 页）/);
  assert.deepEqual(publications, before);
});

test('daily compact delivery uses the already verified work window rather than a second publication-date filter', () => {
  const stamp = '2026-11-09T18:05:00+08:00';
  const publications = [
    ...Array.from({ length: 6 }, (_, i) => publication('source-' + i, 'source', stamp)),
    ...Array.from({ length: 9 }, (_, i) => publication('translation-' + i, 'translation', stamp)),
  ].map(row => ({ ...row, publishedAt: '2026-11-09T17:58:00+08:00' }));
  const report = buildSeoDigest({ ...base('2026-11-10'), notificationCompact: true, publications });
  assert.equal(report.counts.originals, 6); assert.equal(report.counts.translations, 9);
  assert.equal(report.counts.blogPages, 15);
  assert.match(report.text, /新增博客页面 \*\*15 页\*\*（源文 6 篇、译文 9 页、旧文补译 0 页）/);
  assert.doesNotMatch(report.text, /上线 \*\*0 篇文章/);
});

test('backfill translations are included in added pages but cannot turn into original source articles', () => {
  const report = buildSeoDigest({ ...base('2026-11-19', 'weekly'), publications: [
    publication('source', 'source'), publication('translation', 'translation'), publication('backfill', 'backfill_translation'),
    publication('unverified', 'source', '2026-11-20T12:00:00Z'),
  ] });
  assert.deepEqual(blogPageCounts(report.counts), { originals: 1, translations: 1, backfillTranslations: 1, total: 3 });
  assert.equal(report.counts.blogPages, 3);
});
