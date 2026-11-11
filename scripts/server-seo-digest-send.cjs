#!/usr/bin/env node
// Signed webhook secret stays in the existing GitHub Actions secret store.
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { actionCardPayload, messageHash } = require('../src/lib/seo-digest-message.cjs');
const { signedWebhook } = require('./seo-alert.cjs');
const ORIGIN = 'https://flatkey-seo-roadmap.vercel.app', REPO = 'AM-young-fun/flatkey-seo-roadmap';
const GROUP = 'cid7d5au0J8RAKDDxMR+VNh1w==', BOT = 'tFmSJLB0+A1WmEX9zMnH2w==';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function parseConfig(text) {
  let value; try { value = JSON.parse(text); } catch { throw Error('invalid_webhook_configuration'); }
  let url; try { url = new URL(value.webhook); } catch { throw Error('invalid_webhook_configuration'); }
  if (url.protocol !== 'https:' || url.hostname !== 'oapi.dingtalk.com' || url.pathname !== '/robot/send' || url.username || url.password || url.port || url.hash || [...url.searchParams.keys()].some(key => key !== 'access_token') || !url.searchParams.get('access_token') || typeof value.secret !== 'string' || !value.secret.trim()) throw Error('invalid_webhook_configuration');
  return { webhook: url.toString(), secret: value.secret, fingerprint: hash('seo-webhook-v1\n' + url.toString() + '\n' + value.secret) };
}
function acceptedReceipt(response, text, config, runId, now = new Date()) {
  let value; try { value = JSON.parse(text); } catch { throw Error('webhook_response_unrecognized'); }
  if (!response.ok || response.status !== 200 || value.errcode !== 0) {
    const code = typeof value.errcode === 'number' && Number.isSafeInteger(value.errcode) ? String(value.errcode) : 'unrecognized';
    throw Object.assign(Error('webhook_not_accepted_' + code), { providerFailure: { transport: 'signed-webhook', httpStatus: response.status, providerCode: code, responseHash: hash(text), confirmedNotAccepted: response.status === 200 && code !== 'unrecognized' && code !== '0' } });
  }
  const trace = response.headers.get('x-acs-request-id');
  return { transport: 'signed-webhook', httpStatus: 200, errcode: 0, responseHash: hash(text), webhookConfigSha256: config.fingerprint, acceptedAt: now.toISOString(), repository: REPO, workflowRunId: runId, ...(trace && /^[A-Za-z0-9_-]{1,160}$/.test(trace) ? { providerTraceId: trace } : {}) };
}
async function run() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== REPO || process.env.GITHUB_REF !== 'refs/heads/main' || !/^\d{1,20}$/.test(process.env.GITHUB_RUN_ID || '')) throw Error('authorized_production_workflow_required');
  const flag = name => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
  const kind = flag('kind') || 'daily', date = flag('date') || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  if (!['daily','weekly'].includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('invalid_report_selection');
  const config = parseConfig(process.env.SEO_DINGTALK_CONFIG || '');
  if (!process.env.SEO_IMPORT_TOKEN) throw Error('missing_import_credential');
  const api = async (route, body) => {
    const response = await fetch(ORIGIN + route, { method: body ? 'POST' : 'GET', redirect: 'error', headers: { authorization: 'Bearer ' + process.env.SEO_IMPORT_TOKEN, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error('report_api_http_' + response.status);
    return response.json();
  };
  const reportId = flag('report-id');
  const { report } = await api('/api/seo/digest', reportId ? { action: 'read_saved', reportId } : { action: 'prepare', date, kind });
  if (report?.date !== date || report.kind !== kind || report.hash !== hash(report.text || '') || report.id !== `seo-digest:${date}:${report.hash.slice(0,16)}` || report.deliveryProtocol !== 2) throw Error('report_binding_mismatch');
  const payload = actionCardPayload(report), payloadSha256 = messageHash(payload);
  const directory = process.env.SEO_DIGEST_OUTPUT_DIR || path.join(process.env.RUNNER_TEMP || '/tmp', 'seo-digest');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const prefix = path.join(directory, date + '.' + kind);
  const write = (suffix, data) => fs.writeFile(prefix + suffix, typeof data === 'string' ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
  await write('.md', report.text);
  await write('.action-card.json', payload);
  await write('.preflight.json', { version: 1, transport: 'signed-webhook', messageFormat: 'actionCard', payloadSha256, destination: GROUP, robotCode: BOT, webhookConfigSha256: config.fingerprint, reportId: report.id, reportHash: report.hash, preliminary: report.preliminary, repository: REPO, workflowRunId: process.env.GITHUB_RUN_ID });
  if (!process.argv.includes('--send')) { console.log(JSON.stringify({ status: 'preflight_only', reportId: report.id, webhookConfigSha256: config.fingerprint, transport: 'signed-webhook' })); return; }
  const { control } = await api('/api/seo/reporting-control');
  if (!control.enabled || control.transport !== 'signed-webhook' || control.destination !== GROUP || control.robotCode !== BOT || control.webhookConfigSha256 !== config.fingerprint) throw Error('webhook_control_binding_unverified');
  const owner = `github-webhook-${process.env.GITHUB_RUN_ID}-${crypto.randomUUID()}`;
  const claim = await api('/api/seo/digest', { action: 'claim', reportId: report.id, owner, transport: 'signed-webhook', messageFormat: 'actionCard' });
  if (claim.messageFormat !== 'actionCard' || claim.payloadSha256 !== payloadSha256 || claim.transport !== 'signed-webhook' || claim.destination !== GROUP || claim.robotCode !== BOT || claim.webhookConfigSha256 !== config.fingerprint || claim.report?.hash !== report.hash) throw Error('webhook_claim_binding_mismatch');
  const context = { id: claim.id, owner, fencingToken: claim.fencingToken, reportId: report.id, reportHash: report.hash, destination: GROUP, robotCode: BOT };
  await write('.claim.json', { version: 1, origin: ORIGIN, ...context, webhookConfigSha256: config.fingerprint });
  await api('/api/seo/digest', { action: 'begin', id: context.id, owner, fencingToken: context.fencingToken, transport: 'signed-webhook' });
  try {
    // No retry after this request: uncertain delivery stays UNKNOWN until evidence-based reconciliation.
    const response = await fetch(signedWebhook(config.webhook, config.secret), { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
    const receipt = { ...acceptedReceipt(response, await response.text(), config, process.env.GITHUB_RUN_ID), messageFormat: 'actionCard', payloadSha256 };
    await write('.accepted.json', { version: 1, origin: ORIGIN, ...context, webhookReceipt: receipt });
    await api('/api/seo/digest', { action: 'finish', ...context, status: 'DELIVERED', webhookReceipt: receipt });
    console.log(JSON.stringify({ status: 'DELIVERED', reportId: report.id, workflowRunId: process.env.GITHUB_RUN_ID, transport: 'signed-webhook' }));
  } catch (error) {
    const errorCode = /^webhook_|^report_api_http_/.test(error.message) ? error.message.slice(0,120) : 'webhook_transport_result_unknown';
    await write('.failure.json', { version: 1, origin: ORIGIN, ...context, errorCode, providerFailure: error.providerFailure ?? null, recordedAt: new Date().toISOString() });
    await api('/api/seo/digest', { action: 'finish', ...context, status: 'UNKNOWN', errorCode }).catch(() => {});
    throw Error('webhook_delivery_unconfirmed_do_not_resend');
  }
}
module.exports = { parseConfig, acceptedReceipt };
if (require.main === module) run().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
