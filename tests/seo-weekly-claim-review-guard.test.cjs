const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), crypto = require('node:crypto');
const { createRequire } = require('node:module');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const root = path.resolve(__dirname, '..'), filename = path.join(root, 'src/lib/services/seo-digest.ts');
const { buildSeoDigest } = require('../src/lib/seo-digest.ts');
const { buildDraftSeoDigest } = require('../src/lib/seo-draft-digest.ts');
const { buildReviewedSeoDigest } = require('../src/lib/seo-reviewed-digest.ts');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const now = new Date('2026-11-26T10:30:00.000Z');

function fixture(kind = 'weekly', legacy = false) {
  const date = legacy ? '2026-11-19' : kind === 'daily' ? '2026-11-25' : '2026-11-26';
  const clock = legacy ? new Date('2026-11-19T10:30:00.000Z') : kind === 'daily' ? new Date('2026-11-25T10:30:00.000Z') : now;
  const base = buildSeoDigest({ date, kind, now: new Date(clock.getTime() - (kind === 'daily' ? 20 : 90) * 60000),
    observations: [], publications: [], optimizations: [], effects: [], priorities: [], issues: [], runNotes: [],
    publicationCoverage: 'missing', optimizationCoverage: 'missing' });
  if (kind === 'daily') return { base, report: { ...base, generatedAt: new Date(clock.getTime() - 60000).toISOString(),
    dailyDashboardBody: { version: 1, recordOnly: true, baseReportId: base.id, baseReportHash: base.hash } }, clock };
  const text = base.text + '\n本期确切全文已由用户审核，保留来源和统计窗口。\n';
  const sourceHash = hash('fixture-frozen-source');
  const draft = legacy ? base : buildDraftSeoDigest(base, { action: 'save_draft', kind, date, baseReportId: base.id,
    baseReportHash: base.hash, reportPeriod: base.reportPeriod, text, textSha256: hash(text), sourceEvidenceSha256: sourceHash },
  new Date(clock.getTime() - 10 * 60000));
  const approvedText = legacy ? text : draft.text;
  const report = buildReviewedSeoDigest(draft, { action: 'save_reviewed', kind, date, baseReportId: draft.id,
    baseReportHash: draft.hash, reportPeriod: draft.reportPeriod, text: approvedText, textSha256: hash(approvedText),
    sourceEvidenceSha256: sourceHash, approvedAt: new Date(clock.getTime() - 6 * 60000).toISOString() },
  new Date(clock.getTime() - 5 * 60000));
  return { base: draft, generic: base, report, clock };
}

function service({ base, report, clock, transport = 'application-bot', delivered = false }) {
  const rows = new Map(), creates = [], reads = [];
  const record = payload => ({ id: payload.id, kind: 'SEO_DIGEST', siteDomain: 'flatkey.ai',
    periodStart: new Date(payload.date), periodEnd: new Date(payload.date), payload });
  if (base) rows.set(base.id, record(base));
  rows.set(report.id, record(report));
  const prior = delivered ? { id: `seo-digest-delivery:${report.kind}:${report.date}`, status: 'DELIVERED',
    reportId: report.id, fencingToken: 2, leaseUntil: null } : null;
  const tx = {
    seoReportVersion: { async findUnique({ where }) { reads.push(where.id); return rows.get(where.id) ?? null; } },
    async $executeRaw() {}, async $queryRaw() { return [{ now: clock }]; },
    seoDigestDelivery: { async findUnique() { return prior; }, async create({ data }) { creates.push(data); return data; },
      async update() { throw Error('unexpected_delivery_update'); } },
  };
  const actual = createRequire(filename), module = { exports: {} };
  const mapped = new Map([
    ['@/lib/prisma', { prisma: { $transaction: fn => fn(tx) } }],
    ['./seo-reporting-control', { getSeoReportingControl: async () => ({ enabled: true, protocolVersion: 2,
      destination: require('../src/lib/seo-digest.ts').SEO_REPORT_GROUP, robotCode: 'fixture-bot', transport, version: 1 }) }],
    ['@/lib/seo-digest', require('../src/lib/seo-digest.ts')],
    ['@/lib/seo-report-time.cjs', require('../src/lib/seo-report-time.cjs')],
    ['@/lib/seo-cluster-sites', { CLUSTER_SITES: [] }],
    ['../seo-digest-message.cjs', require('../src/lib/seo-digest-message.cjs')],
    ['../seo-weekly-review-window', require('../src/lib/seo-weekly-review-window.ts')],
    ['../seo-reviewed-digest', require('../src/lib/seo-reviewed-digest.ts')],
  ]);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date, console,
    require(name) { return mapped.has(name) ? mapped.get(name) : name === 'node:crypto' ? actual(name) : {}; },
  }, { filename });
  return { claim: () => module.exports.claimDigest(report.id, 'fixture-owner', clock, transport,
    transport === 'signed-webhook' ? 'actionCard' : undefined), creates, reads, rows };
}

test('same-LA-day generic weekly preparation cannot claim without exact user review', async () => {
  const { generic, clock } = fixture();
  for (const transport of ['application-bot', 'signed-webhook']) {
    const s = service({ report: generic, clock, transport });
    await assert.rejects(s.claim(), error => error.status === 409 && /先批准/.test(error.message));
    assert.equal(s.creates.length, 0);
  }
});

test('same-day exact reviewed weekly body passes original claim transport and hash binding', async () => {
  for (const transport of ['application-bot', 'signed-webhook']) {
    const f = fixture(), s = service({ ...f, transport });
    const claimed = await s.claim();
    assert.equal(claimed.report.id, f.report.id);
    assert.equal(claimed.report.hash, f.report.hash);
    assert.equal(s.creates.length, 1);
    assert.ok(s.reads.includes(f.base.id));
    assert.equal(s.creates[0].reportHash, f.report.hash);
  }
});

test('reviewed weekly mutations and wrong immutable source fail before delivery creation', async () => {
  for (const mutate of [
    f => { f.report.text += '\nchanged'; },
    f => { f.report.hash = '0'.repeat(64); },
    f => { f.report.reviewedBody.baseReportHash = '0'.repeat(64); },
    f => { f.report.reviewedBody.sourceEvidenceSha256 = '0'.repeat(64); },
    f => { f.report.reviewedBody.approvedAt = new Date(f.clock.getTime() + 60000).toISOString(); },
    f => { f.base.id = 'seo-digest:2026-11-26:0000000000000000'; },
  ]) {
    const f = fixture(); mutate(f); const s = service(f);
    await assert.rejects(s.claim(), error => error.status === 409 && /审批来源|已审正文/.test(error.message));
    assert.equal(s.creates.length, 0);
  }
});

test('legacy reviewed versions remain valid and already-delivered snapshots cannot be duplicated', async () => {
  const f = fixture('weekly', true);
  assert.equal((await service(f).claim()).report.id, f.report.id);
  const s = service({ ...f, delivered: true }), original = structuredClone(f.report);
  await assert.rejects(s.claim(), error => /当天该类报告已发送/.test(error.message));
  assert.equal(s.creates.length, 0);
  assert.deepEqual(s.rows.get(f.report.id).payload, original);
});

test('a current-week exact review approved after the LA date changes keeps its signed-webhook path', async () => {
  const f = fixture(), clock = new Date('2026-11-27T10:30:00.000Z');
  const approved = f.report.reviewedBody;
  const report = buildReviewedSeoDigest(f.base, { action: 'save_reviewed', kind: 'weekly', date: f.report.date,
    baseReportId: f.base.id, baseReportHash: f.base.hash, reportPeriod: f.report.reportPeriod,
    text: f.report.text, textSha256: approved.textSha256, sourceEvidenceSha256: approved.sourceEvidenceSha256,
    approvedAt: '2026-11-27T10:24:00.000Z' }, new Date('2026-11-27T10:25:00.000Z'));
  const s = service({ base: f.base, report, clock, transport: 'signed-webhook' });
  assert.equal((await s.claim()).report.id, report.id);
  assert.equal(s.creates.length, 1);
});

test('daily record-only archives retain their original claim eligibility', async () => {
  const f = fixture('daily'), s = service(f);
  assert.equal((await s.claim()).report.id, f.report.id);
  assert.equal(s.creates.length, 1);
});
