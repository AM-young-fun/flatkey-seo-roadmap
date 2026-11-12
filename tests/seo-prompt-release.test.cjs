const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const ts = require("typescript"), syncfs = require("node:fs");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(syncfs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { releasePrompt, validateInput, LANGUAGES, PROTOCOL } = require("../scripts/seo-prompt-release.cjs");
const { prepareWorkflowMutation, checkWorkflowApproval, workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
const { workflowPublicationSchema } = require("../src/lib/seo-workflow.ts");
const SEO = "https://flatkey-seo-roadmap.vercel.app", CONSOLE = "https://console.flatkey.ai";
const time = new Date(), approvedAt = new Date(time.getTime() - 60000).toISOString(), createdAt = Math.floor(time.getTime() / 1000);
const secret = "fixture-seo-secret-7481", promptSecret = "fixture-prompt-secret-8713";
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const evidence = [{ label: "Reviewed evidence", url: "https://example.com/proof", observedAt: approvedAt }];
function fixture() {
  const item = { slug: "blue-cup", category: "image", model: "gpt-image-2", prompt: "A blue cup", title: Object.fromEntries(Object.keys(LANGUAGES).map(l => [l, "Fixture " + l])), summary: Object.fromEntries(Object.keys(LANGUAGES).map(l => [l, "Summary " + l])), tags: ["cup"], output: { ratio: "1:1" }, artifact: { kind: "image", url: "https://example.com/cup.jpg" }, source: { platform: "GitHub", label: "Author", url: "https://github.com/flatkey-ai/awesome-images", captured_at: approvedAt }, _seo_review: { catalogUrl: "https://github.com/flatkey-ai/awesome-images", revision: "a".repeat(40), originalSourceUrl: "https://github.com/flatkey-ai/awesome-images", author: "Author", license: "CC BY 4.0", reviewer: "Fixture reviewer", checkedAt: approvedAt, artifactSha256: "b".repeat(64), originalAuthorAndLicense: true, fullMediaReview: true, publicCdnVerified: true, duplicateCheck: true, generationModelVerified: true, evidence } };
  const approvedItemJSON = JSON.stringify(item), contentVersion = "sha256:" + crypto.createHash("sha256").update(approvedItemJSON).digest("hex");
  const day = time.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }), date = new Date(day + "T00:00:00Z"); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const weekStart = date.toISOString().slice(0, 10);
  const approvals = Object.keys(LANGUAGES).map(language => ({ approvalId: "prompt-approval", approvalItemId: "item-" + language, taskId: "prompt-task", pageUrl: `https://flatkey.ai/${language === "en" ? "" : language + "/"}prompts/image/blue-cup`, language, contentVersion }));
  return { version: 1, taskId: "prompt-task", weekStart, approvedItemJSON, contentVersion, approvals };
}
async function harness(t, input = fixture()) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-release-test-")); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "input.json"), JSON.stringify(input));
  let rows = [], stored = null, postCount = 0, credentialReads = 0, completed = false, leased = false, tokenCounter = 0;
  const flags = { capability: true, backend: true, denied: false, mismatchApproval: false, postThrows: false, acceptBeforeThrow: true, denyAfterChecks: false };
  const parsed = validateInput(input);
  function mutate(record, action, actor = "collector", expectedVersion = 0, at = time) {
    const prepared = prepareWorkflowMutation({ requestId: crypto.randomUUID(), action, record, expectedVersion }, rows, actor, at);
    rows = rows.filter(row => !(row.kind === prepared.kind && row.record.id === prepared.record.id)); rows.push({ kind: prepared.kind, record: prepared.record });
    return prepared;
  }
  mutate({ id: "prompt-task", weekStart: input.weekStart, title: "Prompt release fixture", siteDomain: "flatkey.ai", kind: "technical", country: null, language: null, business: "API", pageType: "other", keyword: null, pageUrl: null, owner: "AI", dueAt: time.toISOString(), status: "review_pending", dependencies: [], evidence, nextAction: "Review", contentVersion: input.contentVersion, acceptanceCriteria: ["Exact approved content"], source: "automation" }, "save_task");
  const approval = { id: "prompt-approval", weekStart: input.weekStart, siteDomain: "flatkey.ai", title: "Ten Prompt routes", requestedBy: "AI", submittedAt: approvedAt, status: "pending", items: input.approvals.map(a => ({ id: a.approvalItemId, taskId: input.taskId, operation: "new", pageUrl: a.pageUrl, language: a.language, contentVersion: input.contentVersion, baseContentVersion: null, changeSummary: "New reviewed Prompt", beforeSummary: null, afterSummary: "Reviewed Prompt", draftUrl: null, previewUrl: "https://staging-website.flatkey.ai/" + a.language, previewContentVersion: input.contentVersion, reviewContent: input.approvedItemJSON, reviewFormat: "text", beforeContent: null, evidence: [...evidence, { label: "desktop screenshot", url: "https://example.com/desktop.jpg", observedAt: approvedAt }, { label: "mobile screenshot", url: "https://example.com/mobile.jpg", observedAt: approvedAt }] })), decisions: [], supersedesApprovalIds: [], evidence };
  const pending = mutate(approval, "save_approval", "collector", 0, new Date(approvedAt));
  mutate({ ...approval, status: "approved", decisions: [{ id: "decision", itemIds: approval.items.map(x => x.id), decision: "approved", decidedBy: "Fixture user", decidedAt: approvedAt, note: "Approved exact fixture", evidence }] }, "save_approval", "human", pending.record.version, new Date(approvedAt));
  const publicRow = () => { const copy = { ...parsed.item }; delete copy._seo_review; return { ...copy, contentVersion: input.contentVersion, createdAt, importCreatedAt: time.toISOString() }; };
  let checkCount = 0;
  const fetchImpl = async (url, opts) => {
    assert.equal(opts.redirect, "error"); assert.equal(opts.cache, "no-store");
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (url.startsWith(SEO)) assert.equal(opts.headers.authorization, "Bearer " + secret);
    if (url.startsWith(SEO + "/api/seo/workflow?")) return json({ ...workflowSnapshot(rows, { week: input.weekStart, allHistory: true }, "database", time), ...(flags.capability ? { capabilities: { promptPublication: 1 } } : {}) });
    if (url === SEO + "/api/seo/workflow/approval-check") {
      checkCount++;
      if (flags.denied || flags.denyAfterChecks && checkCount > 10) return json({ code: "publication_unapproved" }, 409);
      const check = { ...checkWorkflowApproval(body, rows, time), storage: "database" };
      if (flags.mismatchApproval) check.request.contentVersion = "other";
      return json(check);
    }
    if (url === SEO + "/api/seo/workflow/claims") {
      if (body.action === "claim") { if (completed || leased) return json({ acquired: false, reason: completed ? "completed" : "leased" }); leased = true; return json({ acquired: true, fencingToken: ++tokenCounter }); }
      if (body.action === "complete") { leased = false; completed = body.status === "completed"; return json({ acquired: false, status: body.status }); }
      throw new Error("unexpected claim");
    }
    if (url === SEO + "/api/seo/workflow") {
      assert.ok(body.claim?.fencingToken); const prepared = mutate(body.record, body.action, "collector", body.expectedVersion);
      return json({ stored: true, replay: false, kind: prepared.kind, record: prepared.record, storage: "database" });
    }
    if (url === CONSOLE + "/api/prompt-library/blue-cup") {
      assert.equal(opts.headers.authorization, undefined);
      return json(stored ? { success: true, data: { item: stored } } : { success: false }, stored ? 200 : 404, flags.backend ? { "x-prompt-import-protocol": PROTOCOL } : {});
    }
    if (url === CONSOLE + "/api/prompt-library/import") {
      postCount++; assert.equal(opts.headers.authorization, "Bearer " + promptSecret); assert.equal(body.items, undefined); assert.equal(body.create_only, true); assert.equal(body.approved_item_json, input.approvedItemJSON);
      assert.ok(rows.some(r => r.kind === "run"), "durable attempt marker must exist before POST");
      if (!flags.postThrows || flags.acceptBeforeThrow) stored = publicRow();
      if (flags.postThrows) throw new Error("lost response " + promptSecret);
      return json({ success: true, data: { protocol: PROTOCOL, created: true, content_version: input.contentVersion, created_at: createdAt, item: stored } });
    }
    throw new Error("unexpected URL " + url);
  };
  const config = { cwd: dir, env: { SEO_IMPORT_TOKEN: secret }, fetchImpl, now: () => time, credentialLoader: async () => { credentialReads++; return promptSecret; } };
  const run = execute => releasePrompt({ ...config, argv: ["--input=input.json", ...(execute ? ["--execute", "--release-authorized=" + input.contentVersion] : [])] });
  return { input, dir, flags, run, config, get rows() { return rows; }, counts: () => ({ postCount, credentialReads, checkCount }), setStored(value) { stored = value; }, publicRow };
}

test("read-only preflight checks all ten exact pages, never reads production credential or mutates", async t => {
  const h = await harness(t), result = await h.run(false); assert.equal(result.exitCode, 0); assert.equal(result.code, "preflight_passed_not_permission"); assert.deepEqual(h.counts(), { postCount: 0, credentialReads: 0, checkCount: 10 }); assert.equal(h.rows.length, 2);
  assert.equal((await fs.stat(result.receipt)).mode & 0o777, 0o600);
});
test("production import writes one Prompt and ten published page receipts, never ten blogs or unverified success", async t => {
  const h = await harness(t), result = await h.run(true);
  assert.equal(result.exitCode, 0, JSON.stringify(result)); assert.equal(result.importedNew, 1); assert.equal(result.publishedPages, 10); assert.equal(result.verifiedPages, 0); assert.equal(result.code, "imported_pages_need_live_verification");
  assert.equal(h.counts().postCount, 1); assert.equal(h.counts().credentialReads, 1); assert.equal(h.counts().checkCount, 20);
  const pubs = h.rows.filter(r => r.kind === "publication"); assert.equal(pubs.length, 10); assert.ok(pubs.every(r => r.record.kind === "prompt" && r.record.status === "published" && r.record.verifiedAt === null));
  const snapshot = workflowSnapshot(h.rows, { week: h.input.weekStart }, "database", time); assert.equal(snapshot.summary.verifiedSourceBlogs, 0); assert.equal(snapshot.summary.verifiedTranslations, 0);
  assert.equal(h.rows.find(r => r.kind === "run").record.status, "partial");
  const again = await h.run(true); assert.equal(again.exitCode, 0, JSON.stringify(again)); assert.equal(h.counts().postCount, 1); assert.equal(again.importedNew, 0); assert.equal(h.rows.filter(r => r.kind === "publication").length, 10);
});
test("lost POST response is reconciled by exact public content without another POST", async t => {
  const h = await harness(t); h.flags.postThrows = true;
  const first = await h.run(true); assert.equal(first.exitCode, 1); assert.equal(first.outcome, "unknown_requires_readback");
  const second = await h.run(true); assert.equal(second.exitCode, 0, JSON.stringify(second)); assert.equal(second.importedNew, 0); assert.equal(second.publishedPages, 10); assert.equal(h.counts().postCount, 1);
  assert.ok(!(await fs.readFile(first.receipt, "utf8")).includes(promptSecret));
});
test("credential failure before POST leaves no permanent attempted marker and can resume", async t => {
  const h = await harness(t);
  const result = await releasePrompt({ ...h.config, argv: ["--input=input.json", "--execute", "--release-authorized=" + h.input.contentVersion], credentialLoader: async () => { throw new Error("keychain unavailable"); } });
  assert.equal(result.exitCode, 1); assert.equal(result.productionPostAttempted, false); assert.equal(h.rows.filter(r => r.kind === "run").length, 0); assert.equal(h.counts().postCount, 0);
  const recovered = await h.run(true); assert.equal(recovered.exitCode, 0, JSON.stringify(recovered)); assert.equal(h.counts().postCount, 1);
});
test("same-second approval and import use stored precise creation time, not truncated Unix seconds", async t => {
  const h = await harness(t); const second = Math.floor(time.getTime() / 1000) * 1000;
  const preciseApproval = new Date(second + 1).toISOString(), preciseImport = new Date(second + 2).toISOString();
  const a = h.rows.find(r => r.kind === "approval").record; a.decisions[0].recordedAt = preciseApproval;
  h.setStored({ ...h.publicRow(), importCreatedAt: preciseImport });
  const result = await h.run(true); assert.equal(result.exitCode, 0, JSON.stringify(result)); assert.equal(result.publishedAt, preciseImport); assert.equal(h.counts().postCount, 0);
  assert.ok(h.rows.filter(r => r.kind === "publication").every(r => r.record.publishedAt === preciseImport));
});
test("an attempted import with no exact row remains blocked and cannot blindly retry", async t => {
  const h = await harness(t); h.flags.postThrows = true; h.flags.acceptBeforeThrow = false;
  assert.equal((await h.run(true)).exitCode, 1); const again = await h.run(true); assert.equal(again.code, "previous_attempt_unknown_readback_missing"); assert.equal(h.counts().postCount, 1);
});
test("concurrent release executors produce one POST with the durable claim", async t => {
  const h = await harness(t); const results = await Promise.all([h.run(true), h.run(true)]); assert.equal(results.filter(x => x.exitCode === 0).length, 1); assert.equal(h.counts().postCount, 1);
});
test("legacy backend/platform and denied or revised approvals fail closed before production writes", async t => {
  for (const flag of ["capability", "backend", "denied", "mismatchApproval", "denyAfterChecks"]) await t.test(flag, async t => {
    const h = await harness(t); h.flags[flag] = ["capability", "backend"].includes(flag) ? false : true;
    assert.equal((await h.run(true)).exitCode, 1); assert.equal(h.counts().postCount, 0); assert.equal(h.counts().credentialReads, flag === "denyAfterChecks" ? 1 : 0);
    assert.ok(h.rows.filter(r => r.kind === "run").every(r => !r.record.evidence.some(e => e.label === "PROMPT_POST_ATTEMPT_V1")));
    if (flag === "denyAfterChecks") { h.flags.denyAfterChecks = false; const retry = await h.run(true); assert.equal(retry.exitCode, 0, JSON.stringify(retry)); assert.equal(h.counts().postCount, 1); }
  });
});
test("unversioned or edited existing slug is never overwritten", async t => {
  const h = await harness(t); h.setStored({ ...h.publicRow(), prompt: "Changed after old import" }); const result = await h.run(true); assert.equal(result.code, "existing_slug_content_conflict"); assert.equal(h.counts().postCount, 0);
});
test("prepool, wrong page/language/hash, missing reviews and unsafe source catalogs cannot become approved input", () => {
  const base = fixture();
  for (const mutate of [x => x.approvals.pop(), x => x.approvals[0].language = "zh", x => x.approvals[0].pageUrl += "?next=evil", x => x.contentVersion = "sha256:" + "c".repeat(64)]) { const input = structuredClone(base); mutate(input); assert.throws(() => validateInput(input)); }
  for (const mutate of [x => delete x._seo_review, x => x._seo_review.fullMediaReview = false, x => x._seo_review.catalogUrl += ".evil", x => x.artifact.url = "http://example.com/asset", x => delete x.title.ja]) { const input = structuredClone(base), item = JSON.parse(input.approvedItemJSON); mutate(item); input.approvedItemJSON = JSON.stringify(item); input.contentVersion = "sha256:" + crypto.createHash("sha256").update(input.approvedItemJSON).digest("hex"); assert.throws(() => validateInput(input)); }
});
test("prompt publication schema is narrowly scoped to actual Prompt detail URLs", () => {
  const base = { id: "pub", taskId: "task", approvalId: "a", approvalItemId: "i", weekStart: "2026-11-09", runId: "r", siteDomain: "flatkey.ai", pageUrl: "https://flatkey.ai/prompts/image/cup", country: null, language: "en", keyword: null, contentVersion: "v1", title: "Cup", kind: "prompt", sourcePublicationId: null, publishedAt: approvedAt, verifiedAt: null, status: "published", liveCheck: null, evidence, failureReason: null };
  assert.equal(workflowPublicationSchema.safeParse(base).success, true);
  for (const pageUrl of ["https://flatkey.ai/blog/cup", "https://flatkey.ai/prompts/image/cup?x=1", "https://flatkey.ai.evil/prompts/image/cup", "https://www.flatkey.ai/prompts/image/cup", "https://flatkey.ai/prompts/image/%2e%2e"]) assert.equal(workflowPublicationSchema.safeParse({ ...base, pageUrl }).success, false);
});
