#!/usr/bin/env node
/* global process, console */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

// Manual first trial only. No scheduler, database import, retry or pagination.
// https://docs.dataforseo.com/v3/dataforseo_labs-google-ranked_keywords-live/
// https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api
// https://docs.dataforseo.com/v3/auth/
import protocol from "../src/lib/dataforseo-labs.cjs";
export const { ENDPOINT, DEFAULT_RUN_ID, quoteForLimit, parseCliArgs, buildRankedKeywordsTask, normalizeRankedKeywords } = protocol;
const { CollectorError, fail } = protocol;
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = "dataforseo_labs";

async function writeJournal(handle, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, written);
    if (!result.bytesWritten) fail("JOURNAL_WRITE_FAILED", "The durable request journal could not be written. No automatic retry is permitted.");
    written += result.bytesWritten;
  }
  await handle.truncate(bytes.length);
  await handle.sync();
}
const safeError = error => error instanceof CollectorError ? error : new CollectorError("LOCAL_OR_TRANSPORT_FAILURE", "The request outcome may be unknown. No paid retry was attempted; keep the journal and inspect the saved files.");

export async function runRankedKeywordsCollector(options = {}, dependencies = {}) {
  const { execute = false, runId = DEFAULT_RUN_ID, limit = 1000 } = options;
  if (typeof execute !== "boolean") fail("INVALID_ARGUMENT", "execute must be explicitly true to send a paid request.");
  const task = buildRankedKeywordsTask(limit, runId), quote = quoteForLimit(limit), body = JSON.stringify([task]);
  const rootDir = dependencies.rootDir ?? PROJECT_ROOT;
  const outputDir = path.join(rootDir, ".local", "dataforseo-ranked-keywords", "runs", runId);
  const journalPath = path.join(rootDir, ".local", "dataforseo-ranked-keywords", "journal", `${runId}.json`);
  const plan = { status: "DRY_RUN", source: SOURCE, runId, endpoint: ENDPOINT, method: "POST", request: [task], quote, outputDir, journalPath,
    paidRequestsPlanned: 1, paidRequestsSent: 0, automaticRetry: false, automaticPagination: false, automaticImport: false };
  if (!execute) return plan;
  const env = dependencies.env ?? process.env;
  const login = env.DATAFORSEO_API_LOGIN, password = env.DATAFORSEO_API_PASSWORD;
  if (typeof login !== "string" || !login.trim() || login.includes(":") || typeof password !== "string" || !password.trim()) fail("MISSING_CREDENTIALS", "Set DATAFORSEO_API_LOGIN and DATAFORSEO_API_PASSWORD in the local process environment.");
  const now = dependencies.now ?? (() => new Date());
  await mkdir(path.dirname(journalPath), { recursive: true, mode: 0o700 });
  let journal;
  try { journal = await open(journalPath, "wx", 0o600); }
  catch (error) {
    if (error?.code === "EEXIST") fail("RUN_ALREADY_RECORDED", "This run already has a journal. A paid request will not be repeated, even after a lost response; inspect the existing files.");
    throw safeError(error);
  }
  let record = { schemaVersion: 1, source: SOURCE, runId, endpoint: ENDPOINT, status: "RESERVED", startedAt: now().toISOString(),
    requestSha256: createHash("sha256").update(body).digest("hex"), quote, request: [task], networkAttempts: 0 };
  try {
    await writeJournal(journal, record);
    await mkdir(outputDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(outputDir, "request.json"), `${JSON.stringify([task], null, 2)}\n`, { flag: "wx", mode: 0o600 });
    record = { ...record, status: "POST_STARTED", networkAttempts: 1 };
    await writeJournal(journal, record); // Durable guard before the only network call.
    const send = dependencies.fetchFn ?? globalThis.fetch;
    let response;
    try {
      response = await send(ENDPOINT, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${login}:${password}`, "utf8").toString("base64")}` },
        body, signal: globalThis.AbortSignal.timeout(60000) });
    } catch { fail("OUTCOME_UNKNOWN", "No response was confirmed. Do not resubmit this run: it may already have been charged. Keep the journal for manual investigation."); }
    const rawText = await response.text();
    await writeFile(path.join(outputDir, "raw-response.json"), rawText, { flag: "wx", mode: 0o600 });
    if (!response.ok) fail("HTTP_STATUS", `DataForSEO returned HTTP ${Number.isInteger(response.status) ? response.status : "error"}. The paid POST will not be retried.`);
    let raw;
    try { raw = JSON.parse(rawText); } catch { fail("INVALID_JSON", "DataForSEO response was not valid JSON. The raw response was saved; do not repeat the paid POST."); }
    const collectedAt = now().toISOString();
    const normalized = normalizeRankedKeywords(raw, { runId, collectedAt, limit });
    await writeFile(path.join(outputDir, "normalized.json"), `${JSON.stringify(normalized, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    record = { ...record, status: "COMPLETED", completedAt: collectedAt, httpStatus: response.status, taskId: normalized.taskId,
      actualCostMicros: normalized.actualCostMicros, actualCostUsd: normalized.actualCostUsd, returnedItems: normalized.returnedItems, validObservations: normalized.rows.length };
    await writeJournal(journal, record);
    return { status: "COMPLETED", source: SOURCE, runId, outputDir, journalPath, paidRequestsSent: 1, actualCostUsd: normalized.actualCostUsd,
      costWithinEstimate: normalized.costWithinEstimate, returnedItems: normalized.returnedItems, validObservations: normalized.rows.length,
      uniqueKeywords: normalized.uniqueKeywords, totalMatchingCount: normalized.totalMatchingCount, truncated: normalized.truncated };
  } catch (error) {
    const safe = safeError(error);
    record = { ...record, status: safe.code === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "FAILED_NO_RETRY", endedAt: now().toISOString(), errorCode: safe.code };
    await writeJournal(journal, record).catch(() => {});
    throw safe;
  } finally { await journal.close().catch(() => {}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) console.log("Manual DataForSEO Labs US/en flatkey.ai trial. Default: dry-run, limit 1000, maximum estimated $0.132. Use --execute only after authorization. Optional --run-id STABLE_ID --limit 1..1000. Credentials: DATAFORSEO_API_LOGIN / DATAFORSEO_API_PASSWORD. An existing run journal always blocks another paid POST. No automatic retries, pagination, imports or scheduling.");
    else console.log(JSON.stringify(await runRankedKeywordsCollector(options), null, 2));
  } catch (error) {
    const safe = safeError(error);
    console.error(JSON.stringify({ status: "FAILED", code: safe.code, message: safe.message }));
    process.exitCode = 1;
  }
}
