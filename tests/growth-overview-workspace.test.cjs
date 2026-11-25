const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(__dirname, '../src', name.slice(2)) : name, parent, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);

const { growthDashboardProjection, growthOverviewWorkspace } = require('../src/lib/growth-overview-workspace.ts');
const { defaultGrowthScope, growthLink, growthRankingEvidence, quarterTargetWorkspace, selectGrowthTargets } = require('../src/components/growth-topic-view.ts');
const { keywordCircleLayout } = require('../src/components/growth-network-layout.ts');

const target = (id, patch = {}) => ({
  id, site: 'flatkey.ai', keyword: 'GPU rental', topicId: 'compute', topicName: 'GPU compute',
  country: 'US', language: 'en', wordLanguage: 'en', membership: 'formal', relatedTopicIds: ['parent'],
  rank: 22, rankSource: 'serp', rankUrl: 'https://flatkey.ai/gpu', checkedAt: '2026-11-23T00:00:00Z',
  languageStatus: 'match', captureState: 'ranked', rankEligible: true,
  plannedUrls: [], publishedUrls: ['https://flatkey.ai/gpu'], taskIds: ['original-task'], ...patch,
});

test('overview preserves ranking, frozen graph and links while omitting unrepresented inventory', () => {
  const targets = [
    target('frozen-ranked', { taskRelations: [{ taskId: 'original-task' }], relatedObservations: [{ country: 'JP', rank: 80 }], workState: 'completed' }),
    target('frozen-unknown', { keyword: 'GPU server', rank: null, rankSource: null, rankEligible: false, captureState: 'unqueried' }),
    target('same-word', { membership: 'opportunity', rank: 12 }),
    target('ja-observed', { membership: 'review', keyword: 'GPUレンタル', country: 'JP', language: 'ja', wordLanguage: 'ja', rank: 56 }),
    target('database', { membership: 'opportunity', rank: 2, rankSource: 'database', rankEligible: false }),
    target('gsc', { membership: 'review', rank: 3.7, rankSource: 'gsc', rankEligible: false }),
    target('expired', { membership: 'opportunity', rank: 4, checkedAt: '2026-10-01T00:00:00Z', rankEligible: false }),
    target('duplicate', { rank: 5 }),
    target('duplicate', { rank: null, rankSource: null, rankEligible: false }),
    target('not-displayed', { membership: 'opportunity', rank: null, rankSource: null, rankEligible: false }),
  ];
  const workspace = {
    version: 'growth-v1.5', generatedAt: '2026-11-25T00:00:00Z', targets,
    opportunities: targets.filter(row => row.membership !== 'formal'),
    sites: [], markets: [], monitoringQuote: { queries: [] },
    reconciliation: { sources: [{ available: false }] },
    topics: [
      { id: 'flatkey.ai:compute', site: 'flatkey.ai', topicId: 'compute', parentIds: ['parent'], name: 'GPU compute' },
      { id: 'flatkey.ai:parent', site: 'flatkey.ai', topicId: 'parent', parentIds: [], name: 'Hardware' },
    ],
    quarter: { targetIds: ['frozen-ranked', 'frozen-unknown'], keywordCount: 2, hash: 'approved' },
    pageLiveChecks: [{}], hotspotTargetIds: ['not-displayed'],
  };
  const overview = growthOverviewWorkspace(workspace);
  assert.deepEqual(overview.targets, targets.slice(0, -1));
  assert.deepEqual(overview.opportunities, []);
  assert.equal(overview.pageLiveChecks, undefined);
  assert.equal(overview.hotspotTargetIds, undefined);
  assert.equal(overview.reconciliation, workspace.reconciliation);

  for (const scope of [defaultGrowthScope, { ...defaultGrowthScope, site: 'flatkey.ai', country: 'JP', language: 'ja' }]) {
    const all = data => growthRankingEvidence(data, scope, 'all');
    assert.deepEqual(all(overview).summary, all(workspace).summary);
    assert.deepEqual(all(overview).background, all(workspace).background);
    const formal = data => growthRankingEvidence(quarterTargetWorkspace(data), scope, 'formal');
    assert.deepEqual(formal(overview), formal(workspace));
  }
  const graph = data => {
    const quarter = quarterTargetWorkspace(data);
    return keywordCircleLayout(quarter.targets, quarter.topics).points.map(point => (
      growthLink(defaultGrowthScope, point.topic, point.target.id)
    ));
  };
  assert.deepEqual(graph(overview), graph(workspace));
  assert.equal(graph(overview).length, 2);
  const search = { ...defaultGrowthScope, search: 'Hardware' };
  assert.deepEqual(selectGrowthTargets(quarterTargetWorkspace(overview), search), selectGrowthTargets(quarterTargetWorkspace(workspace), search));
  const dashboard = growthDashboardProjection(workspace);
  assert.deepEqual(graph(dashboard), graph(overview));
  assert.equal(dashboard.targets[0].keywordId, overview.targets[0].keywordId);
  assert.equal(dashboard.targets[0].workState, 'completed');
  assert.deepEqual(dashboard.targets[0].taskIds, ['original-task']);
  assert.equal(dashboard.targets[0].taskRelations, undefined);
  assert.equal(dashboard.targets[0].relatedObservations, undefined);
  const rankedCounts = data => {
    const summary = growthRankingEvidence(data, defaultGrowthScope, 'all').summary;
    return { total: summary.total, top50: summary.top50, countries: summary.countries, bands: summary.bands };
  };
  assert.deepEqual(rankedCounts(dashboard), rankedCounts(overview));
});
