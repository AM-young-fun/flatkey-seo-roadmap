#!/usr/bin/env node
// Read-only evidence normalization. No CMS, table, analytics or notification API
// is called; the output is a reviewable pending command, never an apply step.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { workflowHistoricalImportSchema, workflowIssueSchema, workflowWeek } = require("../src/lib/seo-workflow.ts");
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const arg = name => process.argv.find(value => value.startsWith(name + "="))?.slice(name.length + 1);
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const fail = message => { throw Error(message); };

function buildBlogHistory(root) {
 root = fs.realpathSync(root);
 const resolve = value => {
  const prefix = "/private/tmp/flatkey-2026-11-10-run/";
  const relative = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  const file = fs.realpathSync(path.resolve(root, relative));
  if (!file.startsWith(root + path.sep)) fail("evidence_path_outside_readonly_root");
  return file;
 };
 const ledgerFile = resolve("daily-ledger.json"), closureFile = resolve("final-inventory/closing-verification.json"), startFile = resolve("daily-start-receipt.json");
 const ledger = read(ledgerFile), closure = read(closureFile), start = read(startFile);
 const auditFile = resolve(closure.publication_artifact_summary.file), audit = read(auditFile);
 if (!Array.isArray(audit) || audit.length !== ledger.published_language_pages || closure.publication_artifact_summary.rows !== audit.length) fail("publication_count_unconfirmed");
 if (!Array.isArray(ledger.articles) || !closure.all5_publication_closure_passed) fail("source_publication_closure_unconfirmed");
 const manifestHash = digest(Buffer.concat([ledgerFile, closureFile, auditFile, startFile].map(file => fs.readFileSync(file))));
 const observedAt = ledger.updated_at, evidenceFor = (label, file) => ({ label, artifact: file, observedAt });
 const provenance = [evidenceFor("原日账快照（整体仍有待补证据）", ledgerFile), evidenceFor("发布收尾检查快照", closureFile), evidenceFor("CMS/正式页留档审计", auditFile)];
 const bySource = new Map(ledger.articles.map(item => [item.slug, item]));
 const sourceIds = new Map(ledger.articles.map(item => { const row = audit.find(row => row.slug === item.slug && row.url === item.canonical_url); if (!row) fail("source_receipt_missing"); return [item.slug, "historical-pub:" + row.cms_id]; }));
 const taskId = item => `historical-task:${ledger.date}:${item.stream.toLowerCase()}:${item.row}`;
 const sources = ledger.articles.map(item => ({ id: taskId(item), externalRow: item.row, business: item.stream, title: item.title, pageUrl: item.canonical_url, language: item.language, country: null, keyword: null, researchState: "legacy_unverified", approvalState: "historical_not_granted", evidence: provenance }));
 const publications = audit.map(item => {
  const article = bySource.get(item.slug); if (!article) fail("unknown_source_slug");
  const cmsFile = resolve(item.cms_file), publicFile = resolve(item.public_file), qaFile = resolve(item.artifact_report);
  const cmsRaw = read(cmsFile), cms = cmsRaw.data ?? cmsRaw;
  if (digest(fs.readFileSync(publicFile)) !== item.public_sha256) fail("public_artifact_hash_mismatch:" + item.cms_id);
  if (!item.recomputed_pass || !item.artifact_declared_pass || !item.cms_site_exact || !item.identity_exact || !item.date_match || !item.h1_match || item.http !== 200 || item.cms_status !== "published" || item.canonical.length !== 1 || item.canonical[0] !== item.url || item.cms_canonical !== item.url) fail("publication_artifact_not_verified:" + item.cms_id);
  if (cms.id !== item.cms_id || cms.canonical_url !== item.url || cms.language !== item.language || cms.status !== "published" || Date.parse(cms.published_at) !== Date.parse(item.cms_published_at)) fail("cms_identity_or_time_mismatch:" + item.cms_id);
  const live = closure.live_representatives.find(check => check.url === item.url && check.pass === true && check.checked_at && check.http === 200 && check.cms_id_exact === true && check.artifact_content_exact === true && check.canonical?.length === 1 && check.canonical[0] === item.url);
  const source = item.url === article.canonical_url;
  if (source && Date.parse(article.first_published_at) !== Date.parse(item.cms_published_at)) fail("source_first_publication_time_mismatch");
  const evidence = [evidenceFor("CMS正式发布记录", cmsFile), evidenceFor("正式页HTML留档（本轮仅离线哈希复核）", publicFile), evidenceFor("当时页面检查记录", qaFile), provenance[2]];
  return { id: "historical-pub:" + item.cms_id, sourceTaskId: taskId(article), sourcePublicationId: source ? null : sourceIds.get(item.slug), kind: source ? "source_blog" : "translation", cmsId: item.cms_id, title: cms.title, pageUrl: item.url, language: item.language, country: null, keyword: null, contentVersion: "sha256:" + item.public_sha256, publishedAt: item.cms_published_at,
   // A later explicit check is evidence of that check, not evidence of the
   // first-ever verification. No file mtime or sitemap discovery substitutes.
   firstVerifiedAt: null, verifiedAt: live?.checked_at ?? null, verificationState: live ? "live_verified" : "artifact_verified",
   verification: { httpStatus: 200, canonicalUrl: item.url, contentMatched: live ? true : null, linksChecked: null, evidence }, evidence };
 });
 const attempted = Object.values(ledger.audits).reduce((sum, row) => sum + row.attempted, 0), completed = Object.values(ledger.audits).reduce((sum, row) => sum + row.successful_scans, 0), pending = Object.values(ledger.audits).reduce((sum, row) => sum + row.pending, 0);
 const record = workflowHistoricalImportSchema.parse({ id: `historical-import:flatkey-blog:${ledger.date}`, weekStart: workflowWeek(new Date(ledger.date + "T12:00:00+08:00")), siteDomain: "flatkey.ai", status: "archived", mode: "historical_import", sourceRunId: `BLOG:${ledger.date}`, sourceRunStatus: ledger.status, sourceStartedAt: start.started_at, sourceCompletedAt: null, sourceSnapshotAt: observedAt, manifestHash, evidence: provenance,
  notes: `只读导入此前发布证据，不代表本轮新发布或新审批。原阶段：${ledger.phase}。${publications.length}页留档哈希/身份/发布时刻通过，${publications.filter(item => item.verificationState === "live_verified").length}页另有明确在线复核时刻；全部首次验收时刻未知。研究与四国目标未按新标准复核，country/keyword为null；不按页面语言猜国家。历史${ledger.unique_verified_bot_notifications}条通知已完成，不重发。GSC/GA4历史任务停用不推断当前授权。`,
  sourceTasks: sources, publications, auditBacklog: { attempted, completed, pending, evidence: provenance }, pendingRevisions: { count: ledger.deep_revisions.prepared, externalRows: ledger.deep_revisions.opt_rows, cmsModified: ledger.deep_revisions.cms_modified, state: "awaiting_exact_review", evidence: provenance } });
 const issue = (suffix, title, category, impact, nextAction) => workflowIssueSchema.parse({ id: `historical-issue:${ledger.date}:${suffix}`, weekStart: record.weekStart, siteDomain: "flatkey.ai", pageUrl: null, title, category, priority: "P1", status: "open", owner: "SEO/AI", taskId: null, firstSeenAt: start.started_at, impact, nextAction, evidence: provenance, resolvedAt: null, resolutionEvidence: [] });
 const commands = [{ requestId: `history:${ledger.date}:${manifestHash.slice(0,24)}`, action: "record_historical_import", expectedVersion: 0, record },
  { requestId: `history-issue:${ledger.date}:audit:${manifestHash.slice(0,16)}`, action: "save_issue", expectedVersion: 0, record: issue("audit-backlog", `${pending}项历史意图审查证据仍待补全`, "content", `实际尝试${attempted}项，仅${completed}项完成证据；不能把已发布页面等同于Top10/正文意图审查完成。`, "按分层审查和优先级补证据，保留原成功历史；不要重复发布已完成新文。") },
  { requestId: `history-issue:${ledger.date}:revision:${manifestHash.slice(0,16)}`, action: "save_issue", expectedVersion: 0, record: issue("pending-revisions", `${ledger.deep_revisions.prepared}页历史深度修改等待具体审核`, "content", "已有修改稿，CMS实际修改为0；不计入今日优化上线。", `逐页核对优化表行${ledger.deep_revisions.opt_rows.join("、")}的具体差异和证据，获得审核后新建正常优化任务与不可变基线。`) }];
 return { commands, summary: { manifestHash, sourceTasks: sources.length, sourceBlogs: publications.filter(item => item.kind === "source_blog").length, translations: publications.filter(item => item.kind === "translation").length, pages: publications.length, liveVerified: publications.filter(item => item.verificationState === "live_verified").length, artifactVerifiedOnly: publications.filter(item => item.verificationState === "artifact_verified").length, unknownFirstVerificationTime: publications.filter(item => !item.firstVerifiedAt).length, auditAttempted: attempted, auditCompleted: completed, auditPending: pending, oldCmsEdits: ledger.deep_revisions.cms_modified, commands: commands.length, writesPerformed: "output_files_only" } };
}
if (require.main === module) {
 try {
  const root = arg("--root"), output = arg("--output"); if (!root || !output) fail("usage: --root=readonly-evidence-root --output=output-directory");
  const { commands, summary } = buildBlogHistory(root); fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(output, "pending-commands.json"), JSON.stringify(commands, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(output, "import-summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...summary, output: path.resolve(output) }, null, 2));
 } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildBlogHistory };
