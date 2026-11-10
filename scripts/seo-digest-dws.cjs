#!/usr/bin/env node
// The only transport is the approved DWS CLI. Preview by default; no test message.
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const PLATFORM_ORIGIN = "https://flatkey-seo-roadmap.vercel.app";
const DESTINATION = "cid7d5au0J8RAKDDxMR+VNh1w==";
const ROBOT_CODE = "dingoyxfe0koa0dme6fz";
function reconciliationBinding(receipt, origin) {
  if (origin !== PLATFORM_ORIGIN || receipt?.version !== 1 || receipt.origin !== origin || receipt.status !== "provider_accepted" || !receipt.processQueryKey || receipt.destination !== DESTINATION || receipt.robotCode !== ROBOT_CODE || !/^[a-f0-9]{64}$/.test(receipt.reportHash ?? "")) throw Error("untrusted_delivery_receipt_binding");
  const date = /^seo-digest-delivery:(\d{4}-\d{2}-\d{2})$/.exec(receipt.id ?? "")?.[1];
  if (!date || receipt.reportId !== `seo-digest:${date}:${receipt.reportHash.slice(0,16)}`) throw Error("untrusted_delivery_receipt_identity");
  return { reportId: receipt.reportId, reportHash: receipt.reportHash, destination: receipt.destination, robotCode: receipt.robotCode };
}
const PROFILE = "ding6b997aba57dd135335c2f4657eb6378f:17607633536267424";
function providerReceipt(value) {
  if (!value || typeof value !== "object" || value.success === false || value.error || value.errcode && value.errcode !== 0) return null;
  if (typeof value.processQueryKey === "string" && value.processQueryKey) return value.processQueryKey;
  for (const key of ["result", "data"]) { const result = providerReceipt(value[key]); if (result) return result; }
  return null;
}
function executeDws(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("dws", [...args, "--profile", PROFILE, "--format", "json"], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(Error("dws_timeout_result_unknown")); }, 60000);
    child.stdout.on("data", chunk => { output += chunk; if (output.length > 1000000) child.kill("SIGTERM"); });
    child.stderr.resume();
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); if (code !== 0) return reject(Error("dws_nonzero_result_unknown")); try { resolve(JSON.parse(output)); } catch { reject(Error("dws_invalid_receipt")); } });
  });
}
async function run() {
  const send = process.argv.includes("--send");
  const dateArg = process.argv.find(arg => arg.startsWith("--date="))?.slice(7);
  const date = dateArg || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error("invalid_date");
  const token = process.env.SEO_IMPORT_TOKEN;
  if (!token) throw Error("missing_import_token");
  const origin = process.env.SEO_PLATFORM_ORIGIN || "https://flatkey-seo-roadmap.vercel.app";
  const url = new URL(origin);
  if (url.origin !== "https://flatkey-seo-roadmap.vercel.app" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw Error("unexpected_platform_origin");
  const api = async body => {
    const response = await fetch(url.origin + "/api/seo/digest", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error("digest_api_" + response.status);
    return response.json();
  };
  const reconcile = process.argv.find(arg => arg.startsWith("--reconcile="))?.slice(12);
  if (reconcile) {
    const receipt = JSON.parse(await fs.readFile(reconcile, "utf8"));
    const binding = reconciliationBinding(receipt, url.origin);
    await api({ action: "finish", id: receipt.id, owner: receipt.owner, fencingToken: receipt.fencingToken, ...binding, status: "DELIVERED", processQueryKey: receipt.processQueryKey });
    console.log(JSON.stringify({ status: "receipt_reconciled_no_resend", id: receipt.id }));
    return;
  }
  const { report } = await api({ action: "prepare", date });
  const directory = process.env.SEO_DIGEST_OUTPUT_DIR || path.join(process.cwd(), ".local", "seo-digests");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(directory, date + ".md"), report.text, { mode: 0o600 });
  if (!send) { console.log(JSON.stringify({ status: "preview_saved", reportId: report.id, preliminary: report.preliminary, path: path.join(directory, date + ".md") })); return; }
  if (url.origin !== "https://flatkey-seo-roadmap.vercel.app") throw Error("local_preview_cannot_send");
  const owner = "codex-digest-" + randomUUID();
  const claim = await api({ action: "claim", reportId: report.id, owner });
  const context = { id: claim.id, owner, fencingToken: claim.fencingToken };
  const binding = { reportId: report.id, reportHash: report.hash, destination: claim.destination, robotCode: claim.robotCode };
  if (claim.report?.hash !== report.hash || claim.destination !== DESTINATION || claim.robotCode !== ROBOT_CODE) throw Error("unexpected_delivery_binding");
  // The server records an irreversible attempt before the external side effect.
  await api({ action: "begin", ...context });
  try {
    const result = await executeDws(["chat", "message", "send-by-bot", "--robot-code", claim.robotCode, "--group", claim.destination, "--title", report.title, "--text", report.text]);
    const processQueryKey = providerReceipt(result);
    if (!processQueryKey) throw Error("provider_receipt_missing");
    // Persist locally before remote acknowledgement, so a network failure can be reconciled without resend.
    await fs.writeFile(path.join(directory, date + ".delivery.json"), JSON.stringify({ version: 1, origin: url.origin, ...context, ...binding, processQueryKey, status: "provider_accepted" }), { mode: 0o600 });
    await api({ action: "finish", ...context, ...binding, status: "DELIVERED", processQueryKey });
    console.log(JSON.stringify({ status: "DELIVERED", reportId: report.id }));
  } catch (error) {
    await api({ action: "finish", ...context, ...binding, status: "UNKNOWN", errorCode: error.message.slice(0, 500) }).catch(() => {});
    throw Error("delivery_unconfirmed_do_not_resend");
  }
}
module.exports = { providerReceipt, executeDws, reconciliationBinding };
if (require.main === module) run().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
