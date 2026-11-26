const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), Module = require('node:module'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...args) { return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...args); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { quarterTaskBusinessBucket, quarterAllocationProblems } = require('../src/lib/growth-quarter-planning.ts');
const target = { id: 'target-original', keywordId: 'keyword-original', site: 'modelfit.cc', topicId: 'gpu-topic', keyword: 'gpu memory requirements', country: 'US', language: 'en', publishedUrls: [], plannedUrls: [] };
const task = { id: 'original-task', keywordId: target.keywordId, siteDomain: target.site, topicId: target.topicId, keyword: target.keyword, country: 'US', language: 'en', business: 'CLUSTER', kind: 'landing', dueAt: '2026-11-27T06:00:00Z', status: 'planned', version: 3 };
const plan = { version: 'quarter-planning-v2', targetIds: [target.id], executionStart: '2026-11-25', executionEnd: '2027-02-05', workstreams: [{ id: 'gpu-main', bucket: 'gpu', topicIds: ['gpu-topic'] }, { id: 'api-main', bucket: 'api', topicIds: ['api-topic'] }], deliveryBudget: { total: 564 }, researchBudget: { total: 244 } };
const attribution = (row = task, proposal = plan, targets = [target]) => quarterTaskBusinessBucket(row, proposal, targets);

test('legacy CLUSTER landing and blog delivery use their exact approved GPU or API identity without rewriting business', () => {
  const before = structuredClone(task);
  assert.equal(attribution(), 'gpu');
  assert.equal(attribution({ ...task, kind: 'blog' }), 'gpu');
  const apiTarget = { ...target, topicId: 'api-topic', keyword: 'inference api pricing' };
  assert.equal(attribution({ ...task, topicId: apiTarget.topicId, keyword: apiTarget.keyword }, plan, [apiTarget]), 'api');
  assert.deepEqual(task, before, 'classification cannot mutate old task identity, business, due date or state');
});

test('same-word wrong market, topic or ID and cross-site identities do not acquire budget by relabelling', () => {
  for (const patch of [{ country: 'JP', language: 'ja' }, { topicId: 'api-topic' }, { keywordId: 'different-id' }, { keyword: 'unrelated keyword' }, { siteDomain: 'rackrate.org' }, { country: null }, { language: null }, { topicId: null }]) assert.equal(attribution({ ...task, ...patch }), null, JSON.stringify(patch));
  assert.equal(attribution({ ...task, siteDomain: 'rackrate.org', kind: 'blog' }, plan, [{ ...target, site: 'rackrate.org' }]), null);
  assert.equal(attribution({ ...task, siteDomain: 'rougecue.org' }, plan, [{ ...target, site: 'rougecue.org' }]), null);
});

test('a shared topic is ambiguous for CLUSTER and the other reserve cannot manufacture an unapproved workstream', () => {
  const shared = { ...plan, workstreams: [...plan.workstreams, { id: 'api-shared', bucket: 'api', topicIds: ['gpu-topic'] }] };
  assert.equal(attribution(task, shared), null);
  assert.equal(attribution({ ...task, topicId: 'invented-other' }), null);
  const onlyOther = { ...plan, workstreams: [{ id: 'approved-other', bucket: 'other', topicIds: ['gpu-topic'] }] };
  assert.equal(attribution(task, onlyOther), 'other', 'other requires a genuine explicit approved topic, never a default');
});

test('non-quarter maintenance stays outside N and needs a real approved topic and same-site public page', () => {
  const maintenance = { ...task, kind: 'optimization', keywordId: 'old-page-keyword', keyword: 'older gpu compatibility guide', pageUrl: 'https://modelfit.cc/tools/compatibility' };
  assert.equal(attribution(maintenance), 'gpu');
  assert.equal(attribution({ ...maintenance, pageUrl: 'https://www.modelfit.cc/tools/compatibility' }), 'gpu');
  for (const pageUrl of [null, 'https://console.modelfit.cc/tools', 'https://flatkey.ai/tools', 'http://modelfit.cc/tools', 'https://modelfit.cc/api/models', 'https://modelfit.cc/router/models']) assert.equal(attribution({ ...maintenance, pageUrl }), null, String(pageUrl));
  assert.equal(attribution({ ...maintenance, kind: 'landing' }), null, 'new production outside the quarterly word identity is not admitted here');
  assert.equal(attribution({ ...maintenance, topicId: 'unapproved-topic' }), null);
  assert.equal(attribution({ ...maintenance, keyword: target.keyword, keywordId: 'wrong-id' }), null, 'a known quarterly word cannot bypass identity checks through maintenance');
  assert.equal(attribution({ ...maintenance, siteDomain: 'rackrate.org', pageUrl: 'https://rackrate.org/blog/not-authorized' }), null);
});

test('allocation validation accepts real GPU CLUSTER work and rejects parking it in other while retaining the old record', () => {
  const hash = 'a'.repeat(64), before = JSON.stringify(task);
  const strategy = { quarterPlanningHistory: [], quarterPlanning: { revision: 1, hash, approval: { hash }, plan }, baseline: { targets: [target] } };
  const workflowPlan = { id: 'future-week', targets: { executionRange: { start: '2026-11-27', end: '2026-12-03' } }, strategyAllocation: { version: 'quarter-planning-v2', quarterPlanHash: hash, tasks: [{ taskId: task.id, bucket: 'gpu', workstreamId: 'gpu-main' }], futureBudget: { total: 1 }, marketResearchBudget: { total: 0 } } };
  assert.deepEqual(quarterAllocationProblems(workflowPlan, strategy, [task]), []);
  const bad = structuredClone(workflowPlan); bad.strategyAllocation.tasks[0].bucket = 'other';
  assert.match(quarterAllocationProblems(bad, strategy, [task]).join(' '), /CLUSTER/);
  const past = { ...task, dueAt: '2026-11-19T06:00:00Z' };
  assert.match(quarterAllocationProblems(workflowPlan, strategy, [past]).join(' '), /dueAt/);
  assert.equal(JSON.stringify(task), before);
});

test('routine Flatkey blog maintenance keeps the exact previously approved API topic under the current plan', () => {
  const currentHash = 'b'.repeat(64), historicalHash = 'c'.repeat(64);
  const topicId = 'gemini-pricing-topic';
  const current = { ...plan, version: 'quarter-planning-v3', executionStart: '2026-11-27' };
  const active = { revision: 2, hash: currentHash, approval: { hash: currentHash }, plan: current };
  const previous = { revision: 1, hash: historicalHash, approval: { hash: historicalHash }, plan: {
    ...plan, workstreams: current.workstreams.map(stream => stream.id === 'api-main'
      ? { ...stream, topicIds: [...stream.topicIds, topicId] } : stream),
  } };
  const strategy = { quarterPlanning: active, quarterPlanningHistory: [previous] };
  const maintenance = {
    ...task, id: 'gemini-optimization', topicId, keywordId: 'gemini-price-ja',
    keyword: 'gemini api 価格', siteDomain: 'flatkey.ai', country: 'JP', language: 'ja',
    business: 'API', kind: 'optimization', pageType: 'blog', workflowContract: 'growth-v1.5', channel: 'website',
    capacityClass: 'routine', pageUrl: 'https://flatkey.ai/ja/blog/gemini-api-pricing',
  };
  const workflowPlan = { id: 'future-week', targets: { executionRange: { start: '2026-11-27', end: '2026-12-03' } },
    strategyAllocation: { version: 'quarter-planning-v3', quarterPlanHash: currentHash,
      tasks: [{ taskId: maintenance.id, bucket: 'api', workstreamId: 'api-main' }],
      futureBudget: { total: 1 }, marketResearchBudget: { total: 0 } } };
  const verify = (item = maintenance, state = strategy, week = workflowPlan) => quarterAllocationProblems(week, state, [item]);
  assert.deepEqual(verify(), []);
  for (const change of [
    { topicId: 'never-approved' },
    { kind: 'blog' },
    { pageUrl: 'https://console.flatkey.ai/ja/blog/gemini-api-pricing' },
    { pageUrl: 'https://flatkey.ai/ja/pricing' },
    { workClass: 'content_refresh' },
    { capacityClass: 'authorized_hotspot_extra' },
  ]) assert.match(verify({ ...maintenance, ...change }).join(' '), /真实话题方向/, JSON.stringify(change));
  assert.match(verify(maintenance, { ...strategy, quarterPlanningHistory: [{ ...previous, approval: null }] }).join(' '), /真实话题方向/);
  const reclassified = { ...active, plan: { ...current, workstreams: current.workstreams.map(stream => stream.id === 'gpu-main'
    ? { ...stream, topicIds: [...stream.topicIds, topicId] } : stream) } };
  assert.match(verify(maintenance, { ...strategy, quarterPlanning: reclassified }).join(' '), /真实话题方向/);
});
