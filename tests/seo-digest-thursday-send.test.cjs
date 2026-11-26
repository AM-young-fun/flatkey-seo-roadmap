const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const sender = path.join(__dirname, '../scripts/server-seo-digest-send.cjs');
const senderRequire = createRequire(sender);
const { actionCardPayload, digestSnapshotId, messageHash } = senderRequire('../src/lib/seo-digest-message.cjs');
const { parseConfig } = senderRequire(sender);
const { reportDay } = senderRequire('../src/lib/seo-report-time.cjs');
const source = fs.readFileSync(sender, 'utf8');
const configText = JSON.stringify({ webhook: 'https://oapi.dingtalk.com/robot/send?access_token=fixture', secret: 'fixture-secret' });
const config = parseConfig(configText);

async function runSender({ now, date, kind = 'daily', send = true, explicitReport = false, omitDate = false, manual = false, rejected = false }) {
  const clock = new Date(now);
  date ??= reportDay(clock);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.getTime()])); }
    static now() { return clock.getTime(); }
  }
  const propertyToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(clock);
  const readinessDate = new Date(Date.parse(propertyToday + 'T00:00:00Z') - 3 * 86400000).toISOString().slice(0, 10);
  const report = { date, kind, title: 'Fixture report', text: 'Fixture archive\n获客/注册截至 ' + readinessDate + '\n最近已核实页面组 4/4', detailText: 'Fixture detail', deliveryProtocol: 2, preliminary: false, accountRegistrations: { users: 1, missing: [] } };
  report.hash = crypto.createHash('sha256').update(report.text).digest('hex');
  report.id = digestSnapshotId(report);
  const payloadSha256 = messageHash(actionCardPayload(report));
  const control = { enabled: true, transport: 'signed-webhook', destination: 'cid7d5au0J8RAKDDxMR+VNh1w==', robotCode: 'tFmSJLB0+A1WmEX9zMnH2w==', webhookConfigSha256: config.fingerprint };
  const files = new Map(), calls = [], logs = [];
  const context = {
    require(name) { return name === 'node:fs/promises' ? { mkdir: async () => {}, writeFile: async (file, value) => files.set(file, value) } : senderRequire(name); },
    module: { exports: {} }, Date: Clock, Intl, URL, AbortSignal,
    process: { env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'AM-young-fun/flatkey-seo-roadmap', GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ID: '101', SEO_DINGTALK_CONFIG: configText, SEO_IMPORT_TOKEN: 'fixture-import', SEO_DIGEST_OUTPUT_DIR: '/fixture-archive',
      ...(manual ? { GITHUB_WORKFLOW_REF: 'AM-young-fun/flatkey-seo-roadmap/.github/workflows/seo-report-manual-send.yml@refs/heads/main' } : {}) },
      argv: ['node', sender, '--kind=' + kind, ...(omitDate ? [] : ['--date=' + date]), ...(send ? ['--send'] : []), ...(explicitReport || manual ? ['--report-id=' + report.id] : []),
        ...(manual ? ['--manual-owner=web-daily-538fc53b-2797-4b6a-8be0-d3670af5ffc4', '--manual-fence=2'] : [])] },
    console: { log: text => logs.push(JSON.parse(text)), error: text => logs.push({ error: text }) },
    fetch: async (url, options) => {
      url = String(url);
      const body = options?.body ? JSON.parse(options.body) : null;
      calls.push({ url, action: body?.action, date: body?.date, body });
      let result;
      if (url.startsWith('https://oapi.dingtalk.com/robot/send?')) result = { errcode: 0, errmsg: 'ok' };
      else if (body?.action === 'prepare' || body?.action === 'read_saved') result = { report };
      else if (url.endsWith('/api/seo/reporting-control')) result = { control };
      else if (url.includes('/api/traffic/daily/groups?')) result = { groups: ['gpu_compute', 'model_list', 'model_detail', 'prompts'].map(key => ({ key, points: [{ date: readinessDate, totalUsers: 1, pageViews: 1, funnel: { entrants: 1, registrations: 0 } }] })) };
      else if (url.includes('/api/traffic/daily?')) result = { points: [{ date: readinessDate, newUsers: 1, newRegistrations: 0 }] };
      else if (body?.action === 'claim') result = { ...control, id: `seo-digest-delivery:${kind}:${date}`, fencingToken: 1, messageFormat: 'actionCard', payloadSha256, report };
      else if (body?.action === 'begin_daily_manual') return new Response('{}', { status: rejected ? 409 : 200 });
      else if (body?.action === 'begin') result = { attempted: true };
      else if (body?.action === 'finish') result = { status: 'DELIVERED' };
      else throw Error('unexpected_fixture_request');
      return new Response(JSON.stringify(result), { status: 200 });
    },
  };
  vm.runInNewContext(source + '\nglobalThis.done = run();', context, { filename: sender });
  if (rejected) await assert.rejects(context.done, /report_api_http_409/);
  else await context.done;
  return { files, calls, logs, report };
}

function assertArchivedWithoutSending(result) {
  assert.ok([...result.files.keys()].some(file => file.endsWith('.md')));
  assert.ok([...result.files.keys()].some(file => file.endsWith('.action-card.json')));
  assert.ok([...result.files.keys()].some(file => file.endsWith('.preflight.json')));
  assert.ok([...result.files.keys()].some(file => file.endsWith('.delivery-skipped.json')));
  assert.equal(result.logs.at(-1).status, 'archive_only_thursday');
  assert.equal(result.calls.filter(call => call.action === 'prepare' || call.action === 'read_saved').length, 1);
  assert.equal(result.calls.some(call => ['claim', 'begin', 'finish'].includes(call.action)), false);
  assert.equal(result.calls.some(call => call.url.startsWith('https://oapi.dingtalk.com/')), false);
  assert.equal(result.calls.some(call => call.url.endsWith('/api/seo/reporting-control')), false);
}

test('Thursday daily --send still prepares and archives the report without claiming or notifying', async () => {
  const result = await runSender({ now: '2026-11-19T10:00:00Z', date: '2026-11-19' });
  assertArchivedWithoutSending(result);
  assert.equal(result.logs.at(-1).losAngelesDate, '2026-11-19');
});

test('Beijing Thursday does not block an LA Wednesday report', async () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Honolulu';
    const result = await runSender({ now: '2026-11-18T16:01:00Z', date: '2026-11-18' });
    assert.equal(result.logs.at(-1).status, 'DELIVERED');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('the actual LA Thursday blocks a Friday selection while Beijing is already Friday', async () => {
  const result = await runSender({ now: '2026-11-20T00:01:00Z', date: '2026-11-20' });
  assertArchivedWithoutSending(result);
  assert.equal(result.logs.at(-1).losAngelesDate, '2026-11-19');
});

test('the sender default report date uses LA and still archives a Thursday without sending', async () => {
  const result = await runSender({ now: '2026-11-20T00:01:00Z', omitDate: true });
  assertArchivedWithoutSending(result);
  assert.equal(result.calls[0].date, '2026-11-19');
});

test('an explicit Thursday report cannot be sent later on Friday', async () => {
  const result = await runSender({ now: '2026-11-20T10:00:00Z', date: '2026-11-19', explicitReport: true });
  assertArchivedWithoutSending(result);
  assert.equal(result.calls[0].action, 'read_saved');
});

test('Thursday weekly reports retain their existing approved delivery path', async () => {
  const result = await runSender({ now: '2026-11-19T10:00:00Z', date: '2026-11-19', kind: 'weekly' });
  assert.equal(result.logs.at(-1).status, 'DELIVERED');
  assert.equal(result.calls.filter(call => call.action === 'claim').length, 1);
  assert.equal(result.calls.filter(call => call.url.startsWith('https://oapi.dingtalk.com/')).length, 1);
  assert.equal([...result.files.keys()].some(file => file.endsWith('.delivery-skipped.json')), false);
});

test('other-day daily reports preserve normal readiness, claim, and delivery', async () => {
  const result = await runSender({ now: '2026-11-20T10:00:00Z', date: '2026-11-20' });
  assert.equal(result.logs.at(-1).status, 'DELIVERED');
  assert.equal(result.calls.filter(call => call.action === 'claim').length, 1);
  assert.equal(result.calls.filter(call => call.url.startsWith('https://oapi.dingtalk.com/')).length, 1);
  assert.ok([...result.files.keys()].some(file => file.endsWith('.source-readiness.json')));
});

test('Thursday preview-only runs keep the same report archive and never notify', async () => {
  assertArchivedWithoutSending(await runSender({ now: '2026-11-19T10:00:00Z', date: '2026-11-19', send: false }));
});

test('manual daily workflow sends only after the platform confirms the exact fenced report', async () => {
  const result = await runSender({ now: '2026-11-27T10:15:00Z', date: '2026-11-27', manual: true });
  assert.deepEqual(result.calls.filter(call => call.action).map(call => call.action), ['read_saved', 'begin_daily_manual', 'finish']);
  const begin = result.calls.find(call => call.action === 'begin_daily_manual').body;
  assert.equal(begin.reportId, result.report.id);
  assert.equal(begin.reportHash, result.report.hash);
  assert.equal(begin.payloadSha256, messageHash(actionCardPayload(result.report)));
  assert.equal(begin.fencingToken, 2);
  assert.equal(result.calls.filter(call => call.url.startsWith('https://oapi.dingtalk.com/')).length, 1);
});

test('manual daily workflow never posts to DingTalk when the platform declines the claim', async () => {
  const result = await runSender({ now: '2026-11-27T10:15:00Z', date: '2026-11-27', manual: true, rejected: true });
  assert.deepEqual(result.calls.filter(call => call.action).map(call => call.action), ['read_saved', 'begin_daily_manual']);
  assert.equal(result.calls.some(call => call.url.startsWith('https://oapi.dingtalk.com/')), false);
});
