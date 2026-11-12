#!/usr/bin/env node
// One approved Prompt at a time. Default: read-only preflight. Never approves,
// uploads media, rewrites an existing slug, or retries an ambiguous POST.
const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { execFile } = require("node:child_process"), { promisify } = require("node:util");
const { approvalRequest, checkedResponse } = require("./seo-page-approval-check.cjs");
const SEO = "https://flatkey-seo-roadmap.vercel.app", CONSOLE = "https://console.flatkey.ai";
const PROTOCOL = "approved-create-only-v1";
const POST_MARKER = "PROMPT_POST_ATTEMPT_V1";
const LANGUAGES = { en: "en-US", zh: "zh-CN", es: "es-ES", fr: "fr-FR", pt: "pt-BR", ru: "ru-RU", ja: "ja-JP", vi: "vi-VN", de: "de-DE", id: "id-ID" };
const CATALOGS = new Set([
  "https://huggingface.co/datasets/Goku-OpenLab/gpt-image-2-prompts-datasets",
  "https://huggingface.co/datasets/GokuScraper/seedance-2-prompts-datasets",
  "https://huggingface.co/datasets/ml-resources/MiniMax-H3-Self-Generated-Dataset",
  "https://github.com/flatkey-ai/awesome-images",
  "https://github.com/flatkey-ai/awesome-seedance-prompts",
]);
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const object = value => value && typeof value === "object" && !Array.isArray(value);
class ReleaseError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new ReleaseError(code); };
function https(value) { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.port; } catch { return false; } }
function stable(value) { return JSON.stringify(Array.isArray(value) ? value.map(v => JSON.parse(stable(v))) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(stable(value[k]))])) : value); }
function validateInput(input) {
  if (!object(input) || input.version !== 1 || typeof input.approvedItemJSON !== "string" || Buffer.byteLength(input.approvedItemJSON) > 1024 * 1024) fail("invalid_release_input");
  let item; try { item = JSON.parse(input.approvedItemJSON); } catch { fail("invalid_item_json"); }
  if (!object(item) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) || item.slug.length > 160 || !["image", "video"].includes(item.category)) fail("invalid_prompt_identity");
  const models = { image: ["gpt-image-2"], video: ["seedance-2.0", "MiniMax-H3"] };
  if (!models[item.category].includes(item.model) || typeof item.prompt !== "string" || !item.prompt.trim() || item.prompt !== item.prompt.trim()) fail("invalid_prompt_model_or_content");
  if (!object(item.artifact) || item.artifact.kind !== item.category || !https(item.artifact.url) || !object(item.source) || !https(item.source.url) || !item.source.platform || !item.source.label) fail("invalid_prompt_provenance");
  if (new URL(item.artifact.url).search || !Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== "string") || !object(item.output) || Object.keys(item.source).some(key => !["label", "platform", "url", "captured_at"].includes(key)) || ["label", "platform", "url", "captured_at"].some(key => typeof item.source[key] !== "string" || item.source[key] !== item.source[key].trim())) fail("noncanonical_import_fields");
  // These are signed into the same content hash reviewers approve. An existing
  // candidate pool is not evidence that any of these checks passed.
  const review = item._seo_review;
  if (!object(review) || !CATALOGS.has(review.catalogUrl) || !/^[a-f0-9]{40}$/.test(review.revision) || review.originalSourceUrl !== item.source.url || !review.author || !review.license || !review.reviewer || !Number.isFinite(Date.parse(review.checkedAt)) || !/^[a-f0-9]{64}$/.test(review.artifactSha256)) fail("review_evidence_missing");
  for (const key of ["originalAuthorAndLicense", "fullMediaReview", "publicCdnVerified", "duplicateCheck", "generationModelVerified"]) if (review[key] !== true) fail("review_evidence_incomplete");
  if (item.category === "video" && (review.fullDecode !== true || review.keyframesReviewed !== true)) fail("video_review_incomplete");
  if (!Array.isArray(review.evidence) || !review.evidence.length || review.evidence.some(e => !object(e) || !https(e.url) || !e.label)) fail("review_evidence_missing");
  const contentVersion = "sha256:" + sha(input.approvedItemJSON);
  if (input.contentVersion !== contentVersion || typeof input.taskId !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(input.taskId) || !/^\d{4}-\d{2}-\d{2}$/.test(input.weekStart) || new Date(input.weekStart + "T00:00:00Z").getUTCDay() !== 1) fail("release_version_or_week_mismatch");
  if (!object(item.title) || !object(item.summary) || Object.keys(LANGUAGES).some(lang => !item.title[lang]?.trim() || !item.summary[lang]?.trim())) fail("ten_language_content_required");
  if (!Array.isArray(input.approvals) || input.approvals.length !== 10) fail("all_ten_page_approvals_required");
  const approvals = input.approvals.map(approvalRequest);
  for (const locale of Object.keys(LANGUAGES)) {
    const pageUrl = `https://flatkey.ai/${locale === "en" ? "" : locale + "/"}prompts/${item.category}/${item.slug}`;
    if (approvals.filter(a => a.pageUrl === pageUrl && a.language === locale && a.taskId === input.taskId && a.contentVersion === contentVersion).length !== 1) fail("approval_page_binding_mismatch");
  }
  return { ...input, item, approvals, contentVersion };
}
function exactPublicItem(actual, input) {
  if (!object(actual) || actual.contentVersion !== input.contentVersion || !Number.isSafeInteger(actual.createdAt) || actual.createdAt <= 0 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(actual.importCreatedAt ?? "") || !Number.isFinite(Date.parse(actual.importCreatedAt)) || Math.floor(Date.parse(actual.importCreatedAt) / 1000) !== actual.createdAt) return false;
  return ["slug", "category", "model", "prompt", "title", "summary", "tags", "artifact", "output", "source"].every(key => stable(actual[key] ?? null) === stable(input.item[key] ?? null));
}
async function readKeychain() {
  // Existing import-only Integration AccessKey; not an SEO approval token.
  // Child stdout stays in memory, never inherited by a logger/argv/env/file.
  try {
    const { stdout } = await promisify(execFile)("/usr/bin/security", ["find-generic-password", "-s", "flatkey-prompt-library-import-access-key", "-a", "automation-2", "-w", path.join(require("node:os").homedir(), "Library/Keychains/login.keychain-db")], { encoding: "utf8", maxBuffer: 8192 });
    const value = stdout.trim(); if (!value || /[\r\n]/.test(value)) fail("prompt_credential_unavailable"); return value;
  } catch { fail("prompt_credential_unavailable"); }
}
async function jsonResponse(response, limit = 4 * 1024 * 1024) {
  const reader = response.body?.getReader(); if (!reader) fail("invalid_response");
  const chunks = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); fail("response_too_large"); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail("invalid_response"); }
}
function options(argv) {
  const value = { execute: false };
  for (const arg of argv) {
    if (arg === "--execute" && !value.execute) value.execute = true;
    else { const m = /^--(input|receipt-dir|release-authorized)=(.+)$/.exec(arg); if (!m || value[m[1]]) fail("invalid_arguments"); value[m[1]] = m[2]; }
  }
  if (!value.input || (value.execute && !value["release-authorized"])) fail("explicit_release_authorization_required");
  return value;
}
function cleanStored(value) { const copy = { ...value }; for (const k of ["version", "updatedAt", "recordedAt", "verificationRecordedAt"]) delete copy[k]; return copy; }

async function releasePrompt({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), fetchImpl = fetch, credentialLoader = readKeychain, now = () => new Date() } = {}) {
  const args = options(argv), token = env.SEO_IMPORT_TOKEN;
  if (!token?.trim() || /[\r\n]/.test(token) || env.SEO_PLATFORM_ORIGIN && env.SEO_PLATFORM_ORIGIN !== SEO) fail("seo_credential_or_origin_invalid");
  let raw; try { const b = await fs.readFile(path.resolve(cwd, args.input)); if (b.length > 2 * 1024 * 1024) fail("input_too_large"); raw = JSON.parse(b); } catch { fail("input_unreadable"); }
  if (JSON.stringify(raw).includes(token)) fail("credential_in_input");
  const input = validateInput(raw);
  if (args.execute && args["release-authorized"] !== input.contentVersion) fail("explicit_release_version_mismatch");
  const directory = path.resolve(cwd, args["receipt-dir"] || ".local/prompt-release");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const receiptPath = path.join(directory, `${sha(input.contentVersion).slice(0, 20)}-${crypto.randomUUID()}.json`);
  const stamp = () => now().toISOString();
  const receipt = { protocol: PROTOCOL, taskId: input.taskId, contentVersion: input.contentVersion, slug: input.item.slug, mode: args.execute ? "execute" : "preflight", startedAt: stamp(), productionPostAttempted: false, importedNew: 0, publishedPages: 0, verifiedPages: 0, code: "started" };
  async function save() { await fs.writeFile(receiptPath, JSON.stringify({ ...receipt, recordedAt: stamp() }, null, 2) + "\n", { mode: 0o600 }); }
  let promptToken;
  async function request(url, body, auth = token) {
    let response; try { response = await fetchImpl(url, { method: body ? "POST" : "GET", headers: { ...(auth ? { authorization: "Bearer " + auth } : {}), accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), "cache-control": "no-store" }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) }); } catch { fail("request_outcome_unknown"); }
    const data = await jsonResponse(response);
    if ([token, promptToken].filter(Boolean).some(secret => JSON.stringify(data).includes(secret))) fail("unsafe_response");
    return { response, data };
  }
  async function seo(endpoint, body) { const r = await request(SEO + endpoint, body); if (!r.response.ok) fail("seo_http_" + r.response.status); return r.data; }
  async function snapshot() { const data = await seo("/api/seo/workflow?week=" + input.weekStart + "&allHistory=true"); if (data.storage !== "database") fail("durable_workflow_unavailable"); if (data.capabilities?.promptPublication !== 1) fail("platform_prompt_publication_not_deployed"); return data; }
  async function approvals() {
    const results = [];
    for (const approval of input.approvals) {
      // Already accepted publication receipts are facts, not permission to POST.
      // The server deliberately refuses a new-page approval once it is live.
      const accepted = state.publications.some(p => p.pageUrl === approval.pageUrl && p.contentVersion === input.contentVersion && p.taskId === input.taskId && p.approvalId === approval.approvalId && p.approvalItemId === approval.itemId && ["published", "verified"].includes(p.status));
      if (accepted) continue;
      const started = stamp(); const data = await seo("/api/seo/workflow/approval-check", approval); results.push(checkedResponse(data, approval, started, stamp()));
    }
    return results;
  }
  const publicURL = CONSOLE + "/api/prompt-library/" + input.item.slug;
  async function publicItem() {
    const { response, data } = await request(publicURL, undefined, null);
    if (response.headers.get("x-prompt-import-protocol") !== PROTOCOL) fail("backend_create_only_not_deployed");
    if (response.status === 404) return null;
    if (!response.ok || data.success !== true) fail("public_readback_unavailable");
    if (!exactPublicItem(data.data?.item, input)) fail("existing_slug_content_conflict");
    return data.data.item;
  }
  const proof = label => ({ label, artifact: receiptPath, observedAt: stamp() });
  let lease, run, state, claim, scheduledFor, stage;
  async function mutation(action, record, expectedVersion) {
    const data = await seo("/api/seo/workflow", { action, record, expectedVersion, claim, requestId: "prompt-" + crypto.randomUUID() });
    if (data.stored !== true || data.storage !== "database" || data.record?.id !== record.id) fail("workflow_write_unconfirmed"); return data.record;
  }
  async function finish(status, reason) {
    run = await mutation("record_run", { ...cleanStored(run), completedAt: stamp(), status, checkedItems: 10, completedItems: receipt.verifiedPages, coverage: status === "completed" ? "full" : "partial", failureReason: reason, evidence: [...run.evidence, proof(status)], nextAction: status === "completed" ? "每日监控正式提示词页面与渠道表现。" : "只读核对已有导入和页面材料；不得盲重发生产请求。" }, run.version);
    const back = await snapshot(); if (!back.runs.some(r => r.id === run.id && r.version === run.version && r.status === status)) fail("run_readback_mismatch");
    await seo("/api/seo/workflow/claims", { ...lease, action: "complete", fencingToken: claim.fencingToken, status, evidence: [proof(status)] });
  }
  try {
    state = await snapshot();
    const task = state.tasks.find(t => t.id === input.taskId);
    if (!task || task.kind !== "technical" || task.siteDomain !== "flatkey.ai" || task.contentVersion !== input.contentVersion || task.weekStart !== input.weekStart || task.pageUrl !== null || task.country !== null || task.language !== null || task.keyword !== null) fail("prompt_task_context_mismatch");
    for (const a of input.approvals) {
      const item = state.approvals.find(row => row.id === a.approvalId)?.items.find(row => row.id === a.itemId);
      if (item?.operation !== "new" || item.reviewContent !== input.approvedItemJSON) fail("approved_content_not_bound");
    }
    const checks = await approvals();
    let stored = await publicItem();
    receipt.existingMatched = Boolean(stored);
    if (!args.execute) { receipt.code = "preflight_passed_not_permission"; await save(); return { exitCode: 0, ...receipt, receipt: receiptPath }; }
    stage = "PROMPT_RELEASE_" + sha(input.contentVersion).slice(0, 24).toUpperCase();
    // Identical content always uses one durable run identity. Approval decisions
    // can be revised, but cannot produce a new production attempt identity.
    const runId = "prompt-release-" + sha(input.contentVersion).slice(0, 40);
    const previous = state.runs.find(r => r.id === runId);
    if (previous) scheduledFor = previous.scheduledFor;
    else if (checks.length === 10) scheduledFor = new Date(Math.max(...checks.map(c => Date.parse(c.decisionRecordedAt)))).toISOString();
    else fail("partial_historical_import_requires_reconciliation");
    // All demonstrably pre-POST preparation happens before the durable marker.
    // A missing/revoked Keychain entry must remain retryable after it is repaired.
    if (!stored && !previous?.evidence.some(e => e.label === POST_MARKER)) {
      promptToken = await credentialLoader();
      if (typeof promptToken !== "string" || !promptToken.trim() || /[\r\n]/.test(promptToken) || promptToken === token || input.approvedItemJSON.includes(promptToken)) fail("prompt_credential_invalid");
    }
    lease = { runId, stage, scheduledFor, owner: "prompt-release-" + crypto.randomUUID(), leaseSeconds: 1800 };
    const acquired = await seo("/api/seo/workflow/claims", { ...lease, action: "claim" });
    if (!acquired.acquired) { receipt.code = acquired.reason === "completed" ? "already_completed" : "another_executor_owns_claim"; await save(); return { exitCode: acquired.reason === "completed" ? 0 : 1, ...receipt, receipt: receiptPath }; }
    claim = { runId, owner: lease.owner, fencingToken: acquired.fencingToken };
    state = await snapshot(); run = state.runs.find(r => r.id === runId);
    const attemptedBefore = Boolean(run?.evidence.some(e => e.label === POST_MARKER));
    if (run && (run.inputVersion !== input.contentVersion || run.stage !== stage)) fail("existing_run_mismatch");
    await approvals(); // Latest check immediately before durable attempt and POST.
    // Refresh after claim: another author may have published while preflighting.
    stored = await publicItem();
    if (!stored && attemptedBefore) fail("previous_attempt_unknown_readback_missing");
    const newRun = { id: runId, weekStart: input.weekStart, stage, scheduledFor, startedAt: stamp(), completedAt: null, status: "running", owner: lease.owner, taskIds: [input.taskId], inputVersion: input.contentVersion, evidence: [], failureReason: null, nextAction: "正在只读核对已导入条目。", checkedItems: 10, completedItems: 0, costMicros: 0, coverage: "unknown", sourceDates: {} };
    if (!stored) {
      if (checks.length !== 10) fail("all_current_approvals_required_before_post");
      if (!promptToken) fail("prompt_credential_unavailable");
      const postBody = { create_only: true, content_version: input.contentVersion, approved_item_json: input.approvedItemJSON };
      await save();
      run = await mutation("record_run", { ...(run ? cleanStored(run) : newRun), status: "running", completedAt: null, failureReason: null, evidence: [...(run?.evidence ?? []), proof(POST_MARKER)], nextAction: "本标记之后只允许核对同版本正式条目，不能自动重发POST。" }, run?.version ?? 0);
      receipt.productionPostAttempted = true;
      const result = await request(CONSOLE + "/api/prompt-library/import", postBody, promptToken);
      if (!result.response.ok || result.data.success !== true || result.data.data?.protocol !== PROTOCOL || result.data.data?.content_version !== input.contentVersion || typeof result.data.data?.created !== "boolean" || !exactPublicItem(result.data.data?.item, input)) fail("production_response_requires_readback");
      receipt.importedNew = result.data.data.created ? 1 : 0;
      stored = await publicItem(); if (!stored) fail("production_readback_missing");
    }
    if (!run) run = await mutation("record_run", { ...newRun, evidence: [proof("已有精确版本正式 API 读回；无生产 POST") ] }, 0);
    // Backend stores the high-precision creation instant alongside the legacy
    // second-resolution field; do not round it or invent a later client time.
    const publishedAt = stored.importCreatedAt;
    if (checks.length && Date.parse(publishedAt) < Math.max(...checks.map(c => Date.parse(c.decisionRecordedAt))) || Date.parse(publishedAt) > now().getTime() + 5000) fail("production_timestamp_invalid");
    receipt.publishedAt = publishedAt; receipt.publicApiVerifiedAt = stamp();
    await save();
    // A verified API row is a real import, not proof the website ISR cache has
    // served the new page. Keep published, and let normal live-page verification
    // supply HTML/canonical/language/link evidence before marking verified.
    for (const a of input.approvals) {
      const existing = state.publications.find(p => p.pageUrl === a.pageUrl && p.contentVersion === input.contentVersion);
      if (existing) { if (existing.kind !== "prompt" || existing.taskId !== input.taskId || existing.publishedAt !== publishedAt) fail("publication_identity_conflict"); receipt.publishedPages++; if (existing.status === "verified") receipt.verifiedPages++; continue; }
      await mutation("record_publication", { id: "prompt-" + sha(input.contentVersion + a.pageUrl).slice(0, 40), taskId: input.taskId, approvalId: a.approvalId, approvalItemId: a.itemId, weekStart: input.weekStart, runId, siteDomain: "flatkey.ai", pageUrl: a.pageUrl, country: null, language: a.language, keyword: null, contentVersion: input.contentVersion, title: input.item.title[a.language], kind: "prompt", sourcePublicationId: null, publishedAt, verifiedAt: null, status: "published", liveCheck: null, evidence: [proof("create-only 正式 API 同版本读回；页面渲染待验"), { label: "正式 Prompt API", url: publicURL, observedAt: stamp() }], failureReason: null }, 0);
      receipt.publishedPages++;
    }
    state = await snapshot();
    if (input.approvals.some(a => !state.publications.some(p => p.pageUrl === a.pageUrl && p.contentVersion === input.contentVersion && p.kind === "prompt"))) fail("publication_readback_mismatch");
    const latestTask = state.tasks.find(t => t.id === input.taskId);
    if (!["published", "verified", "observing"].includes(latestTask.status)) await mutation("save_task", { ...cleanStored(latestTask), status: "published", evidence: [...latestTask.evidence, proof("正式导入已读回，十语言页面渲染仍待验")], nextAction: "用正式页面的 HTTP、canonical、语言、内容和链接证据逐页验收；不得把 API 已导入当作页面已验证。" }, latestTask.version);
    receipt.code = receipt.verifiedPages === 10 ? "all_pages_verified" : "imported_pages_need_live_verification";
    await finish(receipt.verifiedPages === 10 ? "completed" : "partial", receipt.verifiedPages === 10 ? null : "正式 Prompt API 已读回；页面渲染验收尚未全部完成。" );
    await save(); return { exitCode: 0, ...receipt, receipt: receiptPath };
  } catch (error) {
    receipt.code = error instanceof ReleaseError ? error.code : "release_failed";
    receipt.outcome = receipt.productionPostAttempted ? "unknown_requires_readback" : "blocked";
    // Never resend here. Preserve the attempt marker across crashes/nodes.
    if (claim && !run) {
      try { run = await mutation("record_run", { id: claim.runId, weekStart: input.weekStart, stage, scheduledFor, startedAt: receipt.startedAt, completedAt: stamp(), status: "blocked", owner: claim.owner, taskIds: [input.taskId], inputVersion: input.contentVersion, evidence: [proof("生产POST之前停止，未创建不可重试尝试标记")], failureReason: receipt.code, nextAction: "修复准备条件后重新检查审批；尚未发送生产请求。", checkedItems: 10, completedItems: 0, costMicros: 0, coverage: "partial", sourceDates: {} }, 0); }
      catch { receipt.workflowRecoveryRequired = true; }
    }
    if (claim && run) { try { await finish("partial", receipt.code); } catch { receipt.workflowRecoveryRequired = true; } }
    await save(); return { exitCode: 1, ...receipt, receipt: receiptPath };
  } finally { promptToken = undefined; }
}
module.exports = { releasePrompt, validateInput, exactPublicItem, LANGUAGES, PROTOCOL };
if (require.main === module) releasePrompt().then(result => { console.log(JSON.stringify(result)); process.exitCode = result.exitCode; }).catch(error => { console.error(JSON.stringify({ code: error instanceof ReleaseError ? error.code : "release_failed" })); process.exitCode = 1; });
