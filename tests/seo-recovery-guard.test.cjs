const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { createHash } = require("node:crypto");
const { createRecoveryGuard, manifest: shippedManifest, category, businessWeek } = require("../scripts/lib/seo-recovery-guard.cjs");
const at = value => new Date(value + "+08:00");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
// Public tests use synthetic tasks, never the user's unpublished content plan.
const syntheticRows = [];
for (const [count, kind, site, prefix, dates] of [
  [15, "blog", "flatkey.ai", "source", [25,25,25,25,25,26,26,26,26,26,27,27,27,27,27]],
  [3, "blog", "modelfit.cc", "model", [25,26,27]],
  [5, "optimization", "flatkey.ai", "opt", [25,25,26,26,27]],
  [5, "landing", "rackrate.org", "page", [25,25,26,26,27]],
]) for (let index = 0; index < count; index++) {
  const date = dates[index], clock = kind === "blog" ? "11:15:00" : kind === "optimization" ? "10:15:00" : "14:15:00";
  syntheticRows.push({taskId:`test-original-${prefix}-${index}`,kind,siteDomain:site,country:"US",language:"en",keyword:`test query ${prefix} ${index}`,originalDueAt:"2026-11-24T10:00:00+08:00",originalWeekStart:"2026-11-23",proposedStartOrResume:`2026-11-${date}T${clock}+08:00`,disposition:date===27?"ORIGINAL_ROUTINE_CAPACITY_CONFLICT":"ORIGINAL_ROUTINE_WINDOW"});
}
const manifest = {...shippedManifest,batchId:"test-only-recovery",members:syntheticRows};
const testPolicy = {...manifest,members:syntheticRows.map(row=>({taskIdSha256:digest(row.taskId),identitySha256:digest(JSON.stringify([row.taskId,row.kind,row.siteDomain,row.country,row.language,row.keyword,row.originalDueAt,row.originalWeekStart])),proposedStartOrResume:row.proposedStartOrResume,disposition:row.disposition}))};

const task = (row, patch = {}) => ({ id: row.taskId, kind: row.kind, siteDomain: row.siteDomain, country: row.country, language: row.language,
  keyword: row.keyword, dueAt: row.originalDueAt, weekStart: row.originalWeekStart, status: "ready", pageUrl: null, dependencies: [], ...patch });
const snapshot = tasks => ({ tasks, publications: [] });
const blogRows = manifest.members.filter(row => row.kind === "blog" && row.siteDomain === "flatkey.ai");
const first = task(blogRows.find(row => row.proposedStartOrResume.startsWith("2026-11-25")));
function fixture(t, baselinePatch = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seo-recovery-guard-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeFile = path.join(root, manifest.runtimeRelativePath); fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
  const proof = path.join(root, "test-only-proof.json"), proofText = JSON.stringify({ testFixture: true }); fs.writeFileSync(proof, proofText);
  const reference = { artifact: proof, sha256: digest(proofText) };
  const baseline = { storage: "database", generatedAt: "2026-11-24T11:13:46.009Z", tasks: manifest.members.map(row => task(row)), publications: [], ...baselinePatch };
  const baselineFile = path.join(root, "test-only-workflow.json"); fs.writeFileSync(baselineFile, JSON.stringify(baseline));
  const ready = { version: 1, state: "READY", approvedWordListSha256: manifest.approvedWordListSha256,
    actualPrerequisiteReceipts: Object.fromEntries(["member1600", "wordLanguageAndMarketIdentity1600", "quarterPlanningSaveApproveFreeze", "internalLoopAcceptance", "originalTaskArrangementProductionReadback", "automationRestore13Readback"].map(key => [key, reference])),
    usageBaseline: { artifact: baselineFile, sha256: digest(fs.readFileSync(baselineFile)) } };
  fs.writeFileSync(runtimeFile, JSON.stringify(ready)); fs.writeFileSync(path.join(root,"test-only-policy.json"), JSON.stringify(testPolicy));
  return { root, ready, runtimeFile, baseline, reference, guard: createRecoveryGuard(root, testPolicy),
    writeRuntime: value => fs.writeFileSync(runtimeFile, JSON.stringify(value)) };
}
function acquired(guard, reservation, runId) { guard.claimReceipt(reservation, { acquired: true, runId, fencingToken: 1, status: "running" }); }

test("the shipped recovery whitelist contains exactly 28 one-way identities without publishing the content plan", () => {
  assert.equal(shippedManifest.members.length, 28);
  assert.equal(new Set(shippedManifest.members.map(row => row.taskIdSha256)).size, 28);
  assert.equal(shippedManifest.members.filter(row => row.disposition.includes("CAPACITY_CONFLICT")).length, 8);
  for (const row of shippedManifest.members) {
    assert.match(row.taskIdSha256, /^[a-f0-9]{64}$/); assert.match(row.identitySha256, /^[a-f0-9]{64}$/);
    for (const privateKey of ["taskId","keyword","country","language","siteDomain","originalDueAt"]) assert.equal(Object.hasOwn(row, privateKey), false);
  }
});
test("HOLD and missing receipts exclude only the batch, leaving extra, technical, data and post-publication review alone", t => {
  const f = fixture(t), extra = { ...first, capacityClass: "authorized_hotspot_extra" }, other = { ...first, id: "independent-original" }, technical = { ...first, id: "technical-original", kind: "technical" };
  f.writeRuntime({ ...f.ready, state: "HOLD" });
  const value = { candidates: [first, extra, other, technical].map(task => ({ task })) };
  const result = f.guard.filter(value, snapshot([first]), at("2026-11-25T11:45:00"));
  assert.deepEqual(result.candidates.map(row => row.task), [extra, other, technical]);
  assert.equal(result.recoveryExcluded[0].reason, "recovery_hold");
  assert.equal(f.guard.inspect({ ...first, status: "published" }, snapshot([])).guarded, false);
  f.writeRuntime({ ...f.ready, actualPrerequisiteReceipts: {} });
  assert.equal(f.guard.inspect(first, snapshot([first]), at("2026-11-25T11:45:00")).reason, "recovery_receipt_reference_missing");
  assert.equal(category({ kind: "prompt", siteDomain: "flatkey.ai" }), null);
});
test("runtime evidence bytes and baseline provenance are verified, not accepted from a READY label alone", t => {
  const f = fixture(t); fs.appendFileSync(f.reference.artifact, "changed");
  assert.equal(f.guard.inspect(first, snapshot([first]), at("2026-11-25T11:45:00")).reason, "recovery_receipt_hash_changed");
});
test("original due, country-language, keyword and identity stay unchanged and cannot manufacture an earlier slot", t => {
  const f = fixture(t), before = structuredClone(first);
  assert.equal(f.guard.inspect(first, snapshot([first]), at("2026-11-25T11:14:59")).allowed, false);
  assert.equal(f.guard.inspect(first, snapshot([first]), at("2026-11-25T11:15:00")).allowed, true);
  for (const patch of [{ dueAt: "2026-11-25T11:00:00+08:00" }, { country: "JP" }, { language: "ja" }, { keyword: "different original" }, { weekStart: "2026-11-16" }]) {
    assert.equal(f.guard.inspect({ ...first, ...patch }, snapshot([]), at("2026-11-25T11:45:00")).reason, "recovery_original_identity_changed");
  }
  assert.equal(f.guard.inspect({ ...first, version: 999 }, snapshot([]), at("2026-11-25T11:45:00")).allowed, true);
  assert.deepEqual(first, before);
});
test("the eight capacity conflicts cannot run Thursday, resume Friday, and weekends never become new production time", t => {
  const f = fixture(t), carry = task(manifest.members.find(row => row.disposition.includes("CAPACITY_CONFLICT")));
  assert.equal(f.guard.inspect(carry, snapshot([]), at("2026-11-26T18:15:00")).reason, "recovery_before_original_resume_window");
  assert.equal(f.guard.inspect(carry, snapshot([]), at("2026-11-27T18:15:00")).allowed, true);
  assert.equal(f.guard.inspect(carry, snapshot([]), at("2026-11-28T18:15:00")).allowed, false);
  assert.equal(carry.dueAt, manifest.members.find(row => row.taskId === carry.id).originalDueAt);
  assert.equal(f.guard.inspect(carry, snapshot([]), at("2026-11-27T19:15:00")).reason, "recovery_outside_original_dispatch_window");
  assert.equal(f.guard.inspect(carry, snapshot([]), at("2026-11-27T13:30:00")).reason, "recovery_outside_original_dispatch_window");
});
test("one original started or resumed per date is one unit; seven hourly triggers cannot acquire six Flatkey source slots", t => {
  const f = fixture(t), eligible = blogRows.slice(0, 6).map(row => task(row)), now = at("2026-11-27T18:15:00");
  for (const [index, item] of eligible.slice(0, 5).entries()) {
    const reservation = f.guard.reserve(item, snapshot(eligible), { runId: "original-" + index, owner: "same-session" }, now);
    acquired(f.guard, reservation, "original-" + index);
    const again = f.guard.reserve(item, snapshot(eligible), { runId: "original-" + index, owner: "same-session" }, now);
    assert.equal(again.reused, true);
  }
  assert.equal(f.guard.status().ledger.tasks.length, 5);
  assert.equal(f.guard.inspect(eligible[5], snapshot(eligible), now).reason, "recovery_daily_type_capacity_used");
  assert.equal(fs.statSync(f.guard.ledgerFile).mode & 0o077, 0);
});
test("unknown claims remain reserved until their actual original receipt, without issuing another claim or freeing capacity", t => {
  const f = fixture(t), now = at("2026-11-25T11:45:00"), before = structuredClone(first);
  const reservation = f.guard.reserve(first, snapshot([first]), { runId: "original-run", owner: "original-owner" }, now);
  f.guard.unknown(reservation, now);
  assert.equal(f.guard.inspect(first, snapshot([first]), now).reason, "recovery_original_claim_needs_reconciliation");
  assert.throws(() => f.guard.claimReceipt(reservation, { acquired: true, runId: "replacement-run", fencingToken: 1 }), /receipt_mismatch/);
  acquired(f.guard, reservation, "original-run");
  assert.equal(f.guard.inspect(first, snapshot([first]), now).reused, true);
  // An older known receipt cannot hide a later uncertain lease attempt.
  f.guard.unknown(reservation, now);
  assert.equal(f.guard.inspect(first, snapshot([first]), now).reason, "recovery_original_claim_needs_reconciliation");
  f.guard.claimReceipt(reservation, { acquired: false, runId: "original-run", reason: "leased", leaseUntil: "2026-11-25T04:00:00Z" }, now);
  assert.equal(f.guard.inspect(first, snapshot([first]), now).reused, true);
  assert.deepEqual(first, before);
});
test("normal unlisted claims supply actual shared usage but are not put under the recovery HOLD/window policy", t => {
  const f = fixture(t), now = at("2026-11-25T11:45:00");
  for (let index = 0; index < 5; index++) {
    const other = { ...first, id: "other-original-" + index };
    const reservation = f.guard.reserve(other, snapshot([]), { runId: "other-run-" + index, owner: "other-original" }, now);
    acquired(f.guard, reservation, "other-run-" + index);
  }
  assert.equal(f.guard.inspect(first, snapshot([first]), now).reason, "recovery_daily_type_capacity_used");
  f.writeRuntime({ ...f.ready, state: "HOLD" });
  assert.equal(f.guard.inspect({ ...first, id: "unlisted" }, snapshot([]), now).allowed, true);
});
test("GGUF two real versions use one actual landing; all three existing unique pages constrain the same Friday-Thursday seven", t => {
  const existingTasks = [0, 1, 2].map(index => ({ id: "built-" + index, kind: "landing", siteDomain: "modelfit.cc", status: "verified" }));
  const publications = [0, 0, 1, 2].map((index, i) => ({ id: "version-" + i, taskId: "built-" + index, kind: "landing", status: "verified", pageUrl: "https://modelfit.cc/page/" + index, publishedAt: "2026-11-23T03:00:00Z" }));
  const f = fixture(t, { tasks: [...manifest.members.map(row => task(row)), ...existingTasks], publications });
  const landing = task(manifest.members.find(row => row.kind === "landing"));
  const decision = f.guard.inspect(landing, snapshot([landing]), at("2026-11-25T15:15:00"));
  assert.equal(decision.allowed, true); assert.equal(decision.weeklyLandingsUsed, 3);
  assert.deepEqual(businessWeek("2026-11-26"), { start: "2026-11-20", end: "2026-11-26" });
  assert.deepEqual(businessWeek("2026-11-27"), { start: "2026-11-27", end: "2026-12-03" });
});
test("a landing needs both daily and full business-week room, not merely a fresh local ledger", t => {
  const existingTasks = Array.from({ length: 7 }, (_, i) => ({ id: "built-" + i, kind: "landing", siteDomain: "rackrate.org" }));
  const publications = existingTasks.map((row, i) => ({ id: "pub-" + i, taskId: row.id, kind: "landing", status: "verified", pageUrl: "https://rackrate.org/p/" + i, publishedAt: "2026-11-23T03:00:00Z" }));
  const f = fixture(t, { tasks: [...manifest.members.map(row => task(row)), ...existingTasks], publications });
  const landing = task(manifest.members.find(row => row.kind === "landing"));
  assert.equal(f.guard.inspect(landing, snapshot([landing]), at("2026-11-25T15:15:00")).reason, "recovery_business_week_landing_capacity_used");
});
test("ordinary optimization, two-site refresh, ModelFit source and landings are separate actual daily capacities", t => {
  const f = fixture(t), now = at("2026-11-27T18:15:00");
  const modelRows = manifest.members.filter(row => row.kind === "blog" && row.siteDomain === "modelfit.cc");
  const ordinary = manifest.members.filter(row => row.kind === "optimization").slice(0, 3).map(row => task(row));
  const model = modelRows.slice(0, 2).map(row => task(row));
  const firstModel = f.guard.reserve(model[0], snapshot(model), { runId: "model-original", owner: "owner" }, now); acquired(f.guard, firstModel, "model-original");
  assert.equal(f.guard.inspect(model[1], snapshot(model), now).reason, "recovery_daily_type_capacity_used");
  ordinary.slice(0, 2).forEach((item, i) => { const r = f.guard.reserve(item, snapshot(ordinary), { runId: "opt-" + i, owner: "owner" }, now); acquired(f.guard, r, "opt-" + i); });
  assert.equal(f.guard.inspect(ordinary[2], snapshot(ordinary), now).reason, "recovery_daily_type_capacity_used");
  assert.equal(category({ ...ordinary[0], workClass: "content_refresh" }), "refresh");
  assert.equal(category({ kind: "optimization", workClass: "content_refresh", siteDomain: "modelfit.cc" }), "refresh");
});
test("corrupt ledger fails closed for the whitelist while independent work is still untouched", t => {
  const f = fixture(t); fs.mkdirSync(path.dirname(f.guard.ledgerFile), { recursive: true }); fs.writeFileSync(f.guard.ledgerFile, "{}");
  const other = { ...first, id: "independent" }, value = { candidates: [first, other].map(task => ({ task })) };
  const result = f.guard.filter(value, snapshot([first, other]), at("2026-11-25T11:45:00"));
  assert.deepEqual(result.candidates.map(row => row.task.id), [other.id]); assert.equal(result.recoveryExcluded[0].reason, "recovery_ledger_invalid");
});
test("parallel workers share the same atomic type budget instead of each seeing five free slots", async t => {
  const { spawn } = require("node:child_process");
  const f = fixture(t), eligible = blogRows.slice(0, 6).map(row => task(row));
  const input = path.join(f.root, "workers-test-input.json"); fs.writeFileSync(input, JSON.stringify(eligible));
  const library = path.resolve(__dirname, "../scripts/lib/seo-recovery-guard.cjs");
  const program = `const fs=require('node:fs'); const {createRecoveryGuard}=require(${JSON.stringify(library)}); const tasks=JSON.parse(fs.readFileSync(process.argv[2])); const index=+process.argv[3]; try{createRecoveryGuard(process.argv[1],JSON.parse(fs.readFileSync(require('node:path').join(process.argv[1],'test-only-policy.json')))).reserve(tasks[index],{tasks,publications:[]},{runId:'original-'+index,owner:'worker-'+index},new Date('2026-11-27T18:15:00+08:00')); process.stdout.write('reserved');}catch(error){process.stdout.write(error.message);}`;
  const outcomes = await Promise.all(eligible.map((_, index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", program, f.root, input, String(index)]); let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(stdout) : reject(Error(stderr)));
  })));
  assert.ok(outcomes.every(value => ["reserved", "recovery_ledger_busy", "recovery_daily_type_capacity_used"].includes(value)), outcomes.join(","));
  assert.ok(f.guard.status().ledger.tasks.length > 0);
  assert.ok(f.guard.status().ledger.tasks.length <= 5);
});
test("the once ledger has exactly the authorized missed scopes/day; only actual hashed receipts can complete them", t => {
  const f = fixture(t), now = at("2026-11-25T10:30:00");
  assert.throws(() => f.guard.once("claim", "seo-10-00-2", "owner", null, now), /not_authorized/);
  assert.throws(() => f.guard.once("claim", "automation-2", "owner", null, at("2026-11-26T10:30:00")), /outside_approved_day/);
  assert.equal(f.guard.once("claim", "automation-2", "original-owner", null, now).acquired, true);
  assert.equal(f.guard.once("claim", "automation-2", "replacement-owner", null, now).acquired, false);
  assert.throws(() => f.guard.once("receipt", "automation-2", "replacement-owner", { status: "completed" }, now), /receipt_conflict/);
  assert.throws(() => f.guard.once("receipt", "automation-2", "original-owner", { status: "completed", observedAt: now.toISOString(), evidence: [] }, now), /receipt_invalid/);
  assert.equal(f.guard.once("receipt", "automation-2", "original-owner", { status: "partial", observedAt: now.toISOString(), evidence: [f.reference] }, now).stored, true);
  assert.equal(f.guard.once("receipt", "automation-2", "original-owner", { status: "completed", observedAt: now.toISOString(), evidence: [f.reference] }, now).stored, true);
  assert.equal(f.guard.once("claim", "automation-2", "original-owner", null, now).reason, "completed");
});
test("the canonical scanner is the actual dispatch hook, before any work claim and after ordinary eligibility", () => {
  const text = fs.readFileSync(path.join(__dirname, "../scripts/seo-due-tasks.cjs"), "utf8");
  assert.match(text, /recovery\.filter\(dueTasks\(snapshot, scope\), snapshot\)/);
  assert.match(text, /const reservation = recovery\.reserve\(task[\s\S]+let claim;[\s\S]+claim = await request\("\/claims"/);
  assert.match(text, /recovery\.claimReceipt\(reservation, claim\)/);
  assert.match(text, /recovery\.unknown\(reservation\)/);
  assert.match(text, /--resume-session=/);
});
