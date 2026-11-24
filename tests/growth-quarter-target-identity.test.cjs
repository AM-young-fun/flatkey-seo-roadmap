const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), Module = require('node:module'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...args) { return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...args); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { growthTargetId } = require('../src/lib/growth-workspace.ts');
const { growthLogicalTargetIdSchema } = require('../src/lib/growth-target-id-schema.ts');
const { allocateIntegerBudget, BUSINESS_DELIVERY_WEIGHTS, MARKET_RESEARCH_WEIGHTS, quarterPlanningInputSchema } = require('../src/lib/growth-quarter-planning.ts');
const { emptyGrowthStrategy, growthStrategyCommandSchema, growthStrategyStoredSchema, growthWorkspaceIdentity, prepareGrowthStrategyMutation } = require('../src/lib/growth-strategy.ts');

// Six real approved originals that exceeded the former composite-key limit.
// The other rows are isolated unit-test fixtures, never production identities.
const approvedJapanese = [
  '東京 急成長 aiスタートアップ gpuクラウドプロバイダー',
  '高いgpu性能とコスト効率を備えたai推論クラウドを選ぶためのrfp基準とkpiを作って。',
  '推論クラウドって何？gpuのパフォーマンスはaiモデルの配信にどう影響するの？',
  '機械学習推論ワークロード gpuクラウドサービス',
  'aiトレーニングに最適なgpu搭載サーバーは何ですか?',
  '自分のアプリやサービスに、生成ai（api）を実装する方法を教えてください。',
];
const words = [...approvedJapanese, ...Array.from({ length: 1594 }, (_, i) => `test-only original keyword ${i}`)];
const targets = words.map((keyword, i) => ({ id: growthTargetId('flatkey.ai', keyword, i < 6 ? 'JP' : 'US', i < 6 ? 'ja' : 'en'), keywordId: `test-keyword-${i}`, site: 'flatkey.ai', topicId: i === 5 ? 'test-api-topic' : 'test-gpu-topic', keyword, country: i < 6 ? 'JP' : 'US', language: i < 6 ? 'ja' : 'en', languageStatus: 'match', membership: 'formal', publishedUrls: [], plannedUrls: [], pageState: 'unmapped' }));
const workspace = { targets, topics: [{ site: 'flatkey.ai', topicId: 'test-gpu-topic' }, { site: 'flatkey.ai', topicId: 'test-api-topic' }] };
const proposal = () => ({ version: 'quarter-planning-v2', targetUnit: 'normalized_original_word', sourceVersion: growthWorkspaceIdentity(workspace), title: '完整原词身份与真实业务方向季度方案', targetIds: targets.map(target => target.id), artifact: { reference: '/test-only/approved-wordlist.json', sha256: 'a'.repeat(64) }, executionStart: '2026-11-25', executionEnd: '2027-02-05', workstreams: ['gpu', 'api'].map(bucket => ({ id: `test-${bucket}`, title: `${bucket}原话题`, bucket, topicIds: [`test-${bucket}-topic`], taskIds: [], rationale: '按原词和真实本话题需求分配未来工作包，不修改原历史', verification: '制作门槛与逐页真实搜索意图研究保持独立，不冒称已完成', evidenceReferences: ['/test-only/original-topic-source.json'] })), researchBudget: { total: 244, counts: allocateIntegerBudget(244, MARKET_RESEARCH_WEIGHTS) }, deliveryBudget: { total: 564, counts: allocateIntegerBudget(564, BUSINESS_DELIVERY_WEIGHTS) }, reservedOriginalTaskIds: [], limitations: ['本测试仅验证逻辑身份的完整保存，不授予制作发布或付费权限'] });
const now = new Date('2026-11-24T15:00:00Z');

test('six actual long Japanese originals survive save, exact human approval, freeze and stored readback unchanged', () => {
  for (const target of targets.slice(0, 6)) assert.ok(target.id.length > 200, target.keyword);
  const sourceBefore = JSON.stringify(workspace), plan = proposal();
  let state = prepareGrowthStrategyMutation(emptyGrowthStrategy(), { requestId: 'test-long-identity-save', expectedVersion: 0, action: 'save_quarter_plan', plan }, 'collector', workspace, [], [], now);
  assert.equal(state.baseline, null);
  state = prepareGrowthStrategyMutation(state, { requestId: 'test-long-identity-approve', expectedVersion: state.version, action: 'approve_quarter_plan', hash: state.quarterPlanning.hash, sourceVersion: plan.sourceVersion, reason: '用户已明确审核完整1600个确切原词和列明例外后批准' }, 'human', workspace, [], [], now);
  const stored = growthStrategyStoredSchema.parse(JSON.parse(JSON.stringify(state)));
  assert.equal(stored.baseline.targets.length, 1600);
  assert.equal(new Set(stored.baseline.targets.map(target => target.id)).size, 1600);
  for (let i = 0; i < 6; i++) {
    assert.deepEqual(stored.baseline.targets[i], JSON.parse(JSON.stringify(state.baseline.targets[i])));
    assert.equal(stored.baseline.targets[i].id, targets[i].id);
    assert.equal(stored.baseline.targets[i].keyword, approvedJapanese[i]);
    assert.equal(stored.quarterPlanning.plan.targetIds[i], targets[i].id);
  }
  assert.equal(JSON.stringify(workspace), sourceBefore, 'no rewriting originals, markets or source IDs');
});

test('7000-character composite keys are bounded independently from database, topic and task IDs', () => {
  assert.equal(growthLogicalTargetIdSchema.safeParse('x'.repeat(7000)).success, true);
  assert.equal(growthLogicalTargetIdSchema.safeParse('x'.repeat(7001)).success, false);
  const plan = proposal();
  assert.equal(quarterPlanningInputSchema.safeParse({ ...plan, targetIds: ['x'.repeat(7001), ...plan.targetIds.slice(1)] }).success, false);
  assert.equal(quarterPlanningInputSchema.safeParse({ ...plan, reservedOriginalTaskIds: ['x'.repeat(201)] }).success, false);
  assert.equal(quarterPlanningInputSchema.safeParse({ ...plan, workstreams: [{ ...plan.workstreams[0], topicIds: ['x'.repeat(201)] }, plan.workstreams[1]] }).success, false);
  const stored = { ...emptyGrowthStrategy(), baseline: { frozenAt: now.toISOString(), actor: 'human', sourceVersion: plan.sourceVersion, targets: [{ ...targets[0], membership: undefined, keywordId: 'x'.repeat(201) }], reason: '数据库ID不随组合身份扩容' } };
  delete stored.baseline.targets[0].membership;
  assert.equal(growthStrategyStoredSchema.safeParse(stored).success, false);
  assert.equal(growthStrategyCommandSchema.safeParse({ requestId: 'test-long-direction', expectedVersion: 0, action: 'decide_direction', directionId: 'x'.repeat(201), revision: 1, decision: 'hold', reason: '方向数据库ID仍保留原来的长度限制' }).success, false);
});
