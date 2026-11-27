const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const originalLoad = Module._load;
const root = path.resolve(__dirname, '..');
const now = new Date('2026-11-25T04:00:00Z');
const checkedAt = new Date('2026-11-24T04:00:00Z');
const site = 'flatkey.ai', url = 'https://flatkey.ai/cloud/gpu', keyword = 'gpu pricing', keywordId = 'gpu-keyword';
const goalSites = [site, 'rackrate.org', 'modelfit.cc'];
const targetId = 'flatkey.ai:gpu%20pricing:US:en';
const workflowQueries = [], serpQueries = [];
let failSerp = false;
let historicalEvidence = false;
let catalog = false;

const prisma = {
  $queryRaw: async query => {
    if (query.sql.includes('FROM "Topic"')) {
      assert.match(query.sql, /FROM "SiteKeyword" m JOIN "Keyword" k/);
      assert.match(query.sql, /FROM "SiteKeywordTopic" a/);
      assert.deepEqual(query.values, goalSites);
      return [{
        topics: [{ id: 'gpu', text: 'GPU rental', active: true, parentId: null, childEdges: [], sites: [{ siteDomain: site }] }],
        members: [{ siteDomain: site, keywordId, active: true, topicId: 'gpu', pool: 'FORMAL', targetUrls: [url], topicAssignments: [], keyword: { text: keyword, active: true } }],
      }];
    }
    if (query.sql.includes('FROM "KeywordSourceRow"')) {
      assert.match(query.sql, /FROM "KeywordCurationAudit"/);
      assert.match(query.sql, /a\."restoredAt" IS NULL AND a\.summary->>'actor' = 'human'/);
      assert.deepEqual(query.values, [...goalSites, 'SEO_HUMAN_WORD_LANGUAGE_REVIEW', 'PRE_FREEZE_IDENTITIES_APPLIED_V1',
        ...goalSites, 'HOTSPOT_KEYWORD_CONFIRMED', 'HOTSPOT_CONFIRMED']);
      return [{ sources: [], audits: [], hotspots: [] }];
    }
    if (query.sql.includes('FROM "DataForSeoRun"')) {
      assert.ok(historicalEvidence || catalog, 'dashboard must not scan saved discovery');
      assert.deepEqual(query.values, catalog ? ['flatkey.ai', 'rackrate.org', 'modelfit.cc'] : [keyword, site]);
      if (catalog) assert.doesNotMatch(query.sql, /normalize\(/u);
      return [{ requestId: 'discovery-original', siteDomain: site, normalized: { datasetType: 'provider_ranked_keywords_snapshot', targetDomain: site, region: 'US', rows: [
        { rawKeyword: 'ＧＰＵ pricing', url, region: 'US', rank_group: 7, sourceSerpUpdatedAt: '2026-11-03T04:00:00Z' },
      ] } }];
    }
    if (query.sql.includes('FROM "SeoWorkflowRecord"')) {
      workflowQueries.push(query);
      return [
        { kind: 'task', payload: { id: 'original-task', dueAt: '2026-11-20', kind: 'landing', status: 'verified', siteDomain: site, keywordId, keyword, country: 'US', language: 'en', pageUrl: url } },
        { kind: 'publication', payload: { id: 'verified-publication', taskId: 'original-task', kind: 'landing', status: 'verified', publishedAt: '2026-11-20T00:00:00Z', siteDomain: site, keyword, country: 'US', language: 'en', pageUrl: url } },
      ];
    }
    assert.match(query.sql, /FROM "SerpMonitorTask"/);
    serpQueries.push(query);
    if (failSerp) throw Error('source unavailable');
    if (historicalEvidence) {
      assert.match(query.sql, /t\.id IN \(\?\)/);
      assert.deepEqual(query.values, ['matching-task']);
      return [];
    }
    return [{ id: 'saved-serp', runId: 'original-run', keyword, checkedAt, providerTaskId: 'provider-receipt',
      region: 'US', state: 'COMPLETE', scope: 'SCHEDULED', targetsJson: [{ siteDomain: site, keywordId, keyword }],
      requestJson: { device: 'desktop', depth: 100, location_code: 2840, language_code: 'en' },
      normalizedJson: { keyword, queryStatus: 'EXACT', rankingVerified: true, locationCode: 2840, languageCode: 'en', captureComplete: true,
        organicResults: [{ url, rankGroup: 4 }] } }];
  },
  serpMonitorTask: { findMany: async args => {
    assert.deepEqual(args.select, { id: true, keyword: true });
    return [{ id: 'matching-task', keyword: 'ＧＰＵ pricing' }, { id: 'unrelated-task', keyword: 'unrelated' }];
  } },
  keywordPageObservation: { findMany: async args => {
    assert.ok(historicalEvidence || catalog, 'dashboard must not read page ranking history');
    assert.deepEqual(args.where.keywordId, catalog ? undefined : { in: [keywordId] });
    assert.deepEqual(args.where.siteDomain, { in: catalog ? ['flatkey.ai', 'rackrate.org', 'modelfit.cc'] : [site] });
    if (catalog) return [{ keywordId: 'old-source', keyword: { text: 'saved keyword' }, siteDomain: site, region: 'US', source: 'gsc', rank: 12, url, dataUpdatedAt: new Date('2026-10-12T00:00:00Z') }];
    return [];
  } },
  keywordSourceRow: { findMany: async query => { assert.equal(query.where.rowKey, undefined, 'no paid live-page audit'); return []; } },
  seoPageInventory: { findMany: async () => [] },
  seoSite: { findMany: async () => [] },
  seoWorkflowRecord: {
    findMany: async args => { assert.equal(args.where.kind, 'plan'); return []; },
    findUnique: async () => ({ payload: { baseline: { targets: [{ id: targetId }], sourceVersion: 'saved-frozen-source-hash' } } }),
  },
  keywordCurationAudit: { findFirst: async () => null },
};
Module._load = function (name, parent, ...args) {
  if (name === 'server-only') return {};
  if (name === '@/lib/prisma') return { prisma };
  if (name === './seo-workflow' && parent.filename.endsWith('/services/growth-workspace.ts')) return { loadWorkflowSnapshot: () => assert.fail('dashboard must not read full workflow history') };
  return originalLoad.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { loadGrowthDashboardWorkspace, loadGrowthDashboardHistory, loadGrowthKeywordWorkspace, loadGrowthQuarterRankEvidence } = require('../src/lib/services/growth-workspace.ts');
const { withRequestReads } = require('../src/lib/request-read-scope.ts');

test('dashboard bounds saved SERP by the exact eligibility window and omits historic and paid-workspace reads', async () => {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unused.invalid/mock';
  try {
    const [workspace] = await withRequestReads(() => Promise.all([loadGrowthDashboardWorkspace(false, now), loadGrowthDashboardHistory()]));
    assert.equal(workflowQueries.length, 1);
    assert.match(workflowQueries[0].sql, /SELECT kind, CASE WHEN kind = 'task' THEN jsonb_build_object/);
    assert.match(serpQueries[0].sql, /t\."checkedAt" BETWEEN \? AND \?/);
    assert.match(serpQueries[0].sql, /jsonb_agg\(jsonb_build_object\('url', item->'url', 'rankGroup', item->'rankGroup'\)\)/);
    assert.match(serpQueries[0].sql, /'language_code', t\."requestJson"->'language_code'\) AS "requestJson"/);
    assert.deepEqual(serpQueries[0].values.map(value => value.toISOString()), ['2026-11-11T04:00:00.000Z', now.toISOString()]);
    const target = workspace.targets.find(row => row.id === targetId);
    assert.equal(target.rankEligible, true);
    assert.equal(target.rank, 4);
    assert.equal(target.rankUrl, url);
    assert.equal(target.workState, 'completed');
    assert.equal(target.topicId, 'gpu');
    assert.deepEqual(target.taskIds, ['original-task']);
    assert.deepEqual(workspace.quarter.targetIds, [targetId]);

    failSerp = true;
    const fallback = await loadGrowthDashboardWorkspace(false, now);
    assert.equal(fallback.reconciliation.sources.find(row => row.name === '最近14天的已存SERP').available, false);
    assert.equal(fallback.targets.find(row => row.id === targetId).rank, null);
    assert.deepEqual(fallback.quarter.targetIds, [targetId]);
  } finally {
    failSerp = false;
    if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
  }
});

test('quarter details recover the background rank without counting it as a fresh result', async () => {
  const target = { id: targetId, site, keyword, keywordId, country: 'US', language: 'en', languageStatus: 'match', rank: null, rankEligible: false, taskIds: ['original-task'], publishedUrls: [url] };
  historicalEvidence = true;
  try {
    const evidence = await loadGrowthQuarterRankEvidence([target], now.toISOString());
    assert.equal(evidence.partial, false);
    assert.equal(evidence.targets[0].rank, 7);
    assert.equal(evidence.targets[0].rankSource, 'database');
    assert.equal(evidence.targets[0].rankEligible, false);
    assert.equal(evidence.targets[0].taskIds, undefined);
    assert.equal(evidence.targets[0].publishedUrls, undefined);
    assert.equal(target.rank, null);
    failSerp = true;
    const partial = await loadGrowthQuarterRankEvidence([{ ...target, rank: 4, rankSource: 'serp', rankEligible: true }], now.toISOString());
    assert.equal(partial.partial, true);
    assert.equal(partial.targets[0].rank, 4);
    assert.equal(partial.targets[0].rankEligible, true);
  } finally { historicalEvidence = false; failSerp = false; }
});

test('all-keyword catalog keeps historical discovery, page observations, and original links without full workflow and page QA', async () => {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unused.invalid/mock';
  catalog = true;
  try {
    const data = await loadGrowthKeywordWorkspace(false, now);
    assert.doesNotMatch(serpQueries.at(-1).sql, /"checkedAt" BETWEEN/u);
    const current = data.targets.find(row => row.id === targetId);
    assert.equal(current.rank, 4);
    assert.deepEqual(current.maintenancePublishedUrls, [url]);
    assert.deepEqual(current.taskIds, ['original-task']);
    assert.equal(data.targets.find(row => row.keyword === 'saved keyword').rankSource, 'gsc');
    assert.equal(data.reconciliation.sources.find(row => row.name === '已存域名发现（供应商数据库）').available, true);
    assert.deepEqual(data.quarter.targetIds, [targetId]);
    assert.equal(data.pageLiveChecks, undefined);
  } finally {
    catalog = false;
    if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
  }
});
