const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { spawnSync } = require("node:child_process");
const script = path.resolve(__dirname, "../scripts/sync-seo-automation-config.py");
const ids = require("../src/lib/data/seo-automation-config.json").verificationScope;
const python = ["python3", "/opt/homebrew/bin/python3"].find(command => spawnSync(command, ["-c", "import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)"], { encoding: "utf8" }).status === 0);
function fixture(t, restored = false) {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), "automation-metadata-"));
 t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
 const source = path.join(directory, "automations"), output = path.join(directory, "observed.json"); fs.mkdirSync(source);
 const before = new Map();
 for (const id of ids) {
  const folder = path.join(source, id); fs.mkdirSync(folder);
  const status = restored && id !== "seo-10-00-2" ? "ACTIVE" : "PAUSED";
  const raw = `id=${JSON.stringify(id)}\nname=${JSON.stringify("Observed " + id)}\nkind="cron"\nstatus=${JSON.stringify(status)}\nrrule="FREQ=DAILY;BYHOUR=10;BYMINUTE=30"\nmodel="observed-model"\nreasoning_effort="low"\nupdated_at=1795500000000\ncwds=["/observed/project"]\nprompt="PRIVATE_PROMPT_NEVER_EXPORT"\nmodel_prompt_sha256="PRIVATE_INTERNAL_HASH_NEVER_EXPORT"\n[target]\ntype="project"\nproject_id="observed-project"\n`;
  fs.writeFileSync(path.join(folder, "automation.toml"), raw);before.set(id, raw);
 }
 return { directory, source, output, before };
}
function run(fixture, mode) { return spawnSync(python, [script, "--automations-dir", fixture.source, "--output", fixture.output, mode], { encoding: "utf8" }); }
const option = { skip: !python && "Python 3.11+ is required for the read-only local metadata synchronizer" };
test("metadata copies actual paused states and original fields without private prompts or job writes", option, t => {
 const f = fixture(t), result = run(f, "--expect-paused");assert.equal(result.status, 0, result.stderr);
 const raw = fs.readFileSync(f.output, "utf8"), data = JSON.parse(raw);
 assert.equal(data.tasks.length, 14);assert.deepEqual(new Set(data.verificationScope), new Set(ids));
 assert.ok(data.tasks.every(task => task.status === "PAUSED"));assert.ok(!data.tasks.some(task => task.id === "seo-09-00-github-traffic"));
 assert.ok(!raw.includes("PRIVATE_"));assert.ok(!raw.includes('"prompt"'));assert.ok(!raw.includes("model_prompt_sha256"));
 for (const task of data.tasks) {
  assert.equal(task.name, "Observed " + task.id);assert.equal(task.model, "observed-model");
  assert.equal(task.rrule, "FREQ=DAILY;BYHOUR=10;BYMINUTE=30");assert.deepEqual(task.target, { type: "project", project_id: "observed-project" });
  assert.deepEqual(task.cwds, ["/observed/project"]);assert.equal(fs.readFileSync(path.join(f.source, task.id, "automation.toml"), "utf8"), f.before.get(task.id));
 }
});
test("future ACTIVE metadata is refused until 13 actual entries are active and retired Friday remains paused", option, t => {
 const f = fixture(t);const result = run(f, "--expect-restored");assert.notEqual(result.status, 0);assert.equal(fs.existsSync(f.output), false);
 const actual = fixture(t, true);assert.equal(run(actual, "--expect-restored").status, 0);
 const rows = JSON.parse(fs.readFileSync(actual.output, "utf8")).tasks;
 assert.equal(rows.filter(row => row.status === "ACTIVE").length, 13);assert.equal(rows.find(row => row.id === "seo-10-00-2").status, "PAUSED");
});
test("a missing original entry, symlink or resurrected GitHub automation cannot produce a verified snapshot", option, t => {
 const absent = fixture(t);fs.unlinkSync(path.join(absent.source, ids[0], "automation.toml"));assert.notEqual(run(absent, "--expect-paused").status, 0);
 const linked = fixture(t);const original = path.join(linked.source, ids[0], "automation.toml"), moved = path.join(linked.directory, "raw.toml");fs.renameSync(original, moved);fs.symlinkSync(moved, original);assert.notEqual(run(linked, "--expect-paused").status, 0);
 const github = fixture(t);fs.mkdirSync(path.join(github.source, "seo-09-00-github-traffic"));fs.writeFileSync(path.join(github.source, "seo-09-00-github-traffic", "automation.toml"), 'id="seo-09-00-github-traffic"');assert.notEqual(run(github, "--expect-paused").status, 0);
});
test("metadata and proof output cannot overwrite automation input or share a destination", option, t => {
 const f = fixture(t), source = path.join(f.source, ids[0], "automation.toml");
 const args = [script, "--automations-dir", f.source, "--output", f.output, "--expect-paused"];
 for (const proof of [source, f.output, path.join(f.source, "private-proof.json")]) {
  const result = spawnSync(python, [...args, "--proof-output", proof], { encoding: "utf8" });
  assert.notEqual(result.status, 0);assert.equal(fs.existsSync(f.output), false);
  assert.equal(fs.readFileSync(source, "utf8"), f.before.get(ids[0]));
 }
});
