const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { continueApprovedKeywordReview } = require('../src/lib/approved-keyword-review-client.ts');
const hash = '593fe62523e30b831e7c6d821f8278ab0c9b345a27f8271c970cdbe4ca025e86';
const view = (counts, status = 'RUNNING', extra = {}) => ({ quoteId: 'keyword-fee-review-20261123-v1', runId: 'approved-keyword-review-20261123-v1', scope: 'APPROVED_KEYWORD_REVIEW', approved: true, queryCount: 1031, maxCostMicros: 6186000,
  run: counts ? { status, startedAt: '2026-11-23T00:00:00Z', completedAt: null, actualCostMicros: 0, errorCode: null, taskCounts: counts, ...extra } : null, countries: [], otherCountries: { label: '', count: 468, paidQueries: 0, rows: [] } });
const ready = () => view({ PLANNED: 1031 }, 'PLANNED');
const done = () => view({ COMPLETE: 1031 }, 'COMPLETED');
const base = { stopped: () => false, progress() {}, wait: async () => {} };

test('explicit continuation prepares only once, submits one serial batch per pass, then only collects', async () => {
  const calls = [], delays = []; let active = 0;
  const replies = [ready(), view({ PLANNED: 31, SUBMITTED: 1000 }), view({ SUBMITTED: 1031 }), done()];
  const result = await continueApprovedKeywordReview({ ...base, read: async () => view(null),
    post: async command => { assert.equal(active++, 0); calls.push(command); await Promise.resolve(); active--; return replies.shift(); },
    wait: async ms => delays.push(ms) });
  assert.equal(result, 'finished');
  assert.deepEqual(calls.map(x => x.action), ['prepare', 'resume', 'resume', 'collect']);
  assert.ok(calls.every(x => x.quoteSha256 === hash && x.maxCostMicros === 6186000 && Object.keys(x).length === 3));
  assert.deepEqual(delays, [3000, 3000]);
});

test('an existing ledger resumes without preparing a new one and completed ledgers never POST', async () => {
  const calls = [];
  await continueApprovedKeywordReview({ ...base, read: async () => ready(), post: async command => { calls.push(command.action); return done(); } });
  assert.deepEqual(calls, ['resume']);
  assert.equal(await continueApprovedKeywordReview({ ...base, read: async () => done(), post: async () => assert.fail('no POST') }), 'finished');
});

test('a lost paid response stops, reconciles with one GET and never retries its POST', async () => {
  let reads = 0, posts = 0; const progress = [];
  await assert.rejects(continueApprovedKeywordReview({ ...base, read: async () => ++reads === 1 ? ready() : view({ SUBMITTED: 1031 }),
    post: async () => { posts++; throw new Error('NETWORK_AMBIGUOUS'); }, progress: x => progress.push(x), wait: async () => assert.fail('no retry wait') }), /未自动重试/);
  assert.equal(posts, 1); assert.equal(reads, 2); assert.equal(progress.at(-1).run.taskCounts.SUBMITTED, 1031);
});

test('unknown, failed, account, cost, partial or paused receipts stop all future paid actions', async () => {
  for (const saved of [view({ UNKNOWN: 1, PLANNED: 1030 }), view({ FAILED: 1, PLANNED: 1030 }), readyWithError('ACCOUNT_UNAVAILABLE'), readyWithError('BUDGET_LIMIT'), view({ COMPLETE: 1000, INCOMPLETE: 31 }, 'PARTIAL'), view({ PLANNED: 1031 }, 'PAUSED')]) {
    assert.equal(await continueApprovedKeywordReview({ ...base, read: async () => saved, post: async () => assert.fail('must stop') }), 'needs_review');
  }
  function readyWithError(errorCode) { return view({ PLANNED: 1031 }, 'RUNNING', { errorCode }); }
});

test('scope, quote, cap, incomplete counts and invalid costs fail closed', async () => {
  const bad = [{ ...ready(), maxCostMicros: 8994000 }, { ...ready(), queryCount: 1499 }, { ...ready(), approved: false }, { ...ready(), runId: 'other-run' }, { ...ready(), scope: 'SCHEDULED' }, { ...ready(), quoteId: 'other-quote' }, view({ PLANNED: 1030 }), view({ PLANNED: 1031 }, 'RUNNING', { actualCostMicros: 6186001 }), view({ PLANNED: 1031 }, 'RUNNING', { actualCostMicros: NaN })];
  for (const saved of bad) await assert.rejects(continueApprovedKeywordReview({ ...base, read: async () => saved, post: async () => assert.fail('no POST') }));
});

test('stop while a request is in flight preserves its receipt and prevents a second submit', async () => {
  let stop = false, resolvePost, markStarted; const calls = [], seen = [];
  const started = new Promise(resolve => { markStarted = resolve; });
  const result = continueApprovedKeywordReview({ ...base, stopped: () => stop, read: async () => ready(),
    post: async command => { calls.push(command.action); markStarted(); return new Promise(resolve => { resolvePost = resolve; }); }, progress: x => seen.push(x) });
  await started; stop = true; resolvePost(view({ PLANNED: 31, SUBMITTED: 1000 }));
  assert.equal(await result, 'stopped'); assert.deepEqual(calls, ['resume']); assert.equal(seen.at(-1).run.taskCounts.SUBMITTED, 1000);
});

test('unmounted or stopped clients do not even read, prepare or submit', async () => {
  assert.equal(await continueApprovedKeywordReview({ ...base, stopped: () => true, read: async () => assert.fail('no read'), post: async () => assert.fail('no POST') }), 'stopped');
});

test('unknown submit receipt is retained and never continued even with planned words remaining', async () => {
  let posts = 0;
  const result = await continueApprovedKeywordReview({ ...base, read: async () => ready(), post: async () => { posts++; return view({ UNKNOWN: 100, PLANNED: 931 }); } });
  assert.equal(result, 'needs_review'); assert.equal(posts, 1);
});
