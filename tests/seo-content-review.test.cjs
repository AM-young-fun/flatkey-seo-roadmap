const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { buildReviewPlan, findingKey, applyReviewPlan, hash } = require("../scripts/lib/seo-content-review.cjs");
const { verifySources, workflowApi } = require("../scripts/seo-content-review.cjs");
const { prepareWorkflowMutation } = require("../src/lib/seo-workflow-state.ts");
const now = "2026-11-22T12:00:00Z";
const evidence = { label: "原研究", artifact: "/tmp/original-research.json", observedAt: "2026-11-18T10:00:00Z" };
const fixture = () => ({ schemaVersion: 1, period: { start: "2026-11-12", end: "2026-11-18", timezone: "America/Los_Angeles" },
  sources: [{ id: "weekly-1118", kind: "weekly", artifact: "/tmp/weekly-1118.json", sha256: "a".repeat(64), observedAt: "2026-11-19T10:00:00Z" }],
  findings: [{ problemKey: "low-search-ctr", changeType: "content_refresh", siteDomain: "flatkey.ai", country: "US", language: "en",
    pageUrl: "https://flatkey.ai/blog/gpu-cost", keyword: "gpu cost", keywordId: null, title: "核对GPU成本文章搜索点击下降",
    business: "GPU", pageType: "blog", category: "content", priority: "P2", problem: "本期美国曝光上涨而点击下降，需核对原文章摘要和查询意图。",
    recommendation: "先对照原查询与页面正文补证，再决定是否更新原文章，未验证前不发布。",
    actions: [{ target: "https://flatkey.ai/blog/gpu-cost", change: "核对查询与摘要承接关系", verify: "保存查询、页面版本和可比窗口的核对证据" }],
    acceptanceCriteria: ["补齐同口径查询、原页面版本和具体整改建议"], sourceIds: ["weekly-1118"],
    candidate: { kind: "research", weekStart: "2026-11-23", owner: "SEO/AI", dueAt: "2026-11-23T10:00:00+08:00" } }] });
const snapshot = () => ({ storage: "database", generatedAt: now, tasks: [], issues: [], publications: [] });
const options = manifest => ({ now, verifiedSourceIds: new Set(manifest.sources.map(source => source.id)),
  decisionArtifact: { artifact: "/tmp/review-manifest.json", sha256: hash(manifest), observedAt: now } });
const applyOptions = (manifest, plan, outbox = journal()) => ({ expectedPlanHash: plan.planHash, journal: outbox,
  revalidate: fresh => buildReviewPlan(manifest, fresh, options(manifest)) });
const original = () => ({ id: "original-gpu-refresh", weekStart: "2026-11-16", title: "原人工页面优化", siteDomain: "flatkey.ai", channel: "website",
  kind: "optimization", country: "US", language: "en", business: "GPU", pageType: "blog", keyword: "gpu cost", keywordId: "real-keyword",
  pageUrl: "https://flatkey.ai/blog/gpu-cost", owner: "原负责人", dueAt: "2026-11-20T10:00:00+08:00", status: "researching",
  dependencies: [], evidence: [evidence], nextAction: "沿原任务继续研究", contentVersion: "original-draft-v1", artifactUrl: null,
  acceptanceCriteria: ["保留原人工验收条件"], research: null, approval: null, source: "human", sourceRowId: "original-row", fallbackReason: null, failureReason: null,
  brief: { reason: "根据2026年11月18日的原查询证据核对目标页面的搜索意图。", problem: "原人工问题，不被新结论覆盖", plan: "核对原页面与搜索需求并保留原方案", actions: [{ target: "原页面", change: "核实目标查询", verify: "核对生产证据" }], evidence: [evidence] },
  progress: [{ id: "original-progress", sessionId: "existing-session", observedAt: "2026-11-18T10:00:00Z", summary: "原会话已保存检查点", nextAction: "继续核实", evidence: [evidence] }],
  version: 4, recordedAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z" });

function mockApi(state = snapshot()) {
  let posts = 0;
  const events = [];
  const api = { snapshot: async () => structuredClone(state), history: async (kind, id) => events.filter(row => row.kind === kind && row.record.id === id).map(row => row.record),
    save: async command => {
      posts++;
      const rows = [...state.tasks.map(record => ({ kind: "task", record })), ...state.issues.map(record => ({ kind: "issue", record })),
        ...state.publications.map(record => ({ kind: "publication", record }))];
      const prepared = prepareWorkflowMutation(command, rows, "collector", new Date(now));
      const list = state[prepared.kind === "task" ? "tasks" : "issues"], index = list.findIndex(row => row.id === prepared.record.id);
      if (index < 0) list.push(prepared.record); else list[index] = prepared.record;
      events.push({ kind: prepared.kind, record: structuredClone(prepared.record) });
      return { stored: true, storage: "database", record: prepared.record };
    }, get posts() { return posts; }, state, events };
  return api;
}
function journal() { const records = new Map(); return { records, read: async id => records.get(id), write: async (id, row) => records.set(id, structuredClone(row)) }; }

test("cross-week and keyword/report sources reuse the exact task and issue, never replan", async () => {
  const manifest = fixture(), api = mockApi(), first = buildReviewPlan(manifest, api.state, options(manifest));
  assert.equal(first.canApply, true); assert.equal(first.summary.newCandidates, 1);
  assert.deepEqual(first.commands.map(row => row.action), ["save_task", "save_issue"]);
  const saved = await applyReviewPlan(first, api, applyOptions(manifest, first));
  assert.equal(saved.status, "verified"); assert.equal(api.posts, 2);
  const taskId = api.state.tasks[0].id, issueId = api.state.issues[0].id;
  const next = structuredClone(manifest);
  next.period = { start: "2026-11-19", end: "2026-11-25", timezone: "America/Los_Angeles" };
  next.sources = [{ id: "keywords-next", kind: "keyword", artifact: "/tmp/keywords-next.json", sha256: "b".repeat(64), observedAt: "2026-11-22T11:00:00Z" }];
  next.findings[0].sourceIds = ["keywords-next"]; next.findings[0].candidate.dueAt = "2026-11-24T10:00:00+08:00";
  const second = buildReviewPlan(next, api.state, options(next));
  assert.equal(second.decisions[0].taskId, taskId); assert.equal(second.decisions[0].issueId, issueId);
  const command = second.commands.find(row => row.action === "save_task");
  assert.equal(command.record.dueAt, manifest.findings[0].candidate.dueAt);
  assert.equal(command.record.status, "planned"); assert.equal(command.record.weekStart, "2026-11-23");
  assert.equal(command.record.evidence.length, 4);
  assert.equal(second.summary.newCandidates, 0);
  assert.equal((await applyReviewPlan(second, api, applyOptions(next, second))).status, "verified");
  assert.equal(api.state.tasks.length, 1); assert.equal(api.state.issues.length, 1);
  const replay = buildReviewPlan(next, api.state, options(next));
  assert.equal(replay.commands.length, 0);
});

test("explicit strong original links preserve every task field except appended evidence", () => {
  const manifest = fixture(), state = snapshot(), task = original(); state.tasks.push(task);
  Object.assign(manifest.findings[0], { existingTaskId: task.id, linkReason: "该结论来自原任务对应页面和原词的复盘证据。" });
  const plan = buildReviewPlan(manifest, state, options(manifest));
  assert.equal(plan.canApply, true); assert.equal(plan.summary.newCandidates, 0);
  const command = plan.commands.find(row => row.action === "save_task");
  for (const [key, value] of Object.entries(task)) if (!["evidence", "nextAction", "version", "recordedAt", "updatedAt"].includes(key)) assert.deepEqual(command.record[key], value, key);
  assert.ok(command.record.nextAction.startsWith(task.nextAction)); assert.ok(command.record.nextAction.includes(manifest.findings[0].recommendation));
  assert.equal(command.expectedVersion, 4); assert.equal(command.record.evidence.length, 3);
  const prepared = prepareWorkflowMutation(command, [{ kind: "task", record: task }], "collector", new Date(now));
  assert.equal(prepared.record.version, 5);
  assert.equal(plan.commands[1].record.taskId, task.id);
});

test("same keyword cannot silently merge a different page, problem or change type", () => {
  const manifest = fixture(), state = snapshot(); state.tasks.push(original());
  const held = buildReviewPlan(manifest, state, options(manifest));
  assert.equal(held.canApply, false); assert.match(held.decisions[0].reason, /explicit_original_task_link/); assert.equal(held.commands.length, 0);
  const different = structuredClone(manifest); different.findings[0].changeType = "measurement_review"; different.findings[0].category = "data";
  assert.notEqual(findingKey(different.findings[0]), findingKey(manifest.findings[0]));
  const planned = buildReviewPlan(different, state, options(different));
  assert.equal(planned.summary.newCandidates, 1); assert.notEqual(planned.decisions[0].taskId, state.tasks[0].id);
});

test("ambiguous original links block with no partial commands", () => {
  const manifest = fixture(), state = snapshot(), a = original(), b = { ...original(), id: "second-original", sourceRowId: findingKey(manifest.findings[0]) };
  state.tasks.push(a, b);
  Object.assign(manifest.findings[0], { existingTaskId: a.id, linkReason: "根据生产原任务和来源回执核对了对应关系。" });
  const plan = buildReviewPlan(manifest, state, options(manifest));
  assert.equal(plan.canApply, false); assert.match(plan.decisions[0].reason, /multiple_original/); assert.equal(plan.commands.length, 0);
});

test("an exact legacy issue adopts its genuine task instead of creating a duplicate pair", () => {
  const manifest = fixture(), state = snapshot(), task = original(), finding = manifest.findings[0]; state.tasks.push(task);
  state.issues.push({ id: "legacy-issue", weekStart: task.weekStart, siteDomain: task.siteDomain, pageUrl: task.pageUrl,
    title: finding.title, category: finding.category, priority: "P1", status: "investigating", owner: task.owner, taskId: task.id,
    firstSeenAt: evidence.observedAt, impact: finding.problem, nextAction: finding.recommendation,
    evidence: [evidence], resolvedAt: null, resolutionEvidence: [], version: 2, recordedAt: evidence.observedAt, updatedAt: evidence.observedAt });
  const plan = buildReviewPlan(manifest, state, options(manifest));
  assert.equal(plan.canApply, true); assert.equal(plan.summary.newCandidates, 0);
  assert.equal(plan.decisions[0].taskId, task.id); assert.equal(plan.decisions[0].issueId, "legacy-issue");
  const command = plan.commands.find(row => row.action === "save_issue");
  assert.equal(command.expectedVersion, 2); assert.equal(command.record.status, "investigating"); assert.equal(command.record.priority, "P1");
});

test("new content cannot duplicate an already published intent; refresh can remain a research candidate", () => {
  const manifest = fixture(), state = snapshot();
  state.publications.push({ id: "published-original", taskId: "old-shipped-task", siteDomain: "flatkey.ai", country: "US", language: "en", keyword: "gpu cost", pageUrl: manifest.findings[0].pageUrl, status: "verified" });
  manifest.findings[0].changeType = "new_content";
  let plan = buildReviewPlan(manifest, state, options(manifest));
  assert.equal(plan.canApply, false); assert.match(plan.decisions[0].reason, /published_.*intent/);
  manifest.findings[0].changeType = "content_refresh";
  plan = buildReviewPlan(manifest, state, options(manifest));
  assert.equal(plan.canApply, true); assert.deepEqual(plan.decisions[0].relatedPublicationIds, ["published-original"]);
  assert.equal(plan.commands[0].record.status, "planned"); assert.equal(plan.commands[0].record.kind, "research");
});

test("published-intent checks also consume immutable historical imports without promoting them to current receipts", () => {
  const manifest = fixture(), state = snapshot(); manifest.findings[0].changeType = "new_content";
  state.historicalImports = [{ id: "old-archive", siteDomain: "flatkey.ai", publications: [{ id: "legacy-blog", sourceTaskId: "historical-task", pageUrl: manifest.findings[0].pageUrl,
    country: "US", language: "en", keyword: "gpu cost", verificationState: "artifact_verified" }] }];
  const plan = buildReviewPlan(manifest, state, options(manifest));
  assert.equal(plan.canApply, false); assert.match(plan.decisions[0].reason, /published_.*intent/);
  assert.equal(plan.workflowRead.publications, 0); assert.equal(plan.workflowRead.historicalPublications, 1);
  assert.match(plan.workflowRead.publishedIntentCoverage, /not_live_cms/);
});

test("missing identity is explicit, invented IDs and unverified source hashes block", () => {
  const manifest = fixture(), state = snapshot();
  assert.match(buildReviewPlan(manifest, state, options(manifest)).commands[0].record.nextAction, /身份.*不创建或虚构/);
  manifest.findings[0].keywordId = "invented-id";
  let plan = buildReviewPlan(manifest, state, options(manifest));
  assert.equal(plan.canApply, false); assert.match(plan.decisions[0].reason, /identity_not_verified/);
  plan = buildReviewPlan(manifest, state, { now });
  assert.equal(plan.canApply, false); assert.match(plan.decisions[0].reason, /hash_not_verified/);
});

test("same real keyword at a new slug stops for intent review instead of creating a duplicate candidate", () => {
  const manifest = fixture(), state = snapshot(); manifest.findings[0].changeType = "new_content";
  manifest.findings[0].keywordId = "real-keyword"; manifest.findings[0].pageUrl += "-new";
  state.publications.push({ id: "already-published", siteDomain: "flatkey.ai", keyword: "gpu cost", country: "US", language: "en",
    pageUrl: "https://flatkey.ai/blog/gpu-cost", status: "verified" });
  const plan = buildReviewPlan(manifest, state, { ...options(manifest), keywordInventory: [{ id: "real-keyword", text: "gpu cost", active: true,
    siteLinks: [{ siteDomain: "flatkey.ai", active: true }] }] });
  assert.equal(plan.canApply, false); assert.equal(plan.commands.length, 0); assert.match(plan.decisions[0].reason, /published_keyword_intent/);
});

test("query or fragment URLs are not silently declared canonical, and readable decisions are required", () => {
  const manifest = fixture(); manifest.findings[0].pageUrl += "?model=other";
  let plan = buildReviewPlan(manifest, snapshot(), options(manifest));
  assert.equal(plan.canApply, false); assert.match(plan.decisions[0].reason, /verified_canonical/);
  manifest.findings[0].pageUrl = "https://flatkey.ai/blog/gpu-cost";
  const unproven = options(manifest); delete unproven.decisionArtifact;
  plan = buildReviewPlan(manifest, snapshot(), unproven);
  assert.equal(plan.canApply, false); assert.match(plan.decisions[0].reason, /decision_manifest_artifact_required/);
});

test("appending an action never truncates the old instruction when the limit is reached", () => {
  const manifest = fixture(), state = snapshot(), task = original(); task.nextAction = "原".repeat(2998); state.tasks.push(task);
  Object.assign(manifest.findings[0], { existingTaskId: task.id, linkReason: "生产快照与目标页面均确认这是同一项原任务。" });
  const plan = buildReviewPlan(manifest, state, options(manifest));
  assert.equal(plan.canApply, false); assert.match(plan.decisions[0].reason, /next_action_limit/); assert.equal(plan.commands.length, 0);
  assert.equal(state.tasks[0].nextAction.length, 2998);
});

test("evidence is deduplicated and never truncates an original history at the schema limit", () => {
  const manifest = fixture(), state = snapshot(), task = original();
  task.sourceRowId = findingKey(manifest.findings[0]);
  task.evidence = Array.from({ length: 100 }, (_, i) => ({ ...evidence, label: "原证据" + i }));
  state.tasks.push(task);
  const plan = buildReviewPlan(manifest, state, options(manifest));
  assert.equal(plan.canApply, false); assert.match(plan.decisions[0].reason, /evidence_limit/); assert.equal(plan.commands.length, 0);
  assert.equal(state.tasks[0].evidence.length, 100);
});

test("renaming a report source cannot duplicate the same snapshot evidence", async () => {
  const manifest = fixture(), api = mockApi(), first = buildReviewPlan(manifest, api.state, options(manifest));
  await applyReviewPlan(first, api, applyOptions(manifest, first));
  manifest.sources[0].id = "same-snapshot-from-keyword-review"; manifest.sources[0].kind = "keyword";
  manifest.findings[0].sourceIds = [manifest.sources[0].id];
  const next = buildReviewPlan(manifest, api.state, options(manifest));
  assert.equal(next.canApply, true);
  // The renamed manifest is a new decision artifact; the raw snapshot itself
  // remains one evidence row instead of being duplicated under its alias.
  assert.equal(next.commands[0].record.evidence.filter(row => !row.label.includes("review-manifest")).length, 1);
});

test("product, cancelled, unsupported sites and paused Flatkey new pages remain blocked", () => {
  const manifest = fixture(), state = snapshot(), task = original();
  task.channel = "product"; state.tasks.push(task);
  Object.assign(manifest.findings[0], { existingTaskId: task.id, linkReason: "来源中明确记录了该生产原任务的引用和页面。" });
  let plan = buildReviewPlan(manifest, state, options(manifest));
  assert.equal(plan.canApply, false); assert.match(plan.decisions[0].reason, /outside_authorized_scope/);
  delete manifest.findings[0].existingTaskId; delete manifest.findings[0].linkReason;
  manifest.findings[0].changeType = "new_content"; manifest.findings[0].pageType = "landing";
  plan = buildReviewPlan(manifest, snapshot(), options(manifest));
  assert.equal(plan.canApply, false); assert.match(plan.decisions[0].reason, /flatkey_new_landing_paused/);
  manifest.findings[0].siteDomain = "jev-llm.com";
  assert.throws(() => buildReviewPlan(manifest, snapshot(), options(manifest)));
});

test("409 reads the original again, stops, and never overwrites or resubmits", async () => {
  const manifest = fixture(), api = mockApi(), plan = buildReviewPlan(manifest, api.state, options(manifest));
  let reads = 0, saves = 0;
  const transport = { ...api, snapshot: async () => { reads++; return api.snapshot(); }, save: async () => { saves++; const error = Error("conflict"); error.status = 409; throw error; } };
  const result = await applyReviewPlan(plan, transport, applyOptions(manifest, plan));
  assert.equal(result.status, "blocked"); assert.match(result.reason, /version_conflict/);
  assert.equal(saves, 1); assert.ok(reads >= 2); assert.equal(api.state.tasks.length, 0);
});

test("a competing task introduced after preview is rechecked and blocks every POST", async () => {
  const manifest = fixture(), api = mockApi(), plan = buildReviewPlan(manifest, api.state, options(manifest));
  api.state.tasks.push(original());
  const result = await applyReviewPlan(plan, api, applyOptions(manifest, plan));
  assert.equal(result.status, "blocked"); assert.match(result.reason, /dedupe_context_changed/); assert.equal(api.posts, 0);
});

test("an approved preview cannot be mutated into a production task or a different body", async () => {
  const manifest = fixture(), api = mockApi(), plan = buildReviewPlan(manifest, api.state, options(manifest));
  plan.commands[0].record.status = "ready";
  await assert.rejects(applyReviewPlan(plan, api, applyOptions(manifest, plan)), /content_changed/);
  assert.equal(api.posts, 0);
});

test("a lost successful response is confirmed from production readback without retry", async () => {
  const manifest = fixture(), api = mockApi(), plan = buildReviewPlan(manifest, api.state, options(manifest));
  const transport = { ...api, save: async command => { await api.save(command); throw Error("connection_lost"); } };
  const result = await applyReviewPlan(plan, transport, applyOptions(manifest, plan));
  assert.equal(result.status, "verified"); assert.equal(api.posts, 2); assert.equal(api.state.tasks.length, 1);
  assert.ok(result.receipts.every(row => row.readBack && row.recovered));
});

test("an unconfirmed POST is journaled and never re-sent on the next invocation", async () => {
  const manifest = fixture(), api = mockApi(), plan = buildReviewPlan(manifest, api.state, options(manifest)), outbox = journal();
  let saves = 0; const transport = { ...api, save: async () => { saves++; throw Error("timeout"); } };
  assert.equal((await applyReviewPlan(plan, transport, applyOptions(manifest, plan, outbox))).status, "blocked");
  const second = await applyReviewPlan(plan, transport, applyOptions(manifest, plan, outbox));
  assert.match(second.reason, /previous_submission_not_confirmed/); assert.equal(saves, 1);
});

test("the helper only calls the existing authenticated workflow routes", async () => {
  const calls = [], api = workflowApi("https://flatkey-seo-roadmap.vercel.app", "test-token", async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => ({ records: [] }) };
  });
  await api.snapshot(); await api.history("task", "original-id");
  assert.ok(calls.every(row => row.options.method === "GET" && row.url.includes("/api/seo/workflow")));
  assert.ok(calls.every(row => !Object.hasOwn(row.options.headers, "origin")));
});

test("CLI defaults to an offline preview, verifies the real file hash, and cannot apply that snapshot", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "seo-content-review-test-"));
  try {
    const artifact = path.join(directory, "source.json"), input = path.join(directory, "manifest.json"), history = path.join(directory, "history.json");
    const content = JSON.stringify({ observedAt: "2026-11-19T10:00:00Z", note: "真实本地测试证据" });
    await fs.writeFile(artifact, content);
    const manifest = fixture(); manifest.sources[0].artifact = artifact;
    manifest.sources[0].sha256 = crypto.createHash("sha256").update(content).digest("hex");
    assert.equal((await verifySources(manifest)).size, 1);
    await fs.writeFile(input, JSON.stringify(manifest)); await fs.writeFile(history, JSON.stringify(snapshot()));
    const command = [path.join(__dirname, "../scripts/seo-content-review.cjs"), "--input=" + input, "--workflow=" + history];
    let run = spawnSync(process.execPath, command, { encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.equal(run.status, 0, run.stderr); const preview = JSON.parse(run.stdout);
    assert.equal(preview.mode, "preview"); assert.equal(preview.canApply, true); assert.equal(preview.completeHistoryRead, false);
    const again = spawnSync(process.execPath, command, { encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.equal(again.status, 0); assert.equal(JSON.parse(again.stdout).planHash, preview.planHash);
    run = spawnSync(process.execPath, [...command, "--out=" + artifact], { encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.equal(run.status, 1); assert.match(run.stderr, /output_cannot_replace/); assert.equal(await fs.readFile(artifact, "utf8"), content);
    run = spawnSync(process.execPath, [...command, "--apply", "--expected-plan=" + preview.planHash], { encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.equal(run.status, 1); assert.match(run.stderr, /apply_requires_live_all_history/);
    await fs.writeFile(artifact, "changed"); assert.equal((await verifySources(manifest)).size, 0);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
