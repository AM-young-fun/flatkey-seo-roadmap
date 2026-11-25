"use strict";

// This guard coordinates the explicitly approved recovery batch on this host.
// It does not create plans, claim server leases, grant publication authority or
// change any original task. The server remains the lease/identity authority.
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const manifest = require("./seo-recovery-manifest-20261124.json");
const { isSeoWorkday } = require("./seo-workday.cjs");
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });
const clockFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const hash = value => createHash("sha256").update(value).digest("hex");
const requiredReceipts = ["member1600", "wordLanguageAndMarketIdentity1600", "quarterPlanningSaveApproveFreeze", "internalLoopAcceptance", "originalTaskArrangementProductionReadback", "automationRestore13Readback"];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function evidenceFile(reference) {
  if (!reference || typeof reference.artifact !== "string" || !path.isAbsolute(reference.artifact)
    || !/^[a-f0-9]{64}$/.test(reference.sha256)) throw Error("recovery_receipt_reference_missing");
  const info = fs.lstatSync(reference.artifact);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024) throw Error("recovery_receipt_file_invalid");
  const bytes = fs.readFileSync(reference.artifact);
  if (hash(bytes) !== reference.sha256) throw Error("recovery_receipt_hash_changed");
  return bytes;
}
const isExtra = task => ["authorized_hotspot_extra", "authorized_weekly_growth_extra"].includes(task?.capacityClass);
function category(task) {
  if (isExtra(task)) return null;
  if (task?.workClass === "content_refresh" && ["flatkey.ai", "modelfit.cc"].includes(task.siteDomain) && task.kind === "optimization") return "refresh";
  if (task?.kind === "blog" && task.siteDomain === "flatkey.ai") return "blog";
  if (task?.kind === "blog" && task.siteDomain === "modelfit.cc") return "modelfit_blog";
  if (task?.kind === "optimization" && task.siteDomain === "flatkey.ai") return "optimization";
  if (task?.kind === "landing" && ["rackrate.org", "modelfit.cc"].includes(task.siteDomain)) return "cluster_landing";
  return null;
}
function businessWeek(day) {
  const weekday = new Date(day + "T00:00:00Z").getUTCDay();
  const shift = (weekday - 5 + 7) % 7;
  const start = new Date(Date.parse(day + "T00:00:00Z") - shift * 86400000).toISOString().slice(0, 10);
  return { start, end: new Date(Date.parse(start + "T00:00:00Z") + 6 * 86400000).toISOString().slice(0, 10) };
}
function identityMatches(task, row) {
  const fields = [task.id, task.kind, task.siteDomain, task.country, task.language, task.keyword, task.dueAt, task.weekStart];
  return hash(JSON.stringify(fields)) === row.identitySha256;
}
function guarded(task, policy = manifest) {
  // Extra work and post-publication QA keep their original independent gates.
  return typeof task?.id === "string" && policy.members.some(row => row.taskIdSha256 === hash(task.id))
    && !isExtra(task) && !["published", "verified", "observing"].includes(task.status);
}
function dispatchWindow(now, policy = manifest) {
  const [hour, minute] = clockFormat.format(now).split(":").map(Number), current = hour * 60 + minute;
  return policy.dispatchStartsBJT.some(start => {
    const [h, m] = start.split(":").map(Number), beginning = h * 60 + m;
    return current >= beginning && current < beginning + policy.dispatchClaimWindowMinutes;
  });
}

function createRecoveryGuard(projectRoot, policy = manifest) {
  // Policy injection is for pure unit tests. The production entrypoints always
  // use this module's shipped policy; no CLI or environment override exists.
  const members = new Map(policy.members.map(row => [row.taskIdSha256, row]));
  const isGuarded = task => guarded(task, policy);
  const runtimeFile = path.join(projectRoot, policy.runtimeRelativePath);
  const directory = path.join(projectRoot, ".local/seo-recovery-runtime-v1");
  const ledgerFile = path.join(directory, "ledger.json");
  const blank = () => ({ version: 1, batchId: policy.batchId, tasks: [], scopes: [] });
  function ledger() {
    const value = readJson(ledgerFile) ?? blank();
    if (value.version !== 1 || value.batchId !== policy.batchId || !Array.isArray(value.tasks) || !Array.isArray(value.scopes)) throw Error("recovery_ledger_invalid");
    return value;
  }
  function withLedger(change) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const lock = path.join(directory, "write.lock");
    try { fs.mkdirSync(lock); }
    catch (error) { if (error.code === "EEXIST") throw Error("recovery_ledger_busy"); throw error; }
    const temporary = path.join(directory, "." + randomUUID() + ".json");
    try {
      const value = ledger(), result = change(value);
      fs.writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, ledgerFile);
      return result;
    } finally { fs.rmSync(temporary, { force: true }); fs.rmdirSync(lock); }
  }
  function runtime() {
    const value = readJson(runtimeFile);
    if (!value || value.state !== "READY") throw Error("recovery_hold");
    if (value.version !== 1 || value.approvedWordListSha256 !== policy.approvedWordListSha256) throw Error("recovery_manifest_mismatch");
    for (const key of requiredReceipts) evidenceFile(value.actualPrerequisiteReceipts?.[key]);
    const baseline = JSON.parse(evidenceFile(value.usageBaseline).toString("utf8"));
    if (baseline.storage !== "database" || !Array.isArray(baseline.tasks) || !Array.isArray(baseline.publications)
      || !Number.isFinite(Date.parse(baseline.generatedAt))) throw Error("recovery_usage_baseline_invalid");
    return { value, baseline };
  }
  function usage(value, baseline, snapshot, now) {
    const day = dayFormat.format(now), week = businessWeek(day);
    const tasks = new Map([...(baseline.tasks ?? []), ...(snapshot?.tasks ?? [])].map(task => [task.id, task]));
    const facts = new Map([...(baseline.publications ?? []), ...(snapshot?.publications ?? [])].map(row => [row.id, row]));
    const urlsByTask = new Map();
    for (const row of facts.values()) if (["published", "verified"].includes(row.status) && row.pageUrl) urlsByTask.set(row.taskId, row.pageUrl);
    const daily = new Map(Object.keys(policy.dailyCaps).map(key => [key, new Set()]));
    const weeklyLandings = new Set();
    const add = (task, date, fallbackUrl) => {
      const type = category(task); if (!type) return;
      const url = fallbackUrl || urlsByTask.get(task.id) || task.pageUrl;
      const key = ["cluster_landing", "optimization", "refresh"].includes(type) && url ? url : "task:" + task.id;
      if (date === day) daily.get(type).add(key);
      if (type === "cluster_landing" && date >= week.start && date <= week.end) weeklyLandings.add(key);
    };
    for (const row of facts.values()) {
      if (!["published", "verified"].includes(row.status) || ["translation", "backfill_translation"].includes(row.kind)) continue;
      const task = tasks.get(row.taskId);
      // A correction to a blog is optimization work, not another source article.
      if (!task || (row.kind === "optimization" && task.kind === "blog") || !Number.isFinite(Date.parse(row.publishedAt))) continue;
      add(task, dayFormat.format(new Date(row.publishedAt)), row.pageUrl);
    }
    for (const row of value.tasks) {
      if (row.state === "REJECTED") continue;
      const task = tasks.get(row.taskId) ?? row.taskIdentity;
      if (task) add(task, row.date, row.pageUrl);
    }
    return { day, week, daily, weeklyLandings, urlsByTask };
  }
  function inspect(task, snapshot, now = new Date(), stored, verifiedRuntime) {
    if (!isGuarded(task)) return { allowed: true, guarded: false };
    const row = members.get(hash(task.id));
    try {
      stored ??= ledger();
      const { baseline } = verifiedRuntime ?? runtime();
      if (!identityMatches(task, row)) throw Error("recovery_original_identity_changed");
      if (!isSeoWorkday(now) || now < new Date(row.proposedStartOrResume)) throw Error("recovery_before_original_resume_window");
      if (!dispatchWindow(now, policy)) throw Error("recovery_outside_original_dispatch_window");
      const type = category(task), counts = usage(stored, baseline, snapshot, now);
      const existing = stored.tasks.find(item => item.taskId === task.id && item.date === counts.day && item.category === type);
      if (existing?.state === "UNKNOWN" || existing?.state === "RESERVED") throw Error("recovery_original_claim_needs_reconciliation");
      if (existing && existing.state !== "REJECTED") return { allowed: true, guarded: true, reused: true, category: type, date: counts.day, key: existing.key,
        dailyUsed: counts.daily.get(type).size, weeklyLandingsUsed: counts.weeklyLandings.size };
      const key = ["cluster_landing", "optimization", "refresh"].includes(type) && (counts.urlsByTask.get(task.id) || task.pageUrl) || "task:" + task.id;
      if (!counts.daily.get(type).has(key) && counts.daily.get(type).size >= policy.dailyCaps[type]) throw Error("recovery_daily_type_capacity_used");
      if (type === "cluster_landing" && !counts.weeklyLandings.has(key) && counts.weeklyLandings.size >= policy.landingBusinessWeekCap) throw Error("recovery_business_week_landing_capacity_used");
      return { allowed: true, guarded: true, category: type, date: counts.day, key: hash(JSON.stringify([policy.batchId, counts.day, type, task.id])),
        dailyUsed: counts.daily.get(type).size, weeklyLandingsUsed: counts.weeklyLandings.size };
    } catch (error) { return { allowed: false, guarded: true, reason: error.message }; }
  }
  function filter(result, snapshot, now = new Date()) {
    if (!result.candidates.some(candidate => isGuarded(candidate.task))) return result;
    let stored, verifiedRuntime;
    try { stored = ledger(); verifiedRuntime = runtime(); }
    catch (error) {
      return { ...result, candidates: result.candidates.filter(candidate => !isGuarded(candidate.task)),
        recoveryExcluded: result.candidates.filter(candidate => isGuarded(candidate.task)).map(candidate => ({ taskId: candidate.task.id, reason: error.message })) };
    }
    const excluded = [];
    const candidates = result.candidates.filter(candidate => {
      const decision = inspect(candidate.task, snapshot, now, stored, verifiedRuntime);
      if (!decision.allowed) excluded.push({ taskId: candidate.task.id, reason: decision.reason });
      return decision.allowed;
    });
    return { ...result, candidates, ...(excluded.length ? { recoveryExcluded: excluded } : {}) };
  }
  function reserve(task, snapshot, claim, now = new Date()) {
    if (isExtra(task) || !category(task) || ["published", "verified", "observing"].includes(task.status)) return null;
    // Unlisted ordinary claims are observed for shared usage only. They retain
    // all original eligibility; this batch never puts them under HOLD/windows.
    if (!isGuarded(task)) {
      try { runtime(); } catch { return null; }
    }
    const record = () => withLedger(value => {
      const decision = inspect(task, snapshot, now, value);
      if (!decision.allowed) throw Error(decision.reason);
      const date = dayFormat.format(now), type = category(task);
      const existing = value.tasks.find(row => row.taskId === task.id && row.date === date && row.category === type);
      if (existing && existing.state !== "REJECTED") return { key: existing.key, reused: true };
      const key = hash(JSON.stringify([policy.batchId, date, type, task.id]));
      const record = { key, taskId: task.id, category: type, date, state: "RESERVED", observedAt: now.toISOString(), runId: claim.runId, owner: claim.owner,
        taskIdentity: { id: task.id, kind: task.kind, siteDomain: task.siteDomain, workClass: task.workClass, capacityClass: task.capacityClass }, pageUrl: task.pageUrl ?? null };
      value.tasks = value.tasks.filter(row => row.key !== key); value.tasks.push(record);
      return { key, reused: false };
    });
    if (isGuarded(task)) return record();
    try { return record(); } catch { return null; }
  }
  function claimReceipt(reservation, response, now = new Date()) {
    if (!reservation) return;
    return withLedger(value => {
      const row = value.tasks.find(item => item.key === reservation.key);
      if (!row || response.runId !== row.runId) throw Error("recovery_claim_receipt_mismatch");
      if (response.acquired === true && (!Number.isInteger(response.fencingToken) || response.fencingToken < 1)) throw Error("recovery_claim_receipt_invalid");
      if (response.acquired !== true && !["leased", "completed"].includes(response.reason)) throw Error("recovery_claim_receipt_invalid");
      row.state = response.acquired ? "ACQUIRED" : response.reason === "leased" ? "EXISTING_LEASE" : "EXISTING_COMPLETION";
      row.receipt = response; row.receivedAt = now.toISOString();
      return row;
    });
  }
  function unknown(reservation, now = new Date()) {
    if (!reservation) return;
    withLedger(value => { const row = value.tasks.find(item => item.key === reservation.key); if (row) { row.state = "UNKNOWN"; row.unknownAt = now.toISOString(); } });
  }
  function once(action, entrypoint, owner, receipt, now = new Date()) {
    if (!policy.catchupEntrypoints.includes(entrypoint)) throw Error("recovery_catchup_scope_not_authorized");
    runtime();
    if (dayFormat.format(now) !== policy.catchupExecutionDate) throw Error("recovery_catchup_outside_approved_day");
    if (typeof owner !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(owner)) throw Error("recovery_catchup_owner_required");
    return withLedger(value => {
      const key = `${policy.catchupSourceDate}:${entrypoint}`;
      let row = value.scopes.find(item => item.key === key);
      if (action === "claim") {
        if (row) return { acquired: false, reason: row.status === "completed" ? "completed" : "original_scope_exists", original: row };
        row = { key, entrypoint, owner, sourceDate: policy.catchupSourceDate, status: "started", startedAt: now.toISOString() }; value.scopes.push(row);
        return { acquired: true, original: row };
      }
      if (action !== "receipt" || !row || row.owner !== owner || row.status === "completed") throw Error("recovery_original_scope_receipt_conflict");
      if (!receipt || !["partial", "completed"].includes(receipt.status) || !Array.isArray(receipt.evidence) || !receipt.evidence.length
        || typeof receipt.observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.observedAt)
        || !Number.isFinite(Date.parse(receipt.observedAt)) || Date.parse(receipt.observedAt) > now.getTime()) throw Error("recovery_original_scope_receipt_invalid");
      for (const item of receipt.evidence) evidenceFile(item);
      row.status = receipt.status; row.receipts = [...(row.receipts ?? []), { ...receipt, recordedAt: now.toISOString() }];
      return { stored: true, original: row };
    });
  }
  return { runtimeFile, ledgerFile, inspect, filter, reserve, claimReceipt, unknown, once,
    status: () => ({ batchId: policy.batchId, runtime: readJson(runtimeFile)?.state ?? "MISSING", ledger: ledger() }) };
}

module.exports = { createRecoveryGuard, manifest, category, businessWeek, identityMatches, guarded, dispatchWindow };
