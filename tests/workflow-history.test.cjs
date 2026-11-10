const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { workflowHistoricalImportSchema } = require("../src/lib/seo-workflow.ts");
const { prepareWorkflowMutation, workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
const now = new Date("2026-11-10T10:00:00Z"), evidence = [{ label: "保留来源", artifact: "/archive/check.json", observedAt: "2026-11-10T06:00:00Z" }];
function archive() {
 const source = { id: "old-source", sourceTaskId: "old-task", sourcePublicationId: null, kind: "source_blog", cmsId: "cms-source", title: "Model API", pageUrl: "https://flatkey.ai/blog/model-api", language: "en", country: null, keyword: null, contentVersion: "sha256:" + "a".repeat(64), publishedAt: "2026-11-10T03:00:00Z", firstVerifiedAt: null, verifiedAt: "2026-11-10T04:00:00Z", verificationState: "live_verified", verification: { httpStatus: 200, canonicalUrl: "https://flatkey.ai/blog/model-api", contentMatched: true, linksChecked: null, evidence }, evidence };
 return { id: "archive-1", weekStart: "2026-11-09", siteDomain: "flatkey.ai", status: "archived", mode: "historical_import", sourceRunId: "BLOG:2026-11-10", sourceRunStatus: "RUNNING", sourceStartedAt: "2026-11-10T02:30:00Z", sourceCompletedAt: null, sourceSnapshotAt: "2026-11-10T06:00:00Z", manifestHash: "a".repeat(64), notes: "只读历史，未授予新授权", evidence,
 sourceTasks: [{ id: "old-task", externalRow: 1, business: "API", title: "Model API", pageUrl: source.pageUrl, language: "en", country: null, keyword: null, researchState: "legacy_unverified", approvalState: "historical_not_granted", evidence }],
 publications: [source, { ...source, id: "old-translation", cmsId: "cms-translated", kind: "translation", sourcePublicationId: "old-source", pageUrl: "https://flatkey.ai/zh/blog/model-api", title: "模型接口", language: "zh", publishedAt: "2026-11-10T03:20:00Z", verifiedAt: null, verificationState: "artifact_verified", verification: { ...source.verification, canonicalUrl: "https://flatkey.ai/zh/blog/model-api", contentMatched: null } }],
 auditBacklog: { attempted: 264, completed: 2, pending: 262, evidence }, pendingRevisions: { count: 1, externalRows: [7], cmsModified: 0, state: "awaiting_exact_review", evidence } };
}
const save = (record, all = [], expectedVersion = 0) => prepareWorkflowMutation({ requestId: "archive-request", action: "record_historical_import", expectedVersion, record }, all, "collector", now);

test("historical import preserves observed dates, never fills first check or new workflow approvals", () => {
 const result = save(archive()), row = { kind: result.kind, record: result.record };
 assert.equal(result.record.publications[0].publishedAt, "2026-11-10T03:00:00Z");
 assert.equal(result.record.publications[0].verifiedAt, "2026-11-10T04:00:00Z");
 assert.equal(result.record.publications[0].firstVerifiedAt, null);
 assert.equal(result.record.publications[0].verificationRecordedAt, now.toISOString());
 assert.equal(result.record.publications[1].verificationRecordedAt, null);
 const snapshot = workflowSnapshot([row], {}, "database", now);
 assert.equal(snapshot.historicalImports.length, 1);
 assert.equal(snapshot.tasks.length, 0);
 assert.equal(snapshot.publications.length, 0);
 assert.equal(snapshot.summary.verifiedSourceBlogs, 0, "import cannot fabricate new deliveries in the current period");
 assert.equal(snapshot.historicalImports[0].publications[1].country, null, "translation language does not guess a country");
 assert.equal(workflowSnapshot([row], { pageUrl: "https://flatkey.ai/zh/blog/model-api" }, "database", now).historicalImports.length, 1);
});
test("history is immutable and duplicate manifests cannot be relabeled as new work", () => {
 const first = save(archive()), row = { kind: first.kind, record: first.record };
 assert.throws(() => save({ ...archive(), notes: "changed" }, [row], 1), /不可变证据/);
 assert.throws(() => save({ ...archive(), id: "other-id" }, [row]), /已有档案/);
 const duplicate = archive(); duplicate.id = "other-id"; duplicate.sourceRunId = "BLOG:other"; duplicate.manifestHash = "b".repeat(64);
 assert.throws(() => save(duplicate, [row]), /已有档案/);
 const unauthorized = archive(); unauthorized.sourceTasks[0].approvalState = "approved";
 assert.equal(workflowHistoricalImportSchema.safeParse(unauthorized).success, false);
});
test("archive rejects invented check timestamps, mismatched source identity and false completion totals", () => {
 const noTime = archive(); noTime.publications[0].verifiedAt = null;
 assert.equal(workflowHistoricalImportSchema.safeParse(noTime).success, false);
 const invented = archive(); invented.publications[1].verifiedAt = "2026-11-10T04:00:00Z";
 assert.equal(workflowHistoricalImportSchema.safeParse(invented).success, false);
 const brokenSource = archive(); brokenSource.publications[1].sourcePublicationId = "not-real";
 assert.equal(workflowHistoricalImportSchema.safeParse(brokenSource).success, false);
 const falseDone = archive(); falseDone.auditBacklog.completed = 264;
 assert.equal(workflowHistoricalImportSchema.safeParse(falseDone).success, false);
 const clientStamp = archive(); clientStamp.publications[0].verificationRecordedAt = "2026-11-10T04:00:00Z";
 assert.equal(workflowHistoricalImportSchema.safeParse(clientStamp).success, false, "receipt timestamp belongs to server");
});
