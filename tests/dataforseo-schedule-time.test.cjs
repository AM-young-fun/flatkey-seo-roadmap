const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { serpPeriodFromKey, periodDue, scheduledSerpDue, nextSerpPeriodDue, nextSerpPeriodKey, serpCaptureBelongsToWeek } = require('../src/lib/serp-periods.ts');

test('the next unelapsed DataForSEO slot moves to Thursday 16:00 without changing the 14-day IDs or historical slots', () => {
  assert.equal(periodDue('2026-11-03').toISOString(), '2026-11-05T00:00:00.000Z');
  assert.equal(periodDue('2026-11-17').toISOString(), '2026-11-19T02:10:00.000Z');
  const next = serpPeriodFromKey('2026-12-01');
  assert.equal(next.key, '2026-12-01'); assert.equal(next.start, '2026-12-01'); assert.equal(next.end, '2026-12-14');
  assert.equal(next.dueAt, '2026-12-03T08:00:00.000Z');
  assert.equal(nextSerpPeriodKey(next.key), '2026-12-15');
  assert.equal(nextSerpPeriodDue('2026-11-20T02:00:00Z').toISOString(), next.dueAt);
  assert.equal((+periodDue('2026-12-15') - +periodDue('2026-12-01')) / 86400000, 14);
});

test('future persisted 10:10 cursors are interpreted at 16:00 without rewriting the cursor', () => {
  const cursor = new Date('2026-12-03T02:10:00Z');
  assert.equal(scheduledSerpDue(cursor).toISOString(), '2026-12-03T08:00:00.000Z');
  assert.equal(cursor.toISOString(), '2026-12-03T02:10:00.000Z');
  assert.equal(scheduledSerpDue('2026-11-19T02:10:00Z').toISOString(), '2026-11-19T02:10:00.000Z');
  assert.equal(scheduledSerpDue('2026-12-03T03:45:00Z').toISOString(), '2026-12-03T03:45:00.000Z', 'unrecognized cursors are not silently moved');
});

test('the user-selected Beijing clock stays 16:00 in winter and summer while retaining real LA times', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Honolulu';
    const winter = periodDue('2026-12-01'), summer = periodDue('2027-06-29');
    assert.equal(winter.toISOString().slice(11, 16), '08:00'); assert.equal(summer.toISOString().slice(11, 16), '08:00');
    const clock = value => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(value).map(part => [part.type, part.value]));
    assert.equal(clock(winter).hour, '00'); assert.equal(clock(summer).hour, '01');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('real Thursday collection receipts can bind to the just-closed LA week without borrowing old cycles', () => {
  assert.equal(serpCaptureBelongsToWeek('2026-12-01', '2026-11-26', '2026-12-02'), true);
  assert.equal(serpCaptureBelongsToWeek('2026-11-17', '2026-11-26', '2026-12-02'), false);
  assert.equal(serpCaptureBelongsToWeek('2026-11-17', '2026-11-12', '2026-11-18'), true);
  assert.equal(serpCaptureBelongsToWeek('invalid', '2026-11-12', '2026-11-18'), false);
});
