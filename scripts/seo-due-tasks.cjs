#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const origin = "https://flatkey-seo-roadmap.vercel.app";
// Same canonical source is also installed under .local/ by a hash-checked copy.
const project = path.resolve(__dirname, "..");
const local = path.join(project, ".local");
const { createRecoveryGuard } = require(path.join(project, "scripts/lib/seo-recovery-guard.cjs"));
const { isSeoWorkday } = require(path.join(project, "scripts/lib/seo-workday.cjs"));
const { dueTasks, scopes, scopesForTask, websiteTaskAllowed } = require(path.join(project, "scripts/lib/seo-task-due.cjs"));
const { publishedResumeReservation: reservePublishedTask } = require(path.join(project, "scripts/lib/seo-task-resume.cjs"));

const acceptance = (task) => {
  const retry = ["blocked", "failed", "review_pending", "approved"].includes(task.status);
  const identity = retry ? JSON.stringify([task.id, task.version]) : task.id;
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  return { runId: "task-claim:" + hash, stage: "TASK_" + hash.toUpperCase(), scheduledFor: task.recordedAt, leaseSeconds: 1800 };
};

function publicationReservation(action, candidate, task) {
  if (!websiteTaskAllowed(task)) throw Error("outside_website_scope");
  const version = action === "release" ? candidate.codeSource.commitSha : candidate.contentVersion;
  const identity = [action, task.id, version, candidate.approvalId];
  const hash = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
  return { runId: action + "-dispatch:" + hash, stage: action.toUpperCase() + "_DISPATCH_" + hash.toUpperCase(),
    scheduledFor: task.recordedAt, leaseSeconds: 1800 };
}

function publishedResumeReservation(scope, task, detail, binding, sessionId) {
  return reservePublishedTask(scope, task, detail, binding, sessionId, acceptance);
}

async function main() {
  const [scope, ...args] = process.argv.slice(2);
  if (!Object.hasOwn(scopes, scope) && !["--renew", "release", "rollback"].includes(scope)) throw Error("unknown_scope");
  const file = JSON.parse(fs.readFileSync(path.join(local, "seo-codex-progress", "settings.json"), "utf8")).tokenFile;
  let token = process.env.SEO_IMPORT_TOKEN?.trim();
  if (!token) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error("insecure_token_file");
    token = fs.readFileSync(file, "utf8").trim();
  }
  const request = async (route, body) => {
    const response = await fetch(origin + "/api/seo/workflow" + route, {
      method: body ? "POST" : "GET",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error", signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json();
    if (!response.ok) throw Error(payload.code ?? ("platform_http_" + response.status));
    return payload;
  };
  const read = async query => {
    const snapshot = await request("?" + query);
    if (snapshot.storage !== "database") throw Error("production_database_unconfirmed");
    return snapshot;
  };
  if (scope === "--renew") {
    const [runId, stage, scheduledFor, owner, fencingToken] = args;
    const renewed = await request("/claims", { runId, stage, scheduledFor, owner, fencingToken: Number(fencingToken), leaseSeconds: 1800, action: "renew" });
    console.log(JSON.stringify(renewed));
    return;
  }
  if (args[0] && !isSeoWorkday(new Date())) throw Error("outside_seo_workday");
  let snapshot = await read("operational=1");
  // Allow this week's existing schedule to run while the platform update rolls out.
  // The old API cannot safely select carried tasks once the week changes.
  if (!Array.isArray(snapshot.workWeek?.reviewOrReleaseTaskIds) && snapshot.weekStart === "2026-11-16") {
    const plan = snapshot.plan;
    const ids = new Set(["scheduled", "reviewed"].includes(plan?.status) ? plan.taskIds : []);
    snapshot = {
      ...snapshot,
      tasks: snapshot.tasks.filter(task => task.source === "human" || ids.has(task.id)),
      workWeek: {
        overdueTaskIds: [],
        reviewOrReleaseTaskIds: snapshot.tasks.filter(task => ["review_pending", "approved"].includes(task.status)).map(task => task.id),
        dependencyStatuses: Object.fromEntries(snapshot.tasks.map(task => [task.id, task.status])),
      },
    };
  }
  if (!Array.isArray(snapshot.workWeek?.reviewOrReleaseTaskIds)) throw Error("operational_worklist_unavailable");
  if (scope === "release" || scope === "rollback") {
    const [taskId, approvalId, version, owner] = args;
    const { candidates } = await read(scope + "Queue=1");
    if (!taskId) {
      console.log(JSON.stringify({ storage: "database", candidates }));
      return;
    }
    const task = snapshot.tasks.find(row => row.id === taskId);
    if (!websiteTaskAllowed(task) || !owner) throw Error("publication_task_not_active");
    const candidate = candidates.find(row => row.taskId === taskId && row.approvalId === approvalId
      && (scope === "release" ? row.codeSource.commitSha : row.contentVersion) === version);
    if (!candidate) throw Error("publication_version_not_ready");
    const base = publicationReservation(scope, candidate, task);
    const claim = await request("/claims", { ...base, owner, action: "claim" });
    console.log(JSON.stringify({ ...base, ...claim, owner }));
    return;
  }
  const recovery = createRecoveryGuard(project);
  const result = recovery.filter(dueTasks(snapshot, scope), snapshot);
  const [taskId, owner] = args;
  if (!taskId) {
    console.log(JSON.stringify({ storage: "database", ...result }));
    return;
  }
  if (!owner) throw Error("lease_owner_required");
  const recoveryBlocked = result.recoveryExcluded?.find(row => row.taskId === taskId);
  if (recoveryBlocked) throw Error(recoveryBlocked.reason);
  let candidate = result.candidates.find(row => row.task.id === taskId);
  let resumedBase;
  const resumeArg = args.find(value => value.startsWith("--resume-session="));
  if (!candidate && resumeArg) {
    const detail = await read("taskId=" + encodeURIComponent(taskId));
    const directory = process.env.SEO_CODEX_PROGRESS_DIR ?? path.join(local, "seo-codex-progress");
    const key = createHash("sha256").update(JSON.stringify([taskId, "work"])).digest("hex");
    let binding;
    try { binding = JSON.parse(fs.readFileSync(path.join(directory, "bindings", key + ".json"), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    resumedBase = publishedResumeReservation(scope, detail.task, detail, binding, resumeArg.slice("--resume-session=".length));
    candidate = { task: detail.task };
  }
  if (!candidate || scopesForTask(candidate.task) !== scope) throw Error("task_not_ready_to_claim");
  const { task } = candidate;
  const base = resumedBase ?? acceptance(task);
  // Reserve one actual original work unit under the same host ledger before
  // asking the normal server lease API. Unknown outcomes remain conservative.
  const reservation = recovery.reserve(task, snapshot, { ...base, owner });
  let claim;
  try {
    claim = await request("/claims", { ...base, owner, action: "claim" });
    recovery.claimReceipt(reservation, claim);
  } catch (error) { recovery.unknown(reservation); throw error; }
  if (!claim.acquired) {
    console.log(JSON.stringify(claim));
    return;
  }
  const lease = { runId: base.runId, owner, fencingToken: claim.fencingToken };
  const target = task.kind === "research" ? "researching" : "drafting";
  if (["ready", "planned"].includes(task.status) && task.status !== target) {
    const { version, updatedAt: _updatedAt, recordedAt: _recordedAt, ...record } = task;
    await request("", { action: "save_task", expectedVersion: version, requestId: "accept:" + base.runId + ":" + version,
      claim: lease, record: { ...record, status: target } });
  }
  console.log(JSON.stringify({ ...base, ...claim, ...lease }));
}

module.exports = { acceptance, dueTasks, publicationReservation, publishedResumeReservation, websiteTaskAllowed };
if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ status: "scan_failed", code: error.message }));
  process.exitCode = 1;
});
