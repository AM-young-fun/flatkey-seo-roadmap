const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { reportDay, reportDayStart, reportTime, dailyReportArchiveOnly } = require('../src/lib/seo-report-time.cjs');
const { digestWindow, buildSeoDigest } = require('../src/lib/seo-digest.ts');
const { seoToday } = require('../src/lib/seo-date-range.ts');

test('report business dates use LA midnight independently of host and content workflow dates', () => {
  const before = new Date('2026-11-20T07:59:59Z'), after = new Date('2026-11-20T08:00:00Z');
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Asia/Shanghai', 'Pacific/Honolulu']) {
      process.env.TZ = zone;
      assert.equal(reportDay(before), '2026-11-19'); assert.equal(reportDay(after), '2026-11-20');
      assert.equal(seoToday(before), '2026-11-20', 'shared content dates retain Beijing semantics');
      assert.equal(reportDay(new Date('2027-07-01T06:59:59Z')), '2027-06-30');
      assert.equal(reportDay(new Date('2027-07-01T07:00:00Z')), '2027-07-01');
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('new daily reports cover the previous complete LA day and become ready at LA 02:00', () => {
  assert.deepEqual(digestWindow('2026-11-19'), { kind: 'daily', workStart: '2026-11-18T08:00:00.000Z',
    workEnd: '2026-11-19T08:00:00.000Z', workTimezone: 'America/Los_Angeles', readyAfter: '2026-11-19T10:00:00.000Z',
    trafficStart: '2026-11-18', trafficEnd: '2026-11-18' });
  assert.equal(digestWindow('2027-07-01').readyAfter, '2027-07-01T09:00:00.000Z');
  const input = { date: '2026-11-19', observations: [], publications: [], optimizations: [], effects: [],
    priorities: [], issues: [], runNotes: [], publicationCoverage: 'missing', optimizationCoverage: 'missing' };
  assert.equal(buildSeoDigest({ ...input, now: new Date('2026-11-19T09:59:59Z') }).preliminary, true);
  assert.equal(buildSeoDigest({ ...input, now: new Date('2026-11-19T10:00:00Z') }).preliminary, false);
});

test('LA source days can be 23 or 25 hours and missing sender clocks remain archivable', () => {
  const spring = digestWindow('2027-03-15'), autumn = digestWindow('2027-11-08');
  assert.equal((Date.parse(spring.workEnd) - Date.parse(spring.workStart)) / 3600000, 23);
  assert.equal((Date.parse(autumn.workEnd) - Date.parse(autumn.workStart)) / 3600000, 25);
  assert.equal(reportDayStart('2027-03-14'), '2027-03-14T08:00:00.000Z');
  assert.equal(reportDayStart('2027-03-15'), '2027-03-15T07:00:00.000Z');
  assert.equal(reportTime('2027-03-14', 2), '2027-03-14T10:00:00.000Z', 'nonexistent 02:00 resolves to 03:00 for archive readiness, not a scheduled send');
  assert.equal(reportTime('2027-11-07', 2), '2027-11-07T10:00:00.000Z');
});

test('historical periods and the exact first reviewed weekly ready binding remain unchanged', () => {
  const old = digestWindow('2026-11-18');
  assert.equal(old.workStart, '2026-11-17T18:00:00+08:00'); assert.equal(old.workEnd, '2026-11-18T18:00:00+08:00');
  for (const date of ['2026-11-19', '2026-11-20']) {
    const current = digestWindow(date, 'weekly');
    assert.equal(current.workStart, '2026-11-12T08:00:00.000Z'); assert.equal(current.workEnd, '2026-11-19T08:00:00.000Z');
    assert.equal(current.readyAfter, '2026-11-19T16:30:00+08:00');
  }
  assert.equal(digestWindow('2027-07-01', 'weekly').readyAfter, '2027-07-01T07:30:00.000Z');
  assert.equal(digestWindow('2026-11-26', 'weekly').readyAfter, '2026-11-26T08:30:00.000Z');
});

test('Thursday archive policy uses the actual LA day and explicit report business date', () => {
  assert.equal(dailyReportArchiveOnly('2026-11-18', new Date('2026-11-18T16:01:00Z')), false, 'Beijing Thursday is still LA Wednesday');
  assert.equal(dailyReportArchiveOnly('2026-11-20', new Date('2026-11-20T00:01:00Z')), true, 'Beijing Friday is still LA Thursday');
  assert.equal(dailyReportArchiveOnly('2026-11-19', new Date('2026-11-20T10:00:00Z')), true, 'an explicit Thursday report cannot be sent later');
});
