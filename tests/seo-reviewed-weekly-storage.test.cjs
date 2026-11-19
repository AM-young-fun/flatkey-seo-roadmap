const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const crypto = require('node:crypto');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { buildSeoDigest } = require('../src/lib/seo-digest.ts');
const hash = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
let rows, creates;
const originalLoad = Module._load;
Module._load = function (name, ...rest) {
  if (name === '@/lib/prisma') return { prisma: { seoReportVersion: {
    async findUnique({ where }) { return rows.get(where.id) ?? null; },
    async createMany(command) {
      creates.push(command);
      assert.equal(command.skipDuplicates, true);
      const row = command.data;
      if (rows.has(row.id)) return { count: 0 };
      rows.set(row.id, { ...row, payload: reverseKeys(row.payload) });
      return { count: 1 };
    },
    async update() { throw Error('immutable storage must never update'); },
    async updateMany() { throw Error('immutable storage must never updateMany'); },
    async upsert() { throw Error('immutable storage must never upsert'); },
  } } };
  return originalLoad.call(this, name, ...rest);
};
const { saveReviewedSeoDigest } = require('../src/lib/services/seo-reviewed-digest.ts');
Module._load = originalLoad;
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  return value;
}
function fixture() {
  const base = buildSeoDigest({ date: '2026-11-19', kind: 'weekly', now: new Date('2026-11-19T09:00:00.000Z'),
    observations: [], publications: [], optimizations: [], effects: [], priorities: [], issues: [], runNotes: [],
    publicationCoverage: 'missing', optimizationCoverage: 'missing' });
  const body = '**Flatkey SEO 周报｜2026/11/12—11/18**\n\n' + '已批准全文保留确切来源日期，不重新生成、不补写旧结构化指标。'.repeat(5) + '\n';
  const input = { action: 'save_reviewed', kind: 'weekly', date: base.date, baseReportId: base.id, baseReportHash: base.hash,
    reportPeriod: { ...base.reportPeriod }, text: body, textSha256: hash(body), sourceEvidenceSha256: hash('frozen-source-manifest'),
    approvedAt: '2026-11-19T10:25:00.000Z' };
  const record = { id: base.id, kind: 'SEO_DIGEST', siteDomain: 'flatkey.ai', periodStart: new Date(base.date),
    periodEnd: new Date(base.date), createdAt: new Date(base.generatedAt), payload: structuredClone(base) };
  rows = new Map([[base.id, record]]); creates = [];
  return { base, input, record };
}

test('reviewed storage creates a separate snapshot, reads JSONB back, and never updates the base', async () => {
  const { base, input, record } = fixture(), before = structuredClone(record);
  const now = new Date('2026-11-19T10:30:00.000Z');
  const saved = await saveReviewedSeoDigest(input, now);
  assert.equal(creates.length, 1);
  assert.equal(rows.size, 2);
  assert.notEqual(saved.id, base.id);
  assert.deepEqual(rows.get(base.id), before);
  assert.equal(saved.text, input.text);
  assert.equal(saved.hash, input.textSha256);
  assert.equal(saved.generatedAt, now.toISOString());
  assert.equal(saved.reviewedBody.baseGeneratedAt, base.generatedAt);
  assert.equal(saved.reviewedBody.sourceEvidenceSha256, input.sourceEvidenceSha256);
  assert.deepEqual(rows.get(saved.id).createdAt, now);
  assert.deepEqual(Object.keys(saved.reviewedBody), Object.keys(creates[0].data.payload.reviewedBody).reverse(), 'JSONB key ordering does not change the binding');
});

test('replaying the same approved body returns the first immutable archive time, while metadata conflicts fail without an overwrite', async () => {
  const { base, input } = fixture();
  const saved = await saveReviewedSeoDigest(input, new Date('2026-11-19T10:30:00.000Z'));
  const before = structuredClone(rows.get(saved.id));
  const replay = await saveReviewedSeoDigest(input, new Date('2026-11-19T10:32:00.000Z'));
  assert.equal(replay.id, saved.id);
  assert.equal(replay.generatedAt, '2026-11-19T10:30:00.000Z');
  assert.deepEqual(rows.get(saved.id), before);
  await assert.rejects(saveReviewedSeoDigest({ ...input, sourceEvidenceSha256: hash('different-evidence') }, new Date('2026-11-19T10:33:00.000Z')),
    error => error.status === 409);
  assert.deepEqual(rows.get(saved.id), before);
  assert.equal(rows.get(base.id).payload.id, base.id);
  assert.equal(rows.size, 2);
});

test('wrong site, wrong snapshot kind or wrong storage date is rejected before any create', async () => {
  for (const change of [{ siteDomain: 'another.example' }, { kind: 'INTERVAL' }, { periodStart: new Date('2026-11-18') }, { periodEnd: new Date('2026-11-20') }]) {
    const { input, record } = fixture(); Object.assign(record, change);
    await assert.rejects(saveReviewedSeoDigest(input, new Date('2026-11-19T10:30:00.000Z')), error => error.status === 404);
    assert.equal(creates.length, 0);
  }
});
