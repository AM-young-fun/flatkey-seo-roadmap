#!/usr/bin/env node
// Read-only preflight. Never publishes, approves, or reuses a previous check as permission.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ENDPOINT = "/api/seo/workflow/approval-check";
const DEFAULT_ORIGIN = "https://flatkey-seo-roadmap.vercel.app";
const INPUT_KEYS = ["approvalId", "approvalItemId", "taskId", "pageUrl", "language", "contentVersion"];
const WIRE_KEYS = ["approvalId", "itemId", "taskId", "pageUrl", "language", "contentVersion"];
const DENIAL_CODES = new Set(["publication_unapproved", "publication_approval_mismatch", "publication_approval_unverified", "dependency_incomplete", "approval_task_missing", "approval_task_mismatch", "approval_context_mismatch", "unauthorized", "invalid_origin", "invalid_record", "invalid_json", "storage_unavailable"]);

class CheckError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fail(code) { throw new CheckError(code); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function platformOrigin(value = DEFAULT_ORIGIN) {
  let parsed;
  try { parsed = new URL(value); } catch { fail("invalid_platform_origin"); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") fail("invalid_platform_origin");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.origin !== DEFAULT_ORIGIN && !(local && ["http:", "https:"].includes(parsed.protocol))) fail("unexpected_platform_origin");
  return parsed.origin;
}
function approvalRequest(value) {
  if (!object(value) || Object.keys(value).length !== INPUT_KEYS.length || !INPUT_KEYS.every(key => Object.hasOwn(value, key))) fail("invalid_approval_input");
  for (const key of ["approvalId", "approvalItemId", "taskId"]) {
    if (typeof value[key] !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(value[key])) fail("invalid_approval_input");
  }
  if (typeof value.language !== "string" || value.language.length < 2 || value.language.length > 20 || value.language !== value.language.trim()) fail("invalid_approval_input");
  if (typeof value.contentVersion !== "string" || !value.contentVersion.trim() || value.contentVersion.length > 200 || value.contentVersion !== value.contentVersion.trim()) fail("invalid_approval_input");
  let page;
  try { page = new URL(value.pageUrl); } catch { fail("invalid_approval_input"); }
  if (typeof value.pageUrl !== "string" || value.pageUrl.length > 3000 || page.protocol !== "https:" || page.username || page.password || value.pageUrl !== value.pageUrl.trim()) fail("invalid_approval_input");
  // Preserve exact URL, language, and version bytes. A translation has its own item/version.
  return { approvalId: value.approvalId, itemId: value.approvalItemId, taskId: value.taskId, pageUrl: value.pageUrl, language: value.language, contentVersion: value.contentVersion };
}
const requestHash = request => crypto.createHash("sha256").update(JSON.stringify(Object.fromEntries(WIRE_KEYS.map(key => [key, request[key]])))).digest("hex");
function matchingRequest(actual, expected) {
  return object(actual) && Object.keys(actual).length === WIRE_KEYS.length && WIRE_KEYS.every(key => actual[key] === expected[key]);
}
function checkedResponse(value, request, startedAt, receivedAt) {
  if (!object(value) || value.allowed !== true) fail("approval_not_allowed");
  if (!matchingRequest(value.request, request) || value.approvalId !== request.approvalId || value.itemId !== request.itemId) fail("approval_response_mismatch");
  if (value.storage !== "database") fail("approval_storage_unconfirmed");
  if (typeof value.decisionId !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(value.decisionId) || !Number.isSafeInteger(value.decisionVersion) || value.decisionVersion < 1) fail("invalid_approval_response");
  const checked = Date.parse(value.checkedAt), decided = Date.parse(value.decisionRecordedAt);
  if (typeof value.checkedAt !== "string" || typeof value.decisionRecordedAt !== "string" || !Number.isFinite(checked) || !Number.isFinite(decided) || decided > checked || checked < Date.parse(startedAt) - 300_000 || checked > Date.parse(receivedAt) + 300_000) fail("approval_response_time_invalid");
  // Do not persist arbitrary response fields or provider error messages.
  return { allowed: true, request: { ...request }, approvalId: value.approvalId, itemId: value.itemId, decisionId: value.decisionId, decisionVersion: value.decisionVersion, decisionRecordedAt: value.decisionRecordedAt, checkedAt: value.checkedAt, storage: value.storage };
}
async function responseJson(response) {
  if (!response.body) fail("invalid_approval_response");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 64 * 1024) { await reader.cancel(); fail("approval_response_too_large"); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail("invalid_approval_response"); }
}
function options(argv) {
  const result = {};
  for (const argument of argv) {
    const match = /^--(input|receipt-dir)=(.+)$/.exec(argument);
    if (!match || result[match[1]]) fail("invalid_arguments");
    result[match[1]] = match[2];
  }
  if (!result.input) fail("input_required");
  return result;
}
async function saveReceipt(directory, receipt) {
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.resolve(directory, `${receipt.requestHash}-${crypto.randomUUID()}.json`);
    const handle = await fs.open(file, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(receipt, null, 2) + "\n"); await handle.sync(); }
    finally { await handle.close(); }
    return file;
  } catch { fail("approval_receipt_not_saved"); }
}
async function runApprovalCheck({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), fetchImpl = fetch } = {}) {
  const args = options(argv), origin = platformOrigin(env.SEO_PLATFORM_ORIGIN);
  const token = env.SEO_IMPORT_TOKEN;
  if (typeof token !== "string" || !token.trim() || token !== token.trim() || /[\r\n]/.test(token)) fail("missing_or_invalid_import_token");
  let raw;
  try {
    const input = await fs.readFile(path.resolve(cwd, args.input));
    if (input.byteLength > 32 * 1024) fail("invalid_approval_input");
    raw = JSON.parse(input.toString("utf8"));
  } catch { fail("invalid_approval_input"); }
  const request = approvalRequest(raw), hash = requestHash(request);
  if (JSON.stringify(request).includes(token)) fail("credential_in_approval_input");
  const requestedAt = new Date().toISOString();
  let result, httpStatus = null;
  try {
    const response = await fetchImpl(origin + ENDPOINT, {
      method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json", "cache-control": "no-store" },
      body: JSON.stringify(request), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    httpStatus = response.status;
    const data = await responseJson(response);
    if (JSON.stringify(data).includes(token)) fail("unsafe_approval_response");
    if (!response.ok) {
      const code = object(data) && DENIAL_CODES.has(data.code) ? data.code : "approval_http_error";
      fail(code);
    }
    result = checkedResponse(data, request, requestedAt, new Date().toISOString());
  } catch (error) {
    result = { allowed: false, code: error instanceof CheckError ? error.code : "approval_request_failed" };
  }
  const receipt = {
    version: 1, purpose: "page-approval-preflight", origin, endpoint: ENDPOINT, request, requestHash: hash,
    requestedAt, receivedAt: new Date().toISOString(), httpStatus, result,
    reusable: false, isPublicationReceipt: false, revalidateAtPublication: true,
  };
  const file = await saveReceipt(path.resolve(cwd, args["receipt-dir"] || ".local/page-approval-checks"), receipt);
  return { exitCode: result.allowed === true ? 0 : 1, output: { allowed: result.allowed, code: result.allowed ? "approval_precheck_passed" : result.code, origin, requestHash: hash, receipt: file, revalidateAtPublication: true } };
}
module.exports = { approvalRequest, platformOrigin, requestHash, matchingRequest, checkedResponse, runApprovalCheck };
if (require.main === module) {
  runApprovalCheck().then(({ exitCode, output }) => { console.log(JSON.stringify(output)); process.exitCode = exitCode; })
    .catch(error => { console.error(JSON.stringify({ allowed: false, code: error instanceof CheckError ? error.code : "approval_precheck_failed", revalidateAtPublication: true })); process.exitCode = 1; });
}
