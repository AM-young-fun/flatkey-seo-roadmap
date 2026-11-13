const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { productReviewBelongsToSite, pageBelongsToSite, workflowTaskSchema, workflowApprovalSchema, workflowPublicationSchema } = require("../src/lib/seo-workflow.ts");
const { prepareWorkflowMutation } = require("../src/lib/seo-workflow-state.ts");
const evidence = [{ label: "Versioned change", artifact: "/tmp/product-review.diff", observedAt: "2026-11-11T09:00:00Z" }];
const url = "https://console.flatkey.ai/gpu-cluster/";
const task = { id: "product-task", weekStart: "2026-11-09", siteDomain: "flatkey.ai", channel: "product", title: "GA4 business journeys", kind: "technical", country: null, language: null, business: "GPU", pageType: "technical", keyword: null, pageUrl: null, owner: "AI", dueAt: "2026-11-13T09:00:00Z", status: "drafting", dependencies: [], evidence, nextAction: "Review exact version", contentVersion: "v2", acceptanceCriteria: ["Match tested version"], research: null, approval: null, source: "automation" };
const item = { id: "product-item", taskId: task.id, operation: "update", pageUrl: url, language: "en", contentVersion: "v2", baseContentVersion: "v1", changeSummary: "Consent and steps", beforeSummary: "Mixed destinations", afterSummary: "GA4 only", draftUrl: null, previewUrl: "https://staging-console.flatkey.ai/gpu-cluster/", previewContentVersion: null, reviewContent: "Exact scope", reviewFormat: "text", beforeContent: null, evidence };
const approval = { id: "product-approval", weekStart: "2026-11-09", siteDomain: "flatkey.ai", channel: "product", title: "GA4 review", requestedBy: "AI", submittedAt: null, status: "draft", items: [item], decisions: [], supersedesApprovalIds: [], evidence };
const mutate = (record, action, all = [], expectedVersion = 0) => prepareWorkflowMutation({ requestId: "product-" + action, action, expectedVersion, record }, all, "collector", new Date("2026-11-11T09:00:00Z"));
test("product review accepts exactly the four explicit owned hosts and rejects disguised origins and paths", () => {
  for (const host of ["flatkey.ai", "www.flatkey.ai", "console.flatkey.ai", "router.flatkey.ai"]) assert.equal(productReviewBelongsToSite(`https://${host}/path`, "flatkey.ai"), true);
  for (const bad of ["http://console.flatkey.ai/", "https://staging-console.flatkey.ai/", "https://evil.flatkey.ai/", "https://console.flatkey.ai.evil.test/", "https://user@console.flatkey.ai/", "https://console.flatkey.ai:443/", "https://console.flatkey.ai:444/", "https://console.flatkey.ai/%2e%2e/", "https://console.flatkey.ai/%252f", "https://console.flatkey.ai/a/../b", "https://console.flatkey.ai/a/./b", "https://console.flatkey.ai/a\\b", "https://console.flatkey.ai/path?next=https://evil.test", "https://console.flatkey.ai/#hash", "https://console.flatkey.ai/a\nb"]) assert.equal(productReviewBelongsToSite(bad, "flatkey.ai"), false, bad);
  assert.equal(productReviewBelongsToSite(url, "modelfit.cc"), false);
});
test("product review saves real technical task and draft approval while retaining normal website boundaries", () => {
  const t = mutate(task, "save_task");
  const a = mutate(approval, "save_approval", [{ kind: "task", record: t.record }]);
  assert.equal(a.record.status, "draft"); assert.equal(a.record.channel, "product");
  assert.equal(pageBelongsToSite(url, "flatkey.ai"), false);
  assert.equal(workflowTaskSchema.safeParse({ ...task, pageUrl: url, channel: "website" }).success, false);
  assert.equal(workflowApprovalSchema.safeParse({ ...approval, channel: "website" }).success, false);
});
test("product cannot disguise a content task or become source-blog publication", () => {
  assert.equal(workflowTaskSchema.safeParse({ ...task, kind: "blog", country: "US", language: "en", keyword: "gpu rental" }).success, false);
  assert.equal(workflowTaskSchema.safeParse({ ...task, siteDomain: "modelfit.cc" }).success, false);
  const publication = { id: "bad-pub", taskId: task.id, approvalId: approval.id, approvalItemId: item.id, weekStart: task.weekStart, runId: "run", siteDomain: "flatkey.ai", pageUrl: url, country: null, language: "en", keyword: null, contentVersion: "v2", title: "Console", kind: "source_blog", sourcePublicationId: null, publishedAt: "2026-11-11T09:00:00Z", verifiedAt: null, status: "published", liveCheck: null, evidence, failureReason: null };
  assert.equal(workflowPublicationSchema.safeParse(publication).success, false);
});
test("product approval must reference a product technical task; channel cannot change after submission", () => {
  const ordinary = mutate({ ...task, channel: "website" }, "save_task");
  assert.throws(() => mutate(approval, "save_approval", [{ kind: "task", record: ordinary.record }]), /同渠道技术任务/);
  const t = mutate(task, "save_task"), rows = [{ kind: "task", record: t.record }];
  assert.throws(() => mutate({ ...task, channel: "website" }, "save_task", rows, 1), /不能更换渠道/);
  const websiteItem = { ...item, pageUrl: "https://flatkey.ai/", previewContentVersion: "v2", evidence: [...evidence,
    { label: "桌面截图", url: "https://images.example.com/desktop.png", observedAt: "2026-11-11T09:00:00Z" },
    { label: "手机截图", url: "https://images.example.com/mobile.png", observedAt: "2026-11-11T09:00:00Z" }] };
  assert.throws(() => mutate({ ...approval, channel: "website", items: [websiteItem] }, "save_approval", rows), /同渠道技术任务/);
  const submitted = mutate({ ...approval, submittedAt: "2026-11-11T09:00:00Z", status: "pending", items: [websiteItem] }, "save_approval", rows);
  assert.throws(() => mutate({ ...approval, channel: "website", submittedAt: "2026-11-11T09:00:00Z", status: "pending", items: [websiteItem] }, "save_approval", [...rows, { kind: "approval", record: submitted.record }], 1), /同渠道技术任务|不可改写/);
});
