const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { continueApprovedOtherKeywordReview } = require('../src/lib/approved-other-keyword-review-client.ts');
const hash = '594de337ece1521c6ff32c2fa9ab22948a0f3531dd96ce7f81bd9e0f11a271ef';
const view = (counts, status = 'RUNNING', extra = {}) => ({ quoteId: 'other-country-query-proposal-v2', runId: 'approved-other-keyword-review-20261123-v1', scope: 'APPROVED_OTHER_KEYWORD_REVIEW', approved: true, queryCount: 467, maxCostMicros: 2802000,
  run: counts ? { status, startedAt: '2026-11-23T00:00:00Z', completedAt: null, actualCostMicros: 0, errorCode: null, taskCounts: counts, ...extra } : null, quoteSha256: hash, totalKeywordCount: 468, reuseCount: 1, combinedMaxCostMicros: 8988000, combinedApprovedCapMicros: 8994000, gate: { firstRunComplete: true, reason: null }, countries: [], items: [] });
const ready = () => view({ PLANNED: 467 }, 'PLANNED');
const done = () => view({ COMPLETE: 467 }, 'COMPLETED');
const base = { stopped: () => false, progress() {}, wait: async () => {} };

test('explicit continuation prepares only once, submits one serial batch per pass, then only collects', async () => {
  const calls = [], delays = []; let active = 0;
  const replies = [ready(), view({ PLANNED: 67, SUBMITTED: 400 }), view({ SUBMITTED: 467 }), done()];
  const result = await continueApprovedOtherKeywordReview({ ...base, read: async () => view(null),
    post: async command => { assert.equal(active++, 0); calls.push(command); await Promise.resolve(); active--; return replies.shift(); },
    wait: async ms => delays.push(ms) });
  assert.equal(result, 'finished');
  assert.deepEqual(calls.map(x => x.action), ['prepare', 'resume', 'resume', 'collect']);
  assert.ok(calls.every(x => x.quoteSha256 === hash && x.maxCostMicros === 2802000 && Object.keys(x).length === 3));
  assert.deepEqual(delays, [3000, 3000]);
});

test('an existing ledger resumes without preparing a new one and completed ledgers never POST', async () => {
  const calls = [];
  await continueApprovedOtherKeywordReview({ ...base, read: async () => ready(), post: async command => { calls.push(command.action); return done(); } });
  assert.deepEqual(calls, ['resume']);
  assert.equal(await continueApprovedOtherKeywordReview({ ...base, read: async () => done(), post: async () => assert.fail('no POST') }), 'finished');
});

test('a lost paid response stops, reconciles with one GET and never retries its POST', async () => {
  let reads = 0, posts = 0; const progress = [];
  await assert.rejects(continueApprovedOtherKeywordReview({ ...base, read: async () => ++reads === 1 ? ready() : view({ SUBMITTED: 467 }),
    post: async () => { posts++; throw new Error('NETWORK_AMBIGUOUS'); }, progress: x => progress.push(x), wait: async () => assert.fail('no retry wait') }), /未自动重试/);
  assert.equal(posts, 1); assert.equal(reads, 2); assert.equal(progress.at(-1).run.taskCounts.SUBMITTED, 467);
});

test('unknown, failed, account, cost, partial or paused receipts stop all future paid actions', async () => {
  for (const saved of [view({ UNKNOWN: 1, PLANNED: 466 }), view({ FAILED: 1, PLANNED: 466 }), readyWithError('ACCOUNT_UNAVAILABLE'), readyWithError('BUDGET_LIMIT'), view({ COMPLETE: 400, INCOMPLETE: 67 }, 'PARTIAL'), view({ PLANNED: 467 }, 'PAUSED')]) {
    assert.equal(await continueApprovedOtherKeywordReview({ ...base, read: async () => saved, post: async () => assert.fail('must stop') }), 'needs_review');
  }
  function readyWithError(errorCode) { return view({ PLANNED: 467 }, 'RUNNING', { errorCode }); }
});

test('scope, quote, cap, incomplete counts and invalid costs fail closed', async () => {
  const bad = [{ ...ready(), maxCostMicros: 8994000 }, { ...ready(), queryCount: 1499 }, { ...ready(), approved: false }, { ...ready(), runId: 'other-run' }, { ...ready(), scope: 'SCHEDULED' }, { ...ready(), quoteId: 'other-quote' }, view({ PLANNED: 466 }), view({ PLANNED: 467 }, 'RUNNING', { actualCostMicros: 2802001 }), view({ PLANNED: 467 }, 'RUNNING', { actualCostMicros: NaN })];
  for (const saved of bad) await assert.rejects(continueApprovedOtherKeywordReview({ ...base, read: async () => saved, post: async () => assert.fail('no POST') }));
});

test('stop while a request is in flight preserves its receipt and prevents a second submit', async () => {
  let stop = false, resolvePost, markStarted; const calls = [], seen = [];
  const started = new Promise(resolve => { markStarted = resolve; });
  const result = continueApprovedOtherKeywordReview({ ...base, stopped: () => stop, read: async () => ready(),
    post: async command => { calls.push(command.action); markStarted(); return new Promise(resolve => { resolvePost = resolve; }); }, progress: x => seen.push(x) });
  await started; stop = true; resolvePost(view({ PLANNED: 67, SUBMITTED: 400 }));
  assert.equal(await result, 'stopped'); assert.deepEqual(calls, ['resume']); assert.equal(seen.at(-1).run.taskCounts.SUBMITTED, 400);
});

test('unmounted or stopped clients do not even read, prepare or submit', async () => {
  assert.equal(await continueApprovedOtherKeywordReview({ ...base, stopped: () => true, read: async () => assert.fail('no read'), post: async () => assert.fail('no POST') }), 'stopped');
});

test('unknown submit receipt is retained and never continued even with planned words remaining', async () => {
  let posts = 0;
  const result = await continueApprovedOtherKeywordReview({ ...base, read: async () => ready(), post: async () => { posts++; return view({ UNKNOWN: 100, PLANNED: 367 }); } });
  assert.equal(result, 'needs_review'); assert.equal(posts, 1);
});


test('pending first batch prevents prepare or resume; collection of paid IDs remains free and recoverable', async () => {
  const blocked = { ...view(null), gate: { firstRunComplete: false, reason: 'FIRST_BATCH_NOT_FINISHED' } };
  for (const saved of [blocked, { ...ready(), gate: blocked.gate }]) {
    await assert.rejects(continueApprovedOtherKeywordReview({ ...base, read: async () => saved, post: async () => assert.fail('no new paid work') }), /FIRST_BATCH_NOT_FINISHED/);
  }
  const calls = [];
  const result = await continueApprovedOtherKeywordReview({ ...base, read: async () => ({ ...view({ SUBMITTED: 467 }), gate: blocked.gate }), post: async command => { calls.push(command.action); return { ...done(), gate: blocked.gate }; } });
  assert.equal(result, 'finished'); assert.deepEqual(calls, ['collect']);
});

test('the extra reused word cannot be converted into a new paid task, and the combined cap cannot expand', async () => {
  const invalid = [{ ...ready(), queryCount: 468 }, { ...ready(), totalKeywordCount: 467 }, { ...ready(), reuseCount: 0 }, { ...ready(), quoteSha256: 'wrong' }, { ...ready(), combinedMaxCostMicros: 8994000 }, { ...ready(), combinedApprovedCapMicros: 9000000 }];
  for (const saved of invalid) await assert.rejects(continueApprovedOtherKeywordReview({ ...base, read: async () => saved, post: async () => assert.fail('no POST') }));
});
