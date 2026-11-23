const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), originalLoad = Module._load, originalResolve = Module._resolveFilename;
let saved = new Map(), generated = 0, claims = 0;
class DigestError extends Error { constructor(message, status = 409) { super(message); this.status = status; } }
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
Module._resolveFilename = function (name, parent, ...rest) {
  return originalResolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...rest);
};
const { buildSeoDigest } = require('../src/lib/seo-digest.ts');
const service = {
  DigestError,
  async generateSeoDigest(date, _now, kind) {
    generated++;
    return buildSeoDigest({ date, kind, now: new Date(date + 'T17:00:00+08:00'), observations: [], publications: [],
      optimizations: [], effects: [], priorities: [], issues: [], runNotes: [], publicationCoverage: 'missing', optimizationCoverage: 'missing' });
  },
  async saveSeoDigest(report) { saved.set(report.id, { id: report.id, kind: 'SEO_DIGEST', payload: report }); return report; },
  async claimDigest() { claims++; throw Error('preview must never claim delivery'); },
};
Module._load = function (name, ...rest) {
  if (name === '@/lib/services/seo-digest') return service;
  if (name === '@/lib/prisma') return { prisma: { seoReportVersion: { findUnique: async ({ where }) => saved.get(where.id) } } };
  if (name === '@/lib/services/import-tokens') return { authenticateImportToken: async req => req.headers.get('authorization') === 'Bearer fixture' };
  if (name === '@/lib/seo-analytics-access') return { authorizeAnalyticsRead: async () => false, analyticsLocalPreview: () => false, privateAnalyticsHeaders: { 'cache-control': 'private, no-store' } };
  // Supplemental-note authorization is tested separately; preparation never
  // requests it and should not initialize browser-only account dependencies.
  if (name === '@/lib/seo-workflow-http') return { authorizeWorkflow: async () => { throw Error('preparation must not request supplemental-note access'); } };
  if (name === '@/lib/services/seo-digest-recovery') return { DigestRecoveryError: class extends Error {} };
  if (name.startsWith('@/lib/services/')) return {};
  return originalLoad.call(this, name, ...rest);
};
const route = require('../src/app/api/seo/digest/route.ts');
const origin = 'https://flatkey-seo-roadmap.vercel.app/api/seo/digest';
const request = (body, authorized = true) => new Request(origin, { method: 'POST', headers: {
  'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer fixture' } : {}),
}, body: JSON.stringify(body) });

test('Thursday preparation saves and reads the exact LA week without claiming or sending', async () => {
  saved = new Map(); generated = 0; claims = 0;
  const response = await route.POST(request({ action: 'prepare', kind: 'weekly', date: '2026-11-19' }));
  assert.equal(response.status, 200);
  const { report } = await response.json();
  assert.deepEqual(report.reportPeriod, { start: '2026-11-12', end: '2026-11-18', timezone: 'America/Los_Angeles' });
  assert.equal(report.readyAfter, '2026-11-19T16:30:00+08:00');
  assert.deepEqual(report.workWindow, { start: '2026-11-12T08:00:00.000Z', end: '2026-11-19T08:00:00.000Z' });
  const reread = await route.POST(request({ action: 'read_saved', reportId: report.id }));
  assert.deepEqual((await reread.json()).report, report);
  assert.equal(generated, 1); assert.equal(claims, 0);
  const get = await route.GET(new Request(origin + '?kind=weekly&date=2026-11-19', { headers: { authorization: 'Bearer fixture' } }));
  assert.equal(get.status, 200); assert.deepEqual((await get.json()).report.reportPeriod, report.reportPeriod);
});

test('Friday refresh keeps the Thursday-Wednesday period and historical Fridays stay readable', async () => {
  const response = await route.POST(request({ action: 'prepare', kind: 'weekly', date: '2026-11-20' }));
  assert.equal(response.status, 200);
  const { report } = await response.json();
  assert.deepEqual(report.reportPeriod, { start: '2026-11-12', end: '2026-11-18', timezone: 'America/Los_Angeles' });
  assert.equal(report.readyAfter, '2026-11-19T16:30:00+08:00');
  const historical = await route.POST(request({ action: 'prepare', kind: 'weekly', date: '2026-11-13' }));
  assert.equal(historical.status, 200);
  assert.equal((await historical.json()).report.readyAfter, '2026-11-13T10:00:00+08:00');
});

test('invalid weekdays and unauthenticated preparation fail before writes', async () => {
  const count = saved.size, calls = generated;
  for (const date of ['2026-11-25', '2026-11-12']) {
    assert.equal((await route.POST(request({ action: 'prepare', kind: 'weekly', date }))).status, 400);
    assert.equal((await route.GET(new Request(origin + '?kind=weekly&date=' + date, { headers: { authorization: 'Bearer fixture' } }))).status, 400);
  }
  assert.equal((await route.POST(request({ action: 'prepare', kind: 'weekly', date: '2026-11-19' }, false))).status, 401);
  assert.equal(saved.size, count); assert.equal(generated, calls); assert.equal(claims, 0);
});
