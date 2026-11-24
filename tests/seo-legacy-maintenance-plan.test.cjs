const assert = require('node:assert/strict'), { test } = require('node:test'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...args) { return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...args); };
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { legacyMaintenancePlanProblems } = require('../src/lib/seo-legacy-maintenance-plan.ts');
const { workflowPlanSchema } = require('../src/lib/seo-workflow.ts');
const { prepareWorkflowMutation } = require('../src/lib/seo-workflow-state.ts');
const { allocateIntegerBudget, BUSINESS_DELIVERY_WEIGHTS, MARKET_RESEARCH_WEIGHTS, quarterAllocationProblems } = require('../src/lib/growth-quarter-planning.ts');
const now = new Date('2026-11-24T14:30:00Z'), at = '2026-11-24T14:00:00Z';
const evidence = [{ label: '原页面和正式排期事实', artifact: '/test-only/original-evidence.json', observedAt: at }];
const ordinary = (patch = {}) => ({ id: 'ordinary-original', siteDomain: 'flatkey.ai', weekStart: '2026-11-23', kind: 'optimization', keyword: 'old gpu guide', business: 'GPU', country: 'US', language: 'en', topicId: 'gpu-topic', keywordId: 'old-keyword', title: '保留原优化', pageType: 'blog', pageUrl: 'https://flatkey.ai/blog/original-guide', dueAt: '2026-11-25T06:00:00Z', status: 'ready', dependencies: [], evidence, acceptanceCriteria: ['原URL和事实与真实版本一致'], source: 'automation', brief: require('./fixtures/chinese-task-brief.cjs')(evidence), ...patch });
const originalTasks = [ordinary(), ordinary({ id: 'original-friday-api', kind: 'blog', business: 'API', keyword: 'friday api example', pageUrl: null, dueAt: '2026-11-27T06:00:00Z' }), ordinary({ id: 'original-friday-gpu', kind: 'blog', keyword: 'friday gpu example', pageUrl: null, dueAt: '2026-11-27T07:00:00Z' })];
const original = () => ({ id: 'next-week-plan-20261123', weekStart: '2026-11-23', status: 'scheduled', version: 14, title: '原计划不迁移', owner: 'AI', preparedAt: at, reviewedAt: null, reviewedBy: null, taskIds: originalTasks.map(t => t.id), committedTaskIds: originalTasks.map(t => t.id), targets: { cadence: 'workdays', landing: 0, clusterLanding: 7, apiBlogs: 7, gpuBlogs: 18, optimizedPages: 10, blogLanguages: { en: 10, ja: 5, 'es-ES': 5, 'pt-BR': 5 } }, gaps: [['apiBlogs', 7], ['gpuBlogs', 18], ['optimizedPages', 9], ['clusterLanding', 7], ['blogEn', 10], ['blogJa', 5], ['blogEs', 5], ['blogPt', 5]].map(([category, count]) => ({ category, count, reason: '保留原未齐项，不增加常规额度' })), evidence, notes: '保留原任务和原排期' });
const supplement = (p = original()) => ({ ...structuredClone(p), targets: { ...p.targets, maintenanceVersion: 'seo-maintenance-v1', contentRefreshPages: 4, maintenanceRange: { start: '2026-11-25', end: '2026-11-26' } }, gaps: [...p.gaps, ...['2026-11-25', '2026-11-26'].map(date => ({ category: 'contentRefreshPages', date, count: 2, reason: '真实旧文研究尚待完成，不冒称已排生产' }))] });
const refresh = (i, patch = {}) => ordinary({ id: `refresh-test-${i}`, keywordId: `refresh-word-${i}`, keyword: `gpu original guide ${i}`, problemKey: `original-blog:refresh:${i}`, pageUrl: `https://flatkey.ai/blog/old-guide-${i}`, workClass: 'content_refresh', workflowContract: 'growth-v1.5', maintenance: { version: 'seo-maintenance-v1', refresh: { reason: 'intent_gap', baselineId: `baseline-${i}`, originalPublishedAt: '2026-06-01T00:00:00Z', baseContentVersion: 'original-v1', changes: ['按真实原市场查询补充缺少的部署前置条件与验证步骤'], evidence: [{ observedAt: at, source: '/test-only/original-page.html', finding: '原公开正文缺少当前用户任务的边界与可复核验收步骤' }] } }, dueAt: i < 2 ? '2026-11-25T07:00:00Z' : '2026-11-26T07:00:00Z', ...patch });
const rows = (tasks = originalTasks, plan = original()) => [...tasks.map(record => ({ kind: 'task', record })), { kind: 'plan', record: plan }];
const problems = (p, prior = original(), all = rows(), time = now) => legacyMaintenancePlanProblems(p, prior, all, time);
const allocation = () => ({ version: 'quarter-planning-v2', quarterPlanHash: 'a'.repeat(64), capacityStart: '2026-11-25', capacityEnd: '2026-11-26', futureBudget: { total: 4, counts: allocateIntegerBudget(4, BUSINESS_DELIVERY_WEIGHTS) }, marketResearchBudget: { total: 0, counts: allocateIntegerBudget(0, MARKET_RESEARCH_WEIGHTS) }, preservedTaskIds: ['ordinary-original'], tasks: [], gaps: [{ bucket: 'gpu', count: 3, reason: '本周真实旧文研究尚未齐全，不伪造制作' }, { bucket: 'api', count: 1, reason: '本周真实旧文研究尚未齐全，不伪造制作' }] });
const inputPlan = p => Object.fromEntries(Object.entries(p).filter(([key]) => !['version', 'updatedAt', 'recordedAt'].includes(key)));

test('legacy scheduled v14 adds only a four-page maintenance window and preserves Friday originals and all existing targets', () => {
  const before = original(), updated = supplement(before), originalJson = JSON.stringify(before);
  assert.equal(workflowPlanSchema.safeParse(inputPlan(updated)).success, true);
  assert.deepEqual(problems(updated), []);
  const { version, ...record } = updated;
  const saved = prepareWorkflowMutation({ requestId: 'test-legacy-maintenance-append', action: 'save_plan', expectedVersion: version, record }, rows(), 'collector', now).record;
  for (const [key, value] of Object.entries(before.targets)) assert.deepEqual(saved.targets[key], value);
  assert.equal(saved.targets.cadence, 'workdays');
  assert.deepEqual(saved.taskIds, before.taskIds);
  assert.deepEqual(saved.committedTaskIds, before.committedTaskIds);
  assert.equal(JSON.stringify(before), originalJson);
  assert.equal(originalTasks[1].dueAt, '2026-11-27T06:00:00Z');
});

test('partial contracts, backdating, inflated maintenance and changing old targets are rejected', () => {
  for (const field of ['maintenanceVersion', 'contentRefreshPages', 'maintenanceRange']) { const p = supplement(); delete p.targets[field]; assert.match(problems(p)[0].code, /incomplete/); }
  const bigger = supplement(); bigger.targets.contentRefreshPages = 10; assert.equal(problems(bigger)[0].code, 'legacy_refresh_capacity');
  const changed = supplement(); changed.targets.optimizedPages = 14; assert.equal(problems(changed)[0].code, 'legacy_refresh_original_targets');
  const past = supplement(); past.targets.maintenanceRange.start = '2026-11-23'; assert.equal(problems(past)[0].code, 'legacy_refresh_window');
  const changedWindow = supplement(); changedWindow.targets.maintenanceRange.end = '2026-11-27'; assert.equal(problems(changedWindow)[0].code, 'legacy_refresh_window');
  const already = supplement(); const dropped = original(); assert.equal(problems(dropped, already)[0].code, 'legacy_refresh_contract_immutable');
  const moved = supplement(); moved.targets.cadence = 'growth'; assert.equal(problems(moved, already)[0].code, 'legacy_refresh_contract_immutable');
  const resized = supplement(); resized.targets.contentRefreshPages = 2; assert.equal(problems(resized, already)[0].code, 'legacy_refresh_contract_immutable');
});

test('new refresh remains behind its independent contract and the unaltered production research gate', () => {
  const task = refresh(0), noContract = original(); noContract.taskIds.push(task.id);
  assert.equal(problems(noContract, original(), rows([...originalTasks, task]))[0].code, 'legacy_refresh_contract_required');
  const p = supplement(); p.taskIds.push(task.id); p.gaps = p.gaps.map(g => g.category === 'contentRefreshPages' && g.date === '2026-11-25' ? { ...g, count: 1 } : g);
  assert.equal(problems(p, original(), rows([...originalTasks, task]))[0].code, 'legacy_refresh_allocation_required');
  const unready = refresh(0, { status: 'planned' }); p.strategyAllocation = allocation(); p.strategyAllocation.tasks = [{ taskId: task.id, bucket: 'gpu', workstreamId: 'gpu' }]; p.strategyAllocation.gaps[0].count = 2;
  assert.throws(() => prepareWorkflowMutation({ requestId: 'test-research-still-required', action: 'save_plan', expectedVersion: 14, record: inputPlan(p) }, rows([...originalTasks, unready]), 'collector', now), { code: 'plan_task_not_ready' });
});

test('two refreshes and an ordinary optimization can share a day with separate counters', () => {
  const tasks = Array.from({ length: 4 }, (_, i) => refresh(i, i === 3 ? { business: 'API', topicId: 'api-topic' } : {}));
  const p = supplement(); p.taskIds.push(...tasks.map(t => t.id)); p.gaps = p.gaps.filter(g => g.category !== 'contentRefreshPages'); p.strategyAllocation = allocation(); p.strategyAllocation.gaps = []; p.strategyAllocation.tasks = tasks.map((t, i) => ({ taskId: t.id, bucket: i === 3 ? 'api' : 'gpu', workstreamId: i === 3 ? 'api' : 'gpu' }));
  assert.deepEqual(problems(p, original(), rows([...originalTasks, ...tasks])), []);
  assert.doesNotThrow(() => prepareWorkflowMutation({ requestId: 'test-separate-maintenance-quota', action: 'save_plan', expectedVersion: 14, record: inputPlan(p) }, rows([...originalTasks, ...tasks]), 'collector', now));
  const tooMany = refresh(4, { dueAt: '2026-11-25T08:00:00Z' }); const over = structuredClone(p); over.taskIds.push(tooMany.id);
  assert.equal(problems(over, original(), rows([...originalTasks, ...tasks, tooMany]))[0].code, 'legacy_refresh_daily_capacity');
  const duplicate = refresh(0, { pageUrl: ordinary().pageUrl }); const samePage = supplement(); samePage.taskIds.push(duplicate.id);
  assert.equal(problems(samePage, original(), rows([...originalTasks, duplicate]))[0].code, 'legacy_refresh_duplicate_page');
});

test('28 regular carry reservations do not consume four independent refresh slots or change original records', () => {
  const originals = Array.from({ length: 28 }, (_, i) => ordinary({ id: `old-reserved-${i}`, pageUrl: `https://flatkey.ai/blog/original-${i}` }));
  const old = original(); old.taskIds = originals.map(t => t.id); old.committedTaskIds = [...old.taskIds];
  const p = supplement(old); p.strategyAllocation = allocation(); p.strategyAllocation.preservedTaskIds = [...old.taskIds];
  const before = JSON.stringify(originals);
  assert.deepEqual(problems(p, old, rows(originals, old)), []);
  const swallowed = structuredClone(p); swallowed.strategyAllocation.futureBudget.total = 0;
  assert.equal(problems(swallowed, old, rows(originals, old))[0].code, 'legacy_refresh_future_capacity');
  assert.equal(JSON.stringify(originals), before);
});

test('cross-plan duplicate maintenance windows and ordinary optimization of the same original page are refused', () => {
  const other = supplement(); other.id = 'do-not-create-another-plan';
  assert.equal(problems(supplement(), original(), [...rows(), { kind: 'plan', record: other }])[0].code, 'legacy_refresh_duplicate_contract');
  const extra = refresh(0); const otherPlan = { ...original(), id: 'other-monday-bucket', taskIds: [extra.id] };
  const p = supplement(); p.taskIds.push(extra.id); p.gaps = p.gaps.map(g => g.category === 'contentRefreshPages' && g.date === '2026-11-25' ? { ...g, count: 1 } : g);
  const ordinaryDuplicate = ordinary({ id: 'old-other-optimization', pageUrl: extra.pageUrl }); otherPlan.taskIds.push(ordinaryDuplicate.id);
  assert.equal(problems(p, original(), [...rows([...originalTasks, extra, ordinaryDuplicate]), { kind: 'plan', record: otherPlan }])[0].code, 'legacy_refresh_duplicate_page');
});

test('a following growth window carries the saved legacy maintenance allocation into its cumulative ledger', () => {
  const hash = 'a'.repeat(64), quarter = { revision: 1, hash, approval: { hash }, plan: { version: 'quarter-planning-v2', executionStart: '2026-11-25', executionEnd: '2027-02-05', deliveryBudget: { total: 564 }, researchBudget: { total: 244 } } };
  const saved = supplement(); saved.strategyAllocation = allocation();
  const next = { id: 'next-original-week', targets: { executionRange: { start: '2026-11-27', end: '2026-12-03' } }, strategyAllocation: { version: 'quarter-planning-v2', quarterPlanHash: hash, futureBudget: { total: 10, offset: 4 }, marketResearchBudget: { total: 0 }, tasks: [] } };
  assert.deepEqual(quarterAllocationProblems(next, { quarterPlanning: quarter }, [], [saved]), []);
  const reset = structuredClone(next); reset.strategyAllocation.futureBudget.offset = 0;
  assert.match(quarterAllocationProblems(reset, { quarterPlanning: quarter }, [], [saved]).join(' '), /累计/);
  const duplicate = structuredClone(next); duplicate.targets.executionRange = { start: '2026-11-20', end: '2026-11-26' }; duplicate.strategyAllocation.capacityStart = '2026-11-25'; duplicate.strategyAllocation.capacityEnd = '2026-11-26';
  assert.match(quarterAllocationProblems(duplicate, { quarterPlanning: quarter }, [], [saved]).join(' '), /重复分配预算/);
});
