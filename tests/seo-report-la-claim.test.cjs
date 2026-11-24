const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), originalLoad = Module._load, originalResolve = Module._resolveFilename;
const serviceFile = path.join(root, 'src/lib/services/seo-digest.ts');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
Module._resolveFilename = function (name, parent, ...rest) {
  return originalResolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...rest);
};
const { buildSeoDigest, SEO_REPORT_GROUP } = require('../src/lib/seo-digest.ts');
const { buildReviewedSeoDigest, reviewedTextHash } = require('../src/lib/seo-reviewed-digest.ts');
let report, reviewBase, clock, writes = 0;
const control = { enabled: true, protocolVersion: 2, destination: SEO_REPORT_GROUP, robotCode: 'fixture', transport: 'application-bot' };
const tx = { seoReportVersion: { findUnique: async ({ where }) => {
  const payload = where.id === reviewBase?.id ? reviewBase : where.id === report.id ? report : null;
  return payload ? { id: payload.id, kind: 'SEO_DIGEST', siteDomain: 'flatkey.ai',
    periodStart: new Date(payload.date), periodEnd: new Date(payload.date), payload } : null;
} },
  $executeRaw: async () => 1, $queryRaw: async () => [{ now: clock }], seoDigestDelivery: {
    findUnique: async () => null, create: async ({ data }) => { writes++; return data; },
    update: async () => assert.fail('fixture has no prior ledger'),
  } };
Module._load = function (name, parent, ...rest) {
  if (name === '@/lib/prisma') return { prisma: { $transaction: callback => callback(tx) } };
  if (parent?.filename === serviceFile && name === './seo-reporting-control') return { getSeoReportingControl: async () => control };
  if (parent?.filename === serviceFile && name.startsWith('./')) return {};
  return originalLoad.call(this, name, parent, ...rest);
};
const { claimDigest } = require(serviceFile);
Module._load = originalLoad;

function fixture(date, now, kind = 'daily') {
  clock = new Date(now); writes = 0; reviewBase = undefined;
  report = buildSeoDigest({ date, kind, now: clock, observations: [], publications: [], optimizations: [], effects: [],
    priorities: [], issues: [], runNotes: [], publicationCoverage: 'missing', optimizationCoverage: 'missing' });
  return report;
}

test('a current LA Friday report can be claimed even when Beijing is already Saturday', async () => {
  const saved = fixture('2026-11-20', '2026-11-20T23:59:59Z');
  const result = await claimDigest(saved.id, 'fixture', clock);
  assert.equal(result.id, 'seo-digest-delivery:daily:2026-11-20'); assert.equal(writes, 1);
});

test('a Beijing-current date cannot replace the actual LA business date', async () => {
  const saved = fixture('2026-11-21', '2026-11-20T23:59:59Z');
  await assert.rejects(claimDigest(saved.id, 'fixture', clock), /洛杉矶当天/); assert.equal(writes, 0);
});

test('LA Thursday blocks the claim before any delivery ledger mutation', async () => {
  const saved = fixture('2026-11-20', '2026-11-20T00:01:00Z');
  await assert.rejects(claimDigest(saved.id, 'fixture', clock), /周四日报只归档/); assert.equal(writes, 0);
});

test('old-window daily snapshots remain untouched and cannot be claimed under the new LA contract', async () => {
  const saved = fixture('2026-11-20', '2026-11-20T10:00:00Z');
  report = { ...saved, workWindow: { start: '2026-11-19T18:00:00+08:00', end: '2026-11-20T18:00:00+08:00' } };
  const before = structuredClone(report);
  await assert.rejects(claimDigest(report.id, 'fixture', clock), /统计窗口已过期/);
  assert.deepEqual(report, before); assert.equal(writes, 0);
});

test('the existing reviewed first weekly period keeps its original readyAfter and can use LA same-day binding', async () => {
  const saved = fixture('2026-11-19', '2026-11-20T00:01:00Z', 'weekly');
  assert.equal(saved.readyAfter, '2026-11-19T16:30:00+08:00');
  reviewBase = saved;
  report = buildReviewedSeoDigest(saved, { action: 'save_reviewed', kind: 'weekly', date: saved.date,
    baseReportId: saved.id, baseReportHash: saved.hash, reportPeriod: saved.reportPeriod,
    text: saved.text, textSha256: reviewedTextHash(saved.text),
    sourceEvidenceSha256: reviewedTextHash('fixture-exact-original-sources'), approvedAt: clock.toISOString() }, clock);
  const result = await claimDigest(report.id, 'fixture', clock);
  assert.equal(result.id, 'seo-digest-delivery:weekly:2026-11-19'); assert.equal(writes, 1);
});
