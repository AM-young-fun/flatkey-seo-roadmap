const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { collectionFitsExistingBudget, continueCollectionCycle, pauseCollectionRequests } = require('../src/lib/collection-cycle-client.ts');
const quote = { action: 'previewSchedule', periodKey: '2026-11-17', previewToken: 'same-signed-current-period', serpMaxCostMicros: 6000, maxMonthSerpCostMicros: 33594000, discoveryMaxCostMicros: 528000 };
const budget = { maxRunCostMicros: 33576000, maxMonthCostMicros: 134304000, discoveryMaxCostMicros: 528000 };

test('each cost remains below its own existing cap and unknown or expanded caps fail closed', () => {
  assert.equal(collectionFitsExistingBudget(quote, budget), true);
  for (const key of ['serpMaxCostMicros', 'maxMonthSerpCostMicros', 'discoveryMaxCostMicros']) {
    assert.equal(collectionFitsExistingBudget({ ...quote, [key]: Number.MAX_SAFE_INTEGER }, budget), false);
    assert.equal(collectionFitsExistingBudget({ ...quote, [key]: NaN }, budget), false);
  }
  assert.equal(collectionFitsExistingBudget(quote, { ...budget, maxRunCostMicros: 0 }), false);
});

test('enable happens once and serial continuations retain the exact signed period until finished', async () => {
  const calls = [], progress = []; let active = 0, waits = 0, passes = 0;
  await continueCollectionCycle({ quote, budget, stopped: () => false,
    async post(command) {
      assert.equal(active++, 0); calls.push(command); await Promise.resolve(); active--;
      return command.action === 'enableSchedule' ? { action: 'enableSchedule', enabled: true } : { action: 'runCycle', finished: ++passes === 3, phase: 'SERP', runId: 'same-run' };
    }, progress: value => progress.push(value), wait: async () => { waits++; } });
  assert.deepEqual(calls.map(x => x.action), ['enableSchedule', 'runCycle', 'runCycle', 'runCycle']);
  assert.ok(calls.every(x => x.previewToken === quote.previewToken)); assert.equal(waits, 2); assert.equal(progress.length, 3);
});

test('an ambiguous paid response is surfaced and never retried', async () => {
  const calls = [];
  await assert.rejects(continueCollectionCycle({ quote, budget, stopped: () => false,
    async post(command) { calls.push(command.action); if (command.action === 'runCycle') throw new Error('UNKNOWN'); return { action: 'enableSchedule', enabled: true }; },
    progress() {}, wait: async () => assert.fail('must not wait/retry') }), /UNKNOWN/);
  assert.deepEqual(calls, ['enableSchedule', 'runCycle']);
});

test('navigation stops future passes without resubmitting an in-flight paid operation', async () => {
  let stopped = false; const calls = [];
  await continueCollectionCycle({ quote, budget, stopped: () => stopped,
    async post(command) { calls.push(command.action); return command.action === 'enableSchedule' ? { action: 'enableSchedule', enabled: true } : { action: 'runCycle', finished: false }; },
    progress() { stopped = true; }, wait: async () => {} });
  assert.deepEqual(calls, ['enableSchedule', 'runCycle']);
});

test('over-budget or already unmounted requests cannot enable or spend', async () => {
  const never = async () => assert.fail('no write');
  await assert.rejects(continueCollectionCycle({ quote, budget: { ...budget, maxRunCostMicros: 1 }, post: never, stopped: () => false, progress() {}, wait: never }), /原计划上限/);
  await continueCollectionCycle({ quote, budget, post: never, stopped: () => true, progress() {}, wait: never });
});

test('an incomplete receipt stops continuation instead of assuming success', async () => {
  let calls = 0;
  await assert.rejects(continueCollectionCycle({ quote, budget, post: async command => { calls++; return command.action === 'enableSchedule' ? { action: 'enableSchedule', enabled: true } : {}; }, stopped: () => false, progress() {}, wait: async () => assert.fail('no retry') }), /回执不完整/);
  assert.equal(calls, 2);
});

test('an unconfirmed enable receipt never reaches a paid continuation', async () => {
  let calls = 0;
  await assert.rejects(continueCollectionCycle({ quote, budget, post: async () => { calls++; return { enabled: false }; }, stopped: () => false, progress() {}, wait: async () => assert.fail('no retry') }), /开启回执未确认/);
  assert.equal(calls, 1);
});

test('pause is independent of an in-flight paid request, reads back off, and never repeats that request', async () => {
  let stop = false, finishPaid, started;
  const paidStarted = new Promise(resolve => { started = resolve; });
  const paidResult = new Promise(resolve => { finishPaid = resolve; });
  const commands = [];
  const loop = continueCollectionCycle({ quote, budget, stopped: () => stop,
    async post(command) { commands.push(command.action); if (command.action === 'enableSchedule') return { action: 'enableSchedule', enabled: true }; started(); return paidResult; },
    progress() {}, wait: async () => {} });
  await paidStarted; stop = true;
  const notice = await pauseCollectionRequests({ post: async command => { commands.push(command.action); return { action: 'pauseSchedule', enabled: false }; },
    read: async () => ({ executionEvidence: 'available', controls: { enabled: false } }) });
  assert.match(notice, /已暂停新的付费提交/);
  assert.deepEqual(commands, ['enableSchedule', 'runCycle', 'pauseSchedule']);
  finishPaid({ action: 'runCycle', finished: false }); await loop;
  assert.deepEqual(commands, ['enableSchedule', 'runCycle', 'pauseSchedule']);
});

test('pause read failure or uncertain acknowledgement never retries its POST or claims verified off', async () => {
  for (const kind of ['post', 'receipt', 'read', 'fallback']) {
    let posts = 0;
    await assert.rejects(pauseCollectionRequests({ post: async command => { posts++; assert.deepEqual(command, { action: 'pauseSchedule' }); if (kind === 'post') throw new Error('UNKNOWN'); return kind === 'receipt' ? {} : { action: 'pauseSchedule', enabled: false }; },
      read: async () => { if (kind === 'read') throw new Error('READ_UNAVAILABLE'); return { executionEvidence: 'unavailable', controls: { enabled: false } }; } }));
    assert.equal(posts, 1);
  }
});
