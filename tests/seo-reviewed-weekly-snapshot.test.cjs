const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const crypto = require('node:crypto');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { buildSeoDigest } = require('../src/lib/seo-digest.ts');
const { buildReviewedSeoDigest, sameReviewedDigest, ReviewedDigestError } = require('../src/lib/seo-reviewed-digest.ts');
const { actionCardPayload, messageHash } = require('../src/lib/seo-digest-message.cjs');
const { validReportBinding } = require('../scripts/server-seo-digest-send.cjs');
const hash = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const now = new Date('2026-11-19T10:30:00.000Z');
const approvedAt = '2026-11-19T10:25:34.378Z';
const text = '**Flatkey SEO 周报｜2026/11/12—11/18**\n\n'
  + '统计周期：America/Los_Angeles，2026-11-12 至 2026-11-18。\n'
  + '自然访问 1,400；SEO 注册 78。此段是用户批准的正文，不从旧结构化指标重算。\n'
  + '| 站点 | 自然访问 |\n| --- | --- |\n| Flatkey | 1,400 |\n\n'
  + '来源保留实际日期；未来工作仅按原计划复核。\n';
function fixture() {
  const base = buildSeoDigest({ date: '2026-11-19', kind: 'weekly', now: new Date('2026-11-19T09:00:00.000Z'),
    observations: [], publications: [], optimizations: [], effects: [], priorities: [], issues: [], runNotes: [],
    publicationCoverage: 'missing', optimizationCoverage: 'missing' });
  return { base, input: { action: 'save_reviewed', kind: 'weekly', date: base.date,
    baseReportId: base.id, baseReportHash: base.hash, reportPeriod: { ...base.reportPeriod },
    text, textSha256: hash(text), sourceEvidenceSha256: hash('frozen-source-manifest'), approvedAt } };
}
function rejected(base, input, clock = now) {
  assert.throws(() => buildReviewedSeoDigest(base, input, clock));
}

test('reviewed snapshot preserves exact UTF-8 body, trailing newline and source times without mutating its base', () => {
  const { base, input } = fixture(), before = structuredClone(base);
  const reviewed = buildReviewedSeoDigest(base, input, now);
  assert.deepEqual(base, before);
  assert.notEqual(reviewed.id, base.id);
  assert.match(reviewed.id, /^seo-digest:2026-11-19:[a-f0-9]{16}$/);
  assert.equal(reviewed.text, text);
  assert.equal(reviewed.detailText, text);
  assert.equal(reviewed.hash, hash(text));
  assert.equal(reviewed.title, 'Flatkey SEO 周报｜2026/11/12—11/18');
  assert.equal(reviewed.generatedAt, now.toISOString());
  assert.equal(reviewed.reviewedBody.baseGeneratedAt, base.generatedAt);
  assert.equal(reviewed.reviewedBody.approvedAt, approvedAt);
  assert.equal(reviewed.reviewedBody.baseReportId, base.id);
  assert.equal(reviewed.reviewedBody.baseReportHash, base.hash);
  assert.deepEqual(reviewed.reportPeriod, base.reportPeriod);
  assert.deepEqual(reviewed.workWindow, base.workWindow);
  assert.equal(reviewed.readyAfter, base.readyAfter);
  assert.equal(reviewed.deliveryProtocol, 2);
  assert.deepEqual(reviewed.pagePerformance, []);
  assert.deepEqual(reviewed.recentPages, []);
  assert.equal(reviewed.workPlan, undefined);
  assert.equal(reviewed.accountRegistrations, undefined);
  assert.equal(reviewed.organicRegistrationCanCompare, false);
});

test('the unchanged sender consumes the exact reviewed text and derives its card title from the approved first line', () => {
  const { base, input } = fixture();
  const reviewed = buildReviewedSeoDigest(base, input, now);
  const card = actionCardPayload(reviewed);
  assert.equal(card.actionCard.text, text);
  assert.equal(card.actionCard.title, 'Flatkey SEO 周报｜2026/11/12—11/18');
  assert.equal(messageHash(card), hash(JSON.stringify(card)));
  assert.equal(new URL(card.actionCard.singleURL).searchParams.get('reportId'), reviewed.id);
  assert.ok(validReportBinding(reviewed, base.date, 'weekly', reviewed.id));
  assert.equal(validReportBinding({ ...reviewed, text: text.trimEnd() }, base.date, 'weekly', reviewed.id), false);
});

test('any body byte change requires a new SHA and snapshot; no newline or whitespace normalization is allowed', () => {
  const { base, input } = fixture();
  const reviewed = buildReviewedSeoDigest(base, input, now);
  for (const changed of [text.trimEnd(), text.replaceAll('\n', '\r\n'), text + ' ']) {
    rejected(base, { ...input, text: changed });
    const next = buildReviewedSeoDigest(base, { ...input, text: changed, textSha256: hash(changed) }, now);
    assert.equal(next.text, changed);
    assert.equal(next.detailText, changed);
    assert.notEqual(next.id, reviewed.id);
  }
});

test('base identity, text hash and weekly LA period must all bind to the same saved report', () => {
  const { base, input } = fixture();
  rejected(base, { ...input, baseReportId: 'seo-digest:2026-11-19:0000000000000000' });
  rejected(base, { ...input, baseReportHash: '0'.repeat(64) });
  rejected({ ...base, text: base.text + 'tampered' }, input);
  rejected({ ...base, kind: 'daily' }, input);
  rejected(base, { ...input, kind: 'daily' });
  rejected(base, { ...input, date: '2026-11-20' });
  rejected(base, { ...input, reportPeriod: { ...input.reportPeriod, start: '2026-11-11' } });
  rejected(base, { ...input, reportPeriod: { ...input.reportPeriod, timezone: 'Asia/Shanghai' } });
  rejected({ ...base, workWindow: { ...base.workWindow, start: '2026-11-12T00:00:00.000Z' } }, input);
  rejected({ ...base, deliveryProtocol: 1 }, input);
  rejected({ ...base, readyAfter: '2026-11-20T10:00:00+08:00' }, input);
});

test('saving is constrained by the actual Beijing day and authentic approval chronology', () => {
  const { base, input } = fixture();
  assert.ok(buildReviewedSeoDigest(base, input, new Date('2026-11-19T15:59:59.999Z')));
  rejected(base, input, new Date('2026-11-19T16:00:00.000Z'));
  rejected(base, { ...input, approvedAt: '2026-11-19T10:30:00.001Z' });
  rejected(base, { ...input, approvedAt: '2026-11-19T08:59:59.999Z' });
});

test('the strict command excludes client-controlled delivery fields and invalid content', () => {
  const { base, input } = fixture();
  for (const extra of [{ id: base.id }, { generatedAt: now.toISOString() }, { destination: 'another-group' },
    { robotCode: 'another-bot' }, { readyAfter: base.readyAfter }, { title: 'Unapproved title' }]) rejected(base, { ...input, ...extra });
  for (const invalidText of ['too short', text + '\u0000', text.repeat(60)]) {
    rejected(base, { ...input, text: invalidText, textSha256: hash(invalidText) });
  }
});

test('immutable readback comparison accepts the original saved snapshot and rejects conflicting provenance or content', () => {
  const { base, input } = fixture();
  const expected = buildReviewedSeoDigest(base, input, now);
  const stored = JSON.parse(JSON.stringify(expected));
  assert.ok(sameReviewedDigest(stored, expected));
  assert.ok(sameReviewedDigest({ ...stored, generatedAt: base.generatedAt }, expected), 'idempotent readback retains first actual archive time');
  for (const mutate of [
    report => { report.title += 'changed'; },
    report => { report.text += '\n'; },
    report => { report.detailText += '\n'; },
    report => { report.hash = '0'.repeat(64); },
    report => { report.reviewedBody.sourceEvidenceSha256 = '0'.repeat(64); },
    report => { report.reviewedBody.baseReportId = 'seo-digest:2026-11-19:0000000000000000'; },
    report => { report.reviewedBody.approvedAt = '2026-11-19T10:24:00.000Z'; },
    report => { report.reportPeriod.start = '2026-11-11'; },
  ]) {
    const conflicting = structuredClone(stored); mutate(conflicting);
    assert.equal(sameReviewedDigest(conflicting, expected), false);
  }
  assert.ok(ReviewedDigestError.prototype instanceof Error);
});
