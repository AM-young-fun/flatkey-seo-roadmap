const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { weeklyActionPlanSchema, writeWeeklyActionPlan, readWeeklyActionPlan, weeklyActionsDirectory } = require("../src/lib/seo-weekly-actions.ts");
const plan = () => ({ periodStart: "2026-10-30", preparedAt: "2026-11-04T03:00:00.000Z", status: "draft", sources: [{ name: "排名记录", date: "2026-10-30" }], actions: [{
  pageUrl: "https://flatkey.ai/zh/models", country: "US", keyword: "model", role: "primary", currentRank: 12, targetRank: null,
  monthlySearchVolume: 1000, estimatedClicks: null, ctrAssumption: null, reason: "现有排名接近首页", action: "核对搜索意图后完善标题和内容",
}] });

test("weekly plan enforces Friday periods, safe pages and a single primary keyword per page/market", () => {
  assert.equal(weeklyActionPlanSchema.safeParse(plan()).success, true);
  assert.equal(weeklyActionPlanSchema.safeParse({ ...plan(), periodStart: "2026-11-02" }).success, false);
  for (const pageUrl of ["https://flatkey.ai.evil.test/", "https://user:secret@flatkey.ai/", "http://flatkey.ai/"]) {
    const row = plan(); row.actions[0].pageUrl = pageUrl; assert.equal(weeklyActionPlanSchema.safeParse(row).success, false);
  }
  const duplicate = plan(); duplicate.actions.push({ ...duplicate.actions[0], keyword: "second" });
  assert.equal(weeklyActionPlanSchema.safeParse(duplicate).success, false);
  duplicate.actions[1].role = "support";
  assert.equal(weeklyActionPlanSchema.safeParse(duplicate).success, true);
});

test("weekly forecast remains empty without evidence and rejects unsupported math or invalid numbers", () => {
  const row = plan(); row.actions[0].estimatedClicks = 100;
  assert.equal(weeklyActionPlanSchema.safeParse(row).success, false);
  row.actions[0].targetRank = 3; row.actions[0].ctrAssumption = .1;
  assert.equal(weeklyActionPlanSchema.safeParse(row).success, true);
  row.actions[0].estimatedClicks = 500;
  assert.equal(weeklyActionPlanSchema.safeParse(row).success, false);
  row.actions[0].estimatedClicks = NaN;
  assert.equal(weeklyActionPlanSchema.safeParse(row).success, false);
});

test("weekly plan archive preserves older versions and reads newest for the selected week", async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "weekly-action-test-"));
  t.after(() => fs.promises.rm(directory, { recursive: true }));
  assert.equal(await readWeeklyActionPlan(directory, "2026-10-30"), null);
  const first = plan(); await writeWeeklyActionPlan(first, directory);
  const next = { ...first, preparedAt: "2026-11-04T04:00:00.000Z", status: "reviewed" }; await writeWeeklyActionPlan(next, directory);
  assert.deepEqual(await readWeeklyActionPlan(directory, "2026-10-30"), next);
  await writeWeeklyActionPlan(first, directory);
  assert.deepEqual(await readWeeklyActionPlan(directory, "latest"), next);
  assert.equal((await fs.promises.readdir(directory)).length, 2);
  await assert.rejects(writeWeeklyActionPlan({ ...first, actions: [{ ...first.actions[0], action: "conflicting evidence" }] }, directory));
  await assert.rejects(readWeeklyActionPlan(directory, "../../secret"));
});

test("production never defaults weekly plan storage to a temporary local directory", () => {
  const previous = process.env.SEO_WEEKLY_ACTIONS_STORE_DIR;
  try {
    delete process.env.SEO_WEEKLY_ACTIONS_STORE_DIR;
    assert.equal(weeklyActionsDirectory(false), null);
    assert.match(weeklyActionsDirectory(true), /\.local[\/]seo-analytics[\/]weekly-actions$/);
    process.env.SEO_WEEKLY_ACTIONS_STORE_DIR = "relative";
    assert.throws(() => weeklyActionsDirectory(false));
  } finally { if (previous === undefined) delete process.env.SEO_WEEKLY_ACTIONS_STORE_DIR; else process.env.SEO_WEEKLY_ACTIONS_STORE_DIR = previous; }
});
