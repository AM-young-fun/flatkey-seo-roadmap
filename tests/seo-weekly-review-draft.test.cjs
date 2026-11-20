const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), Module = require('node:module'), crypto = require('node:crypto');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, f);
const { buildSeoDigest } = require('../src/lib/seo-digest.ts');
const { buildDraftSeoDigest } = require('../src/lib/seo-draft-digest.ts');
const { buildReviewedSeoDigest } = require('../src/lib/seo-reviewed-digest.ts');
const { validReportBinding } = require('../scripts/server-seo-digest-send.cjs');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const now = new Date('2026-11-19T10:30:00Z');
function fixture() {
  const base = buildSeoDigest({ date: '2026-11-19', kind: 'weekly', now: new Date('2026-11-19T09:00:00Z'),
    observations: [], publications: [], optimizations: [], effects: [], priorities: [], issues: [], runNotes: [],
    publicationCoverage: 'missing', optimizationCoverage: 'missing' });
  const text = '**Flatkey SEO 周报｜2026/11/12—11/18｜审核稿**\n\n'
    + ['一', '二', '三', '四', '五', '六'].map(n => `**${n}、完整正文**\n\n自然搜索流量与注册各按明确口径统计；具体页面和链接保留。`).join('\n\n') + '\n';
  const input = { action: 'save_draft', kind: 'weekly', date: base.date, baseReportId: base.id, baseReportHash: base.hash,
    reportPeriod: base.reportPeriod, text, textSha256: hash(text), sourceEvidenceSha256: hash('sources') };
  return { base, input };
}
test('a complete pending review keeps exact body and source binding, carries no approval, and cannot pass sender binding', () => {
  const { base, input } = fixture(), before = structuredClone(base);
  const draft = buildDraftSeoDigest(base, input, now);
  assert.deepEqual(base, before);
  assert.equal(draft.text, input.text); assert.equal(draft.detailText, input.text); assert.equal(draft.hash, input.textSha256);
  assert.equal(draft.draftBody.pendingReview, true); assert.equal(draft.draftBody.sourceEvidenceSha256, input.sourceEvidenceSha256);
  assert.equal(draft.reviewedBody, undefined); assert.equal('approvedAt' in draft.draftBody, false);
  assert.equal(validReportBinding(draft, draft.date, 'weekly', draft.id), false);
  assert.deepEqual(draft.pagePerformance, base.pagePerformance); assert.equal(draft.workPlan, base.workPlan);
  assert.equal(draft.dashboard.detailText, base.detailText);
});
test('approval records another immutable identity and clears pending-review metadata', () => {
  const { base, input } = fixture(); const draft = buildDraftSeoDigest(base, input, now);
  const reviewed = buildReviewedSeoDigest(draft, { ...input, action: 'save_reviewed', baseReportId: draft.id,
    baseReportHash: draft.hash, approvedAt: '2026-11-19T10:31:00Z' }, new Date('2026-11-19T10:32:00Z'));
  assert.notEqual(reviewed.id, draft.id); assert.equal(reviewed.text, draft.text);
  assert.equal(reviewed.draftBody, undefined); assert.ok(reviewed.reviewedBody.approvedAt);
  assert.equal(validReportBinding(reviewed, reviewed.date, 'weekly', reviewed.id), true);
  assert.equal(draft.reviewedBody, undefined);
  assert.throws(() => buildReviewedSeoDigest(draft, { ...input, action: 'save_reviewed', baseReportId: draft.id,
    baseReportHash: draft.hash, text: draft.text+'changed', textSha256:hash(draft.text+'changed'), approvedAt:'2026-11-19T10:31:00Z' },new Date('2026-11-19T10:32:00Z')));
});
test('draft writes reject forged approval, changed hashes, periods or incomplete six-section bodies', () => {
  const { base, input } = fixture();
  for (const changed of [{ approvedAt: now.toISOString() }, { textSha256: '0'.repeat(64) },
    { baseReportHash: '0'.repeat(64) }, { reportPeriod: { ...input.reportPeriod, end: '2026-11-17' } },
    { text: input.text.replace('**六、', '**七、'), textSha256: hash(input.text.replace('**六、', '**七、')) }]) {
    assert.throws(() => buildDraftSeoDigest(base, { ...input, ...changed }, now));
  }
});
test('draft storage creates and reads an immutable row; replay keeps first time and never touches delivery state', async () => {
  const { base, input } = fixture();
  const record = { id: base.id, kind: 'SEO_DIGEST', siteDomain: 'flatkey.ai', periodStart: new Date(base.date), periodEnd: new Date(base.date), payload: structuredClone(base) };
  const rows = new Map([[base.id, record]]), prior = Module._load;
  Module._load = function(name, ...rest) {
    if (name === '@/lib/prisma') return { prisma: { seoReportVersion: {
      async findUnique({where}) { return rows.get(where.id); },
      async createMany({data,skipDuplicates}) { assert.equal(skipDuplicates,true); if(!rows.has(data.id)) rows.set(data.id,data); },
    } } };
    return prior.call(this,name,...rest);
  };
  let saveDraftSeoDigest;
  try { ({ saveDraftSeoDigest } = require('../src/lib/services/seo-draft-digest.ts')); } finally { Module._load = prior; }
  const saved = await saveDraftSeoDigest(input,now);
  const replay = await saveDraftSeoDigest(input,new Date('2026-11-20T02:00:00Z'));
  assert.equal(rows.size,2); assert.equal(replay.generatedAt,saved.generatedAt);
  assert.deepEqual(rows.get(base.id),record);
  rows.get(saved.id).payload.text += 'tamper';
  await assert.rejects(saveDraftSeoDigest(input,now),e=>e.status===409);
});
