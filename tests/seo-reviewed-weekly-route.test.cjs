const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), originalLoad = Module._load, originalResolve = Module._resolveFilename;
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
Module._resolveFilename = function (name, parent, ...rest) {
  return originalResolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...rest);
};
const { buildSeoDigest } = require('../src/lib/seo-digest.ts');
const { buildReviewedSeoDigest } = require('../src/lib/seo-reviewed-digest.ts');
const hash = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const base = buildSeoDigest({ date: '2026-11-19', kind: 'weekly', now: new Date('2026-11-19T09:00:00.000Z'),
  observations: [], publications: [], optimizations: [], effects: [], priorities: [], issues: [], runNotes: [],
  publicationCoverage: 'missing', optimizationCoverage: 'missing' });
const text = '**Flatkey SEO 周报｜2026/11/12—11/18**\n\n' + '这是用户批准的精确全文，来源已冻结，不重新生成、不动态叠加旧指标。'.repeat(5) + '\n';
const command = { action: 'save_reviewed', kind: 'weekly', date: base.date, baseReportId: base.id, baseReportHash: base.hash,
  reportPeriod: { ...base.reportPeriod }, text, textSha256: hash(text), sourceEvidenceSha256: hash('frozen-manifest'), approvedAt: '2026-11-19T10:25:00.000Z' };
let saved = new Map(), writes = 0, generated = 0, claims = 0, dynamicReads = 0;
const refreshedView = {
  workPlan: { weekStart: '2026-11-23', status: 'reviewed', tasks: [] },
  currentWorkPlan: { weekStart: '2026-11-16', status: 'scheduled', tasks: [] },
  recentPages: [{ url: 'https://flatkey.ai/blog/refreshed', title: 'Refreshed month ranking', change: 'optimization' }],
};
class DigestError extends Error { constructor(message, status = 409) { super(message); this.status = status; } }
Module._load = function (name, ...rest) {
  if (name === '@/lib/services/seo-reviewed-digest') return { async saveReviewedSeoDigest(input) {
    writes++;
    const report = buildReviewedSeoDigest(base, input, new Date('2026-11-19T10:30:00.000Z'));
    saved.set(report.id, { id: report.id, kind: 'SEO_DIGEST', payload: report }); return report;
  } };
  if (name === '@/lib/services/seo-digest') return { DigestError,
    async generateSeoDigest() { generated++; throw Error('reviewed body must not be regenerated'); },
    async claimDigest() { claims++; throw Error('recording must not claim delivery'); },
    async loadRecentDigestPages() { dynamicReads++; return refreshedView.recentPages; },
    async loadDigestWorkPlan(date, kind) { dynamicReads++; return kind === 'weekly' ? refreshedView.workPlan : refreshedView.currentWorkPlan; },
  };
  if (name === '@/lib/prisma') return { prisma: {
    seoReportVersion: {
      async findUnique({ where }) { return saved.get(where.id) ?? null; },
      async groupBy() { return [{ periodStart: new Date(base.date) }]; },
      async findFirst({ where }) { return where.id ? saved.get(where.id) : [...saved.values()].at(-1); },
    }, seoDigestDelivery: { async findUnique() { return null; } },
  } };
  if (name === '@/lib/services/import-tokens') return { authenticateImportToken: async req => req.headers.get('authorization') === 'Bearer fixture' };
  if (name === '@/lib/seo-analytics-access') return { authorizeAnalyticsRead: async () => false, analyticsLocalPreview: () => false, privateAnalyticsHeaders: { 'cache-control': 'private, no-store' } };
  if (name === '@/lib/seo-workflow-http') return { authorizeWorkflow: async () => { throw Error('unexpected supplement authorization during token-only archive reads'); } };
  if (name === '@/lib/services/seo-digest-recovery') return { DigestRecoveryError: class extends Error {} };
  if (name.startsWith('@/lib/services/')) return new Proxy({}, { get() { return async () => { dynamicReads++; throw Error('no source refresh during reviewed archive reads'); }; } });
  return originalLoad.call(this, name, ...rest);
};
const route = require('../src/app/api/seo/digest/route.ts');
const origin = 'https://flatkey-seo-roadmap.vercel.app/api/seo/digest';
const request = (body, extra = {}) => new Request(origin, { method: 'POST', headers: {
  'content-type': 'application/json', authorization: 'Bearer fixture', ...extra,
}, body: JSON.stringify(body) });

test('save_reviewed uses the unchanged server-token authorization and rejects browser Origin before writing', async () => {
  writes = 0;
  assert.equal((await route.POST(request(command, { authorization: 'Bearer wrong' }))).status, 401);
  assert.equal((await route.POST(request(command, { origin: 'https://flatkey-seo-roadmap.vercel.app' }))).status, 401);
  assert.equal(writes, 0);
  assert.equal((await route.POST(request({ ...command, title: 'Unapproved override' }))).status, 400);
  assert.equal(writes, 0);
  assert.equal((await route.POST(request({ ...command, text: 'x'.repeat(9000) }))).status, 413);
  assert.equal(writes, 0);
});

test('latest archive refreshes a read-only view while explicit IDs retain the exact reviewed snapshot', async () => {
  saved = new Map(); writes = 0; generated = 0; claims = 0; dynamicReads = 0;
  const response = await route.POST(request(command));
  assert.equal(response.status, 200);
  const { report } = await response.json();
  assert.equal(report.text, text); assert.equal(report.hash, command.textSha256);
  const frozen = JSON.stringify(report);
  const reread = await route.POST(request({ action: 'read_saved', reportId: report.id }));
  assert.equal(reread.status, 200); assert.deepEqual((await reread.json()).report, report);
  const latest = await route.GET(new Request(origin + '?kind=weekly&saved=1&archive=1', { headers: { authorization: 'Bearer fixture' } }));
  assert.equal(latest.status, 200);
  const latestPayload = await latest.json();
  assert.deepEqual(latestPayload.report, report);
  assert.deepEqual(latestPayload.view, refreshedView);
  assert.equal(dynamicReads, 3);
  for (const query of [
    '?kind=weekly&date=2026-11-19&saved=1&reportId=' + encodeURIComponent(report.id),
    '?kind=weekly&date=2026-11-19&saved=1&archive=1&reportId=' + encodeURIComponent(report.id),
  ]) {
    const archive = await route.GET(new Request(origin + query, { headers: { authorization: 'Bearer fixture' } }));
    assert.equal(archive.status, 200);
    const payload = await archive.json();
    assert.deepEqual(payload.report, report);
    assert.equal(payload.view, undefined);
    assert.equal(dynamicReads, 3);
  }
  assert.equal(JSON.stringify(saved.get(report.id).payload), frozen);
  assert.equal(writes, 1); assert.equal(generated, 0); assert.equal(claims, 0);
});
