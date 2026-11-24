const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, test } = require("node:test");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "seo-codex-progress-"));
process.env.SEO_CODEX_PROGRESS_DIR = directory;
process.env.SEO_IMPORT_TOKEN = "local-test-token";
const { bind, makeCheckpoint, hook, flush } = require("../scripts/seo-codex-progress.cjs");
after(() => fs.rmSync(directory, { recursive: true, force: true }));

test("a checkpoint survives a failed archive flush and is retried against the original task", async t => {
  const binding = bind("task-42", "work", "existing-session");
  assert.throws(() => bind("task-42", "work", "second-session"), /resume_bound_session:existing-session/);
  assert.throws(() => makeCheckpoint(binding, { summary: "accepted", evidence: [] }), /requires_evidence/);
  const payload = { summary: "Browser preview checked", nextAction: "Use the existing branch",
    evidence: [{ label: "Preview checks", artifact: "qa:preview-model-list" }] };
  const checkpoint = makeCheckpoint(binding, payload);
  assert.equal(checkpoint.id, makeCheckpoint(binding, { ...payload, observedAt: "2026-11-15T12:00:00Z" }).id);
  const pending = path.join(directory, "outbox", checkpoint.id + ".json");
  fs.mkdirSync(path.dirname(pending), { recursive: true });
  fs.writeFileSync(pending, JSON.stringify({ ...binding, checkpoint }));

  const unavailable = t.mock.method(globalThis, "fetch", async () => { throw Error("offline"); });
  const archive = { hook_event_name: "SessionEnd", session_id: binding.sessionId };
  assert.match((await hook(archive)).systemMessage, /待同步/);
  assert.equal(fs.existsSync(pending), true);
  unavailable.mock.restore();

  let version = 4;
  let saved;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (options.method === "GET") {
      assert.match(url, /taskId=task-42$/);
      return Response.json({ storage: "database", task: { id: "task-42", status: "drafting", version, progress: saved ? [checkpoint] : [] } });
    }
    const body = JSON.parse(options.body);
    assert.equal(body.record.id, "task-42");
    assert.equal(body.record.status, "drafting");
    if (version === 4) {
      version++;
      return Response.json({ code: "version_conflict" }, { status: 409 });
    }
    assert.equal(body.expectedVersion, version);
    saved = body.record.progress[0];
    return Response.json({ storage: "database", stored: true, record: { progress: [saved] } });
  });
  assert.deepEqual(await flush(null, 2000), { synced: 1, pending: 0 });
  assert.equal(saved.id, checkpoint.id);
  assert.equal(fs.existsSync(pending), false);
});

test("dispatch forwards only the bound original resume identity to the lease scanner", () => {
  bind("resume-task", "work", "resume-session");
  const scanner = path.join(directory, "argument-only-scanner.cjs");
  fs.writeFileSync(scanner, 'console.log(JSON.stringify(process.argv.slice(2)));');
  fs.writeFileSync(path.join(directory, "settings.json"), JSON.stringify({ scanner }));
  const cli = path.resolve(__dirname, "../scripts/seo-codex-progress.cjs");
  const invoke = (...args) => spawnSync(process.execPath, [cli, "--dispatch", "refresh", "resume-task", "original-owner", ...args], { env: process.env, encoding: "utf8" });
  const valid = invoke("--resume-session=resume-session");
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout), ["refresh", "resume-task", "original-owner", "--resume-session=resume-session"]);
  const unbound = invoke("--resume-session=other-session");
  assert.equal(unbound.status, 1); assert.match(unbound.stderr, /resume_session_not_bound/);
  const alreadyBound = invoke();
  assert.equal(alreadyBound.status, 0); assert.equal(JSON.parse(alreadyBound.stdout).reason, "existing_codex_session");
});
