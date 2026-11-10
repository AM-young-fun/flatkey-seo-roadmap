const assert = require("node:assert/strict"), { test, beforeEach, afterEach } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
let leases, receipts, time, locks, transactionQueue;
const tx = {
  $executeRaw: async () => { locks++; }, $queryRaw: async () => [{ now: new Date(time) }],
  seoWorkflowRecord: { findUnique: async ({ where }) => receipts.get(where.key) ?? null },
  seoWorkflowLease: {
    findUnique: async ({ where }) => where.runId ? leases.get(where.runId) ?? null : [...leases.values()].find(row => row.stage === where.stage_scheduledFor.stage && row.scheduledFor.getTime() === where.stage_scheduledFor.scheduledFor.getTime()) ?? null,
    upsert: async ({ where, create, update }) => { const previous = leases.get(where.runId); const next = previous ? { ...previous, ...update, fencingToken: previous.fencingToken + update.fencingToken.increment } : { ...create, status: "running" }; leases.set(where.runId, next); return next; },
    update: async ({ where, data }) => { const next = { ...leases.get(where.runId), ...data }; leases.set(where.runId, next); return next; },
  },
};
const filename = path.join(root, "src/lib/prisma.ts"); require.cache[filename] = { id: filename, filename, loaded: true, exports: { prisma: { $transaction: callback => { const next = transactionQueue.then(() => callback(tx)); transactionQueue = next.catch(() => {}); return next; } } } };
const { mutateWorkflowClaim } = require("../src/lib/services/seo-workflow.ts");
const saved = process.env.DATABASE_URL;
beforeEach(() => { leases = new Map(); receipts = new Map(); time = Date.parse("2026-11-10T01:00:00Z"); locks = 0; transactionQueue = Promise.resolve(); process.env.DATABASE_URL = "postgresql://test.invalid/not-used"; });
afterEach(() => { if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved; });
const command = patch => ({ action: "claim", runId: "RESEARCH-2026-11-10", stage: "RESEARCH", scheduledFor: "2026-11-10T01:00:00Z", owner: "worker-a", leaseSeconds: 30, ...patch });
const evidence = [{ label: "run receipt", artifact: "/tmp/run.json", observedAt: "2026-11-10T01:00:00Z" }];

test("two workers requesting a stage receive one lease and no duplicate stage ID", async () => {
  const results = await Promise.all([mutateWorkflowClaim(command()), mutateWorkflowClaim(command({ owner: "worker-b" }))]);
  assert.equal(results.filter(row => row.acquired).length, 1); assert.equal(results[1].reason, "leased"); assert.equal(locks, 2);
  await assert.rejects(mutateWorkflowClaim(command({ runId: "duplicate-run" })), /已有运行编号/);
});
test("expired lease is fenced on takeover and stale worker cannot renew or complete", async () => {
  const first = await mutateWorkflowClaim(command()); time += 31_000;
  const second = await mutateWorkflowClaim(command({ owner: "worker-b" })); assert.equal(second.fencingToken, first.fencingToken + 1);
  await assert.rejects(mutateWorkflowClaim(command({ action: "renew", fencingToken: first.fencingToken })), /租约已失效/);
  await assert.rejects(mutateWorkflowClaim(command({ action: "complete", fencingToken: first.fencingToken, status: "completed", evidence })), /租约已失效/);
});
test("completion requires matching persisted run receipt and prevents reacquisition", async () => {
  const first = await mutateWorkflowClaim(command());
  await assert.rejects(mutateWorkflowClaim(command({ action: "complete", fencingToken: first.fencingToken, status: "completed", evidence })), /先保存/);
  receipts.set("run:RESEARCH-2026-11-10", { status: "completed", payload: { stage: "RESEARCH", scheduledFor: "2026-11-10T01:00:00Z" } });
  const done = await mutateWorkflowClaim(command({ action: "complete", fencingToken: first.fencingToken, status: "completed", evidence })); assert.equal(done.status, "completed");
  time += 60_000; assert.equal((await mutateWorkflowClaim(command())).reason, "completed");
});
test("renewal uses database clock and preserves token while run identity cannot change", async () => {
  const first = await mutateWorkflowClaim(command()); time += 10_000;
  const renewed = await mutateWorkflowClaim(command({ action: "renew", fencingToken: first.fencingToken })); assert.equal(renewed.fencingToken, first.fencingToken); assert.equal(renewed.leaseUntil, "2026-11-10T01:00:40.000Z");
  await assert.rejects(mutateWorkflowClaim(command({ stage: "PUBLISH" })), /不能改换/);
});
