// Pure planning and an injectable workflow transport. No provider, CMS or plan writes.
const crypto = require("node:crypto");
const path = require("node:path");
const { z } = require("zod");
const { workflowTaskSchema, workflowIssueSchema, workflowWeekSchema, taskNeedsChineseBrief, workflowTaskBriefProblems } = require("./seo-content-review-schema.cjs");

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value;
const hash = value => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
function safeWorkflowError(error) {
  const httpStatus = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : null;
  const code = typeof error?.code === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(error.code) && !/^[a-f0-9]{24,}$/u.test(error.code)
    ? error.code : httpStatus ? "workflow_error" : "submission_outcome_unknown";
  const message = typeof error?.publicMessage === "string" ? error.publicMessage.slice(0, 10000)
    .replace(/\b(?:Bearer|Basic)\s+\S+/giu, "[已隐藏凭据]")
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]+/giu, "[已隐藏认证头]")
    .replace(/["']?(?:password|secret|(?:access[\s_-]?)?token|api[\s_-]?key|authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/giu, "[已隐藏凭据]")
    .replace(/https?:\/\/\S+/giu, "[已隐藏地址]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[已隐藏账号]")
    .replace(/[A-Za-z0-9+/_=-]{32,}/gu, "[已隐藏长标识]").replace(/\p{Cc}/gu, " ").slice(0, 500)
    : httpStatus ? "工作流请求未被服务器接受，请核对错误码与原记录。" : "提交结果未确认；保留原请求并只读核对。";
  return { httpStatus, code, message, rejected: httpStatus !== null && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 };
}
const word = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const stamp = z.iso.datetime({ offset: true });
const chinese = z.string().trim().min(1).max(2000).refine(value => /[\u3400-\u9fff]/u.test(value), "需要中文问题和处理说明");
const site = z.enum(["flatkey.ai", "rackrate.org", "modelfit.cc"]);
const sourceSchema = z.object({ id: z.string().trim().min(1).max(100), kind: z.enum(["keyword", "weekly"]),
  artifact: z.string().min(1).max(2000).refine(path.isAbsolute, "来源快照必须为本地绝对路径"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u), observedAt: stamp, url: z.url().max(3000).optional(),
}).strict();
const decisionArtifactSchema = sourceSchema.pick({ artifact: true, sha256: true, observedAt: true });
const findingSchema = z.object({ problemKey: z.string().regex(/^[a-z0-9][a-z0-9_.:-]{2,100}$/u),
  changeType: z.enum(["keyword_diagnosis", "content_refresh", "new_content", "technical_review", "measurement_review"]),
  siteDomain: site, country: z.enum(["US", "JP", "BR", "ES"]).nullable(),
  language: z.enum(["en", "ja", "pt-BR", "es-ES"]).nullable(), pageUrl: z.url().max(3000).nullable(),
  keyword: z.string().trim().min(1).max(300).nullable(), keywordId: z.string().min(1).max(160).nullable().default(null),
  title: chinese.max(500), business: z.enum(["API", "GPU", "CLUSTER"]),
  pageType: z.enum(["blog", "landing", "tool", "comparison", "tutorial", "pricing", "integration", "technical", "other"]),
  category: z.enum(["technical", "indexing", "language", "content", "data", "business", "sync"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]), problem: chinese, recommendation: chinese,
  actions: z.array(z.object({ target: z.string().trim().min(1).max(1000), change: chinese, verify: chinese }).strict()).min(1).max(20),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(30),
  sourceIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  existingTaskId: z.string().min(1).max(160).optional(), existingIssueId: z.string().min(1).max(160).optional(), linkReason: chinese.optional(),
  candidate: z.object({ kind: z.enum(["research", "review"]).default("research"), weekStart: workflowWeekSchema,
    owner: z.string().trim().min(1).max(200), dueAt: stamp }).strict().optional(),
}).strict();
const manifestSchema = z.object({ schemaVersion: z.literal(1), period: z.object({ start: z.iso.date(), end: z.iso.date(),
  timezone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
}).strict().refine(value => value.start <= value.end, "周期结束不能早于开始"),
  sources: z.array(sourceSchema).min(1).max(200), findings: z.array(findingSchema).min(1).max(200),
}).strict();

function pageKey(value, domain) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || ![domain, "www." + domain].includes(url.hostname)
    || /^\/(?:api|console|admin|sign-in|sign-up)(?:\/|$)/iu.test(url.pathname)) throw Error("page_outside_public_website_scope");
  if (url.search || url.hash) throw Error("page_requires_verified_canonical_without_query_or_fragment");
  return `https://${domain}${url.pathname.replace(/\/+$/u, "") || "/"}`;
}
function safePage(value, domain) { try { return pageKey(value, domain); } catch { return null; } }
function findingKey(finding) {
  const anchor = finding.pageUrl ? ["page", pageKey(finding.pageUrl, finding.siteDomain)] : ["keyword", word(finding.keyword)];
  return "seo-finding:" + hash([finding.siteDomain, finding.country, finding.language, anchor, finding.category, finding.changeType, finding.problemKey]);
}
const marker = key => `结论 ${key} `;
const hasMarker = (record, key) => record.sourceRowId === key || (record.evidence ?? []).some(row => row.label.startsWith(marker(key)));
const clean = (kind, record) => (kind === "task" ? workflowTaskSchema : workflowIssueSchema).parse(Object.fromEntries(
  Object.entries(record).filter(([key]) => !["version", "recordedAt", "updatedAt"].includes(key))));
const evidenceId = row => hash([/^结论 (seo-finding:[a-f0-9]{64}) /u.exec(row.label)?.[1] ?? row.label,
  / sha256:([a-f0-9]{64})$/u.exec(row.label)?.[1] ?? null, row.url ?? null, row.artifact ?? null,
  / review-manifest sha256:/u.test(row.label) ? null : row.observedAt]);
function appendEvidence(previous, extra) {
  const seen = new Set(previous.map(evidenceId)), rows = [...previous];
  for (const row of extra) if (!seen.has(evidenceId(row))) { rows.push(row); seen.add(evidenceId(row)); }
  if (rows.length > 100) throw Error("evidence_limit_requires_manual_review");
  return rows;
}
function appendAction(previous, finding) {
  const addition = `〔复盘 ${finding.problemKey}〕${finding.recommendation}`;
  if (previous.includes(finding.recommendation)) return previous;
  const next = previous ? previous + "\n" + addition : addition;
  if (next.length > 3000) throw Error("next_action_limit_requires_manual_review");
  return next;
}
function validateSnapshot(snapshot) {
  if (snapshot?.storage !== "database" || !["tasks", "issues", "publications"].every(key => Array.isArray(snapshot[key]))) throw Error("complete_database_workflow_snapshot_required");
  for (const kind of ["tasks", "issues", "publications"]) {
    const ids = snapshot[kind].map(row => row.id);
    if (new Set(ids).size !== ids.length) throw Error("duplicate_workflow_record_identity");
  }
  for (const row of [...snapshot.tasks, ...snapshot.issues]) if (!Number.isInteger(row.version) || row.version < 1) throw Error("workflow_version_missing");
}
function savedPublications(snapshot) {
  const historical = (snapshot.historicalImports ?? []).flatMap(archive => (archive.publications ?? []).map(row => ({ ...row,
    siteDomain: archive.siteDomain, taskId: row.sourceTaskId, status: "published", historical: true, archiveId: archive.id })));
  return [...snapshot.publications, ...historical];
}
function identityMatches(record, finding) {
  if (record.siteDomain !== finding.siteDomain) return false;
  if (finding.country && record.country !== undefined && record.country !== finding.country) return false;
  if (finding.language && record.language !== undefined && record.language !== finding.language) return false;
  if (finding.pageUrl && record.pageUrl && safePage(record.pageUrl, record.siteDomain) !== pageKey(finding.pageUrl, finding.siteDomain)) return false;
  if (finding.keywordId && record.keywordId && record.keywordId !== finding.keywordId) return false;
  if (finding.keyword && record.keyword && word(record.keyword) !== word(finding.keyword)) return false;
  return true;
}
function compatibleKind(task, finding) {
  return { keyword_diagnosis: ["research"], content_refresh: ["optimization"], new_content: ["blog", "landing", "cluster"],
    technical_review: ["technical", "review"], measurement_review: ["research", "review"] }[finding.changeType].includes(task.kind);
}
function sameAnchor(record, finding) {
  return record.siteDomain === finding.siteDomain && (finding.pageUrl
    ? safePage(record.pageUrl, finding.siteDomain) === pageKey(finding.pageUrl, finding.siteDomain)
    : finding.keyword && word(record.keyword) === word(finding.keyword));
}
function sameKeywordContext(record, finding) {
  return record.siteDomain === finding.siteDomain && (finding.keywordId && record.keywordId === finding.keywordId
    || finding.keyword && record.keyword && word(record.keyword) === word(finding.keyword))
    && (!finding.country || !record.country || finding.country === record.country)
    && (!finding.language || !record.language || finding.language === record.language);
}
function chooseTask(finding, key, tasks, issues, publications) {
  if ((finding.existingTaskId || finding.existingIssueId) && !finding.linkReason) throw Error("explicit_task_link_reason_required");
  if (finding.existingIssueId && !issues.some(issue => issue.id === finding.existingIssueId)) throw Error("original_issue_missing");
  const sameKeyIssues = issues.filter(issue => issue.id === finding.existingIssueId || issue.id === key + ":issue" || hasMarker(issue, key)
    || issue.category === finding.category && sameAnchor(issue, finding) && word(issue.title) === word(finding.title)
      && word(issue.impact) === word(finding.problem) && word(issue.nextAction) === word(finding.recommendation)
      && tasks.some(task => task.id === issue.taskId && identityMatches(task, finding) && compatibleKind(task, finding)));
  const linked = new Set(sameKeyIssues.map(issue => issue.taskId).filter(Boolean));
  if (finding.existingTaskId) {
    linked.add(finding.existingTaskId);
  }
  for (const task of tasks) if (hasMarker(task, key)) linked.add(task.id);
  // Exact problem evidence can adopt an untagged original. A shared keyword or
  // URL alone cannot merge different intentions or different kinds of changes.
  for (const task of tasks) if (sameAnchor(task, finding) && identityMatches(task, finding) && compatibleKind(task, finding)
    && task.brief?.problem && word(task.brief.problem) === word(finding.problem)) linked.add(task.id);
  if (linked.size > 1) throw Error("multiple_original_tasks_require_review");
  if (linked.size) {
    const task = tasks.find(row => row.id === [...linked][0]);
    if (!task || task.deletedAt) throw Error("original_task_missing_or_deleted");
    if (task.channel && task.channel !== "website" || task.id === "api-paid-success-evidence-20261118" || /【用户已取消】/u.test(task.title)) throw Error("original_task_outside_authorized_scope");
    if (task.pageUrl) pageKey(task.pageUrl, task.siteDomain);
    if (!identityMatches(task, finding)) throw Error("original_task_identity_conflict");
    return { task, issues: sameKeyIssues };
  }
  const occupied = tasks.filter(task => !task.deletedAt && sameAnchor(task, finding) && identityMatches(task, finding) && compatibleKind(task, finding)
    && !["published", "verified", "observing"].includes(task.status));
  if (occupied.length) throw Error("existing_intent_requires_explicit_original_task_link");
  if (finding.changeType === "new_content" && tasks.some(task => !task.deletedAt && sameKeywordContext(task, finding)
    && !["published", "verified", "observing"].includes(task.status))) throw Error("existing_keyword_intent_requires_review");
  const shipped = publications.filter(row => ["published", "verified"].includes(row.status) && sameAnchor(row, finding) && identityMatches(row, finding));
  if (finding.changeType === "new_content" && publications.some(row => ["published", "verified"].includes(row.status) && sameKeywordContext(row, finding))) throw Error("published_keyword_intent_requires_review");
  if (finding.changeType === "new_content" && shipped.length) throw Error("published_intent_exists_review_original_page");
  return { task: null, issues: sameKeyIssues, relatedPublications: shipped };
}
function assertFindingScope(finding) {
  if (!finding.pageUrl && !finding.keyword) throw Error("page_or_original_keyword_required");
  if (finding.pageUrl) pageKey(finding.pageUrl, finding.siteDomain);
  if (finding.keywordId && !finding.keyword) throw Error("keyword_identity_missing_text");
  if ((finding.country === null) !== (finding.language === null)) throw Error("country_language_pair_incomplete");
  const allowed = finding.siteDomain === "flatkey.ai" ? { US: "en", JP: "ja", BR: "pt-BR", ES: "es-ES" }[finding.country] : "en";
  if (finding.language && finding.language !== allowed) throw Error("country_or_site_language_mismatch");
  if (finding.pageType === "blog" && finding.siteDomain === "rackrate.org") throw Error("rackrate_blog_outside_authorized_scope");
  if (finding.changeType === "new_content" && finding.siteDomain === "flatkey.ai" && finding.pageType !== "blog") throw Error("flatkey_new_landing_paused");
}

function buildReviewPlan(raw, snapshot, options = {}) {
  const manifest = manifestSchema.parse(raw); validateSnapshot(snapshot);
  const decisionResult = decisionArtifactSchema.safeParse(options.decisionArtifact);
  const now = options.now ?? new Date().toISOString(), sourceMap = new Map(manifest.sources.map(source => [source.id, source]));
  if (sourceMap.size !== manifest.sources.length) throw Error("duplicate_source_id");
  for (const source of manifest.sources) {
    if (Date.parse(source.observedAt) > Date.parse(now) + 300000) throw Error("future_source_timestamp");
    if (source.url && new URL(source.url).protocol !== "https:") throw Error("source_url_requires_https");
  }
  const tasks = snapshot.tasks.map(row => structuredClone(row)), issues = snapshot.issues.map(row => structuredClone(row));
  const publications = savedPublications(snapshot);
  const pending = new Map(), decisions = [];
  const queue = (kind, record) => {
    const original = snapshot[kind === "task" ? "tasks" : "issues"].find(row => row.id === record.id);
    const parsed = clean(kind, record), key = kind + ":" + record.id;
    if (original && hash(clean(kind, original)) === hash(parsed)) { pending.delete(key); return; }
    pending.set(key, { action: "save_" + kind, expectedVersion: original?.version ?? 0, record: parsed });
  };
  const grouped = new Map(), conflictingKeys = new Set();
  for (const finding of manifest.findings) {
    let key;
    try { assertFindingScope(finding); key = findingKey(finding); }
    catch (error) { decisions.push({ problemKey: finding.problemKey, status: "blocked", reason: error.message }); continue; }
    if (conflictingKeys.has(key)) continue;
    const existing = grouped.get(key);
    if (existing) {
      if (hash({ ...existing, sourceIds: [] }) !== hash({ ...finding, sourceIds: [] })) {
        grouped.delete(key); conflictingKeys.add(key); decisions.push({ findingKey: key, problemKey: finding.problemKey, status: "blocked", reason: "conflicting_same_finding_in_manifest" });
      } else existing.sourceIds = [...new Set([...existing.sourceIds, ...finding.sourceIds])];
    } else grouped.set(key, structuredClone(finding));
  }
  for (const [key, finding] of grouped) {
    // A failed finding never leaves partially planned task changes behind.
    const tasksBefore = structuredClone(tasks), issuesBefore = structuredClone(issues), pendingBefore = new Map(pending);
    try {
      const sources = finding.sourceIds.map(id => { const source = sourceMap.get(id); if (!source) throw Error("source_snapshot_not_found:" + id); return source; });
      if (!(options.verifiedSourceIds instanceof Set) || sources.some(source => !options.verifiedSourceIds.has(source.id))) throw Error("source_snapshot_hash_not_verified");
      if (!decisionResult.success) throw Error("decision_manifest_artifact_required");
      const decision = decisionResult.data;
      if (Date.parse(decision.observedAt) > Date.parse(now) + 300000) throw Error("future_decision_timestamp");
      const evidence = appendEvidence([], sources.map(source => ({ label: marker(key) + source.id + " sha256:" + source.sha256,
        artifact: source.artifact, observedAt: source.observedAt, ...(source.url ? { url: source.url } : {}) })));
      evidence.push({ label: marker(key) + "review-manifest sha256:" + decision.sha256, artifact: decision.artifact, observedAt: decision.observedAt });
      const selected = chooseTask(finding, key, tasks, issues, publications);
      if (selected.issues.length > 1) throw Error("multiple_original_issues_require_review");
      let task = selected.task, created = false;
      if (!task) {
        if (!finding.candidate) throw Error("candidate_owner_week_and_due_required");
        if (finding.keywordId) {
          const known = options.keywordInventory?.find(row => row.id === finding.keywordId && word(row.text) === word(finding.keyword)
            && row.active !== false && row.siteLinks?.some(link => link.siteDomain === finding.siteDomain && link.active));
          if (!known) throw Error("new_candidate_keyword_identity_not_verified");
        }
        const candidate = finding.candidate;
        const identityNote = finding.keywordId ? "" : "；先补证正式关键词与TopicMap身份，不创建或虚构身份";
        task = workflowTaskSchema.parse({ id: key + ":task", weekStart: candidate.weekStart, title: finding.title, siteDomain: finding.siteDomain, channel: "website",
          kind: candidate.kind, country: finding.country, language: finding.language, business: finding.business, pageType: finding.pageType,
          keyword: finding.keyword, keywordId: finding.keywordId, pageUrl: finding.pageUrl, owner: candidate.owner, dueAt: candidate.dueAt,
          status: "planned", dependencies: [], evidence, nextAction: (finding.recommendation + identityNote).slice(0, 3000), contentVersion: null,
          acceptanceCriteria: finding.acceptanceCriteria, research: null, approval: null, source: "automation", sourceRowId: key,
          brief: { reason: finding.problem, problem: finding.problem, plan: finding.recommendation, actions: finding.actions, evidence },
        });
        const briefProblems = taskNeedsChineseBrief(task) ? workflowTaskBriefProblems(task) : [];
        if (briefProblems.length) throw Error("task_brief_incomplete:" + briefProblems.join("；"));
        tasks.push(task); created = true;
      } else { task.evidence = appendEvidence(task.evidence, evidence); task.nextAction = appendAction(task.nextAction, finding); }
      queue("task", task);
      let issue = selected.issues[0];
      if (issue) {
        if (issue.taskId && issue.taskId !== task.id || issue.siteDomain !== finding.siteDomain || issue.category !== finding.category
          || issue.pageUrl && finding.pageUrl && safePage(issue.pageUrl, issue.siteDomain) !== pageKey(finding.pageUrl, finding.siteDomain)) throw Error("original_issue_identity_conflict");
        if (!issue.taskId) throw Error("original_issue_task_link_requires_review");
        issue.evidence = appendEvidence(issue.evidence, evidence);
        issue.nextAction = appendAction(issue.nextAction, finding);
      } else {
        issue = workflowIssueSchema.parse({ id: key + ":issue", weekStart: task.weekStart, siteDomain: finding.siteDomain, pageUrl: finding.pageUrl,
          title: finding.title, category: finding.category, priority: finding.priority, status: "open", owner: task.owner, taskId: task.id,
          firstSeenAt: [...sources].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))[0].observedAt,
          impact: `统计周期 ${manifest.period.start}—${manifest.period.end}（${manifest.period.timezone}）：${finding.problem}`.slice(0, 3000),
          nextAction: finding.recommendation, evidence, resolvedAt: null, resolutionEvidence: [] });
        issues.push(issue);
      }
      queue("issue", issue);
      decisions.push({ findingKey: key, problemKey: finding.problemKey, status: created ? "planned_candidate" : "linked_original", taskId: task.id, issueId: issue.id,
        taskStatus: task.status, issueStatus: issue.status, ...(finding.keywordId ? {} : { identityGap: "正式关键词/TopicMap身份仍需补证" }),
        ...(selected.relatedPublications?.length ? { relatedPublicationIds: selected.relatedPublications.map(row => row.id) } : {}) });
    } catch (error) {
      tasks.splice(0, tasks.length, ...tasksBefore); issues.splice(0, issues.length, ...issuesBefore);
      pending.clear(); for (const entry of pendingBefore) pending.set(...entry);
      decisions.push({ findingKey: key, problemKey: finding.problemKey, status: "blocked", reason: error.message });
    }
  }
  const commands = [...pending.values()].sort((a, b) => Number(a.action === "save_issue") - Number(b.action === "save_issue") || a.record.id.localeCompare(b.record.id))
    .map(command => ({ requestId: "content-review:" + hash(command), ...command }));
  const blocked = decisions.some(row => row.status === "blocked");
  const content = { schemaVersion: 1, period: manifest.period, sourceRevisions: manifest.sources.map(({ id, kind, sha256, observedAt }) => ({ id, kind, sha256, observedAt })),
    decisionRevision: decisionResult.success ? decisionResult.data : null, decisions, commands };
  return { ...content, planHash: hash(content), generatedAt: now, canApply: !blocked,
    summary: { findings: decisions.length, blocked: decisions.filter(row => row.status === "blocked").length, commands: commands.length,
      newCandidates: decisions.filter(row => row.status === "planned_candidate").length },
    workflowRead: { tasks: snapshot.tasks.length, issues: snapshot.issues.length, publications: snapshot.publications.length,
      historicalPublications: publications.length - snapshot.publications.length,
      publishedIntentCoverage: "saved_workflow_and_immutable_history_only_not_live_cms", hash: hash(snapshot) } };
}

function recordMatches(command, record) {
  try { return record?.version === command.expectedVersion + 1 && hash(clean(command.action.slice(5), record)) === hash(command.record); }
  catch { return false; }
}
async function applyReviewPlan(plan, api, options = {}) {
  if (!plan.canApply || !options.expectedPlanHash || options.expectedPlanHash !== plan.planHash) throw Error("reviewed_plan_hash_required_or_plan_blocked");
  if (hash(Object.fromEntries(["schemaVersion", "period", "sourceRevisions", "decisionRevision", "decisions", "commands"].map(key => [key, plan[key]]))) !== plan.planHash) throw Error("reviewed_plan_content_changed");
  if (!options.journal?.read || !options.journal?.write) throw Error("durable_submission_journal_required");
  if (typeof options.revalidate !== "function") throw Error("live_dedupe_revalidation_required");
  const receipts = [];
  for (const command of plan.commands) {
    if (!["save_task", "save_issue"].includes(command.action) || command.requestId !== "content-review:" + hash({ action: command.action,
      expectedVersion: command.expectedVersion, record: command.record })) throw Error("unsupported_or_changed_review_command");
    const kind = command.action.slice(5), before = await api.snapshot(); validateSnapshot(before);
    const current = before[kind === "task" ? "tasks" : "issues"].find(row => row.id === command.record.id);
    const historyMatch = async () => (await api.history(kind, command.record.id)).find(row => recordMatches(command, row));
    const journal = await options.journal?.read(command.requestId);
    if (journal && journal.commandHash !== hash(command)) throw Error("outbox_command_conflict");
    if (journal) {
      const matched = recordMatches(command, current) ? current : await historyMatch();
      if (!matched) return { status: "blocked", reason: journal.status === "rejected" ? "previous_request_rejected_repreview_required" : "previous_submission_not_confirmed_do_not_resend",
        requestId: command.requestId, ...(journal.diagnostic ? { diagnostic: journal.diagnostic } : {}), receipts };
      const recovered = { requestId: command.requestId, recordId: matched.id, version: matched.version, readBack: true, recovered: true,
        beforeVersion: journal.before?.version ?? 0, beforeHash: journal.before ? hash(journal.before) : null, afterHash: hash(matched) };
      await options.journal.write(command.requestId, { ...journal, status: "verified", after: matched, receipt: recovered });
      receipts.push(recovered);
      continue;
    }
    const rechecked = await options.revalidate(before);
    if (!rechecked.canApply || !rechecked.commands.some(row => hash(row) === hash(command))) return {
      status: "blocked", reason: "dedupe_context_changed_repreview_required", requestId: command.requestId, receipts };
    if ((current?.version ?? 0) !== command.expectedVersion) return { status: "blocked", reason: "version_conflict_repreview_required", requestId: command.requestId, receipts };
    const next = clean(kind, command.record);
    if (current) {
      const previous = clean(kind, current);
      if (hash({ ...previous, evidence: next.evidence, nextAction: next.nextAction }) !== hash(next)
        || !(next.nextAction === previous.nextAction || next.nextAction.startsWith(previous.nextAction + (previous.nextAction ? "\n" : "")))
        || previous.evidence.some(row => !next.evidence.some(item => evidenceId(item) === evidenceId(row)))) {
        return { status: "blocked", reason: "original_fields_or_evidence_changed", requestId: command.requestId, receipts };
      }
    } else if (kind === "task" && (!["research", "review"].includes(next.kind) || next.status !== "planned" || next.approval || next.contentVersion)
      || kind === "issue" && (!next.taskId || !before.tasks.some(row => row.id === next.taskId))) {
      return { status: "blocked", reason: "new_candidate_or_original_task_link_invalid", requestId: command.requestId, receipts };
    }
    // Re-read immediately before writing, and refuse a partially matching
    // original even if a caller supplied an old plan with the same version.
    await options.journal.write(command.requestId, { commandHash: hash(command), command, before: current ?? null, status: "attempting" });
    let response, failure;
    try { response = await api.save(command); }
    catch (error) { failure = error; }
    const after = await api.snapshot().catch(() => null);
    const saved = after?.[kind === "task" ? "tasks" : "issues"]?.find(row => row.id === command.record.id);
    let verified = recordMatches(command, saved) ? saved : null;
    if (!verified) verified = await historyMatch().catch(() => null);
    if (!verified) {
      const diagnostic = safeWorkflowError(failure), reason = diagnostic.rejected
        ? diagnostic.code === "version_conflict" ? "version_conflict_repreview_required" : "workflow_request_rejected"
        : "submission_outcome_unconfirmed_do_not_resend";
      await options.journal.write(command.requestId, { commandHash: hash(command), command, before: current ?? null,
        status: diagnostic.rejected ? "rejected" : "unknown", diagnostic, readBackChecked: Boolean(after) });
      return { status: "blocked", reason, requestId: command.requestId, diagnostic, receipts };
    }
    if (response && (response.storage !== "database" || response.stored !== true)) {
      const diagnostic = safeWorkflowError({ code: "production_persistence_unconfirmed", publicMessage: "服务端持久化回执不符合生产合同，请保留原请求并只读核对。" });
      await options.journal.write(command.requestId, { commandHash: hash(command), command, before: current ?? null, status: "unknown", diagnostic });
      return { status: "blocked", reason: "production_persistence_unconfirmed", requestId: command.requestId, diagnostic, receipts };
    }
    const receipt = { requestId: command.requestId, recordId: verified.id, version: verified.version, readBack: true,
      beforeVersion: current?.version ?? 0, beforeHash: current ? hash(current) : null, afterHash: hash(verified), ...(failure ? { recovered: true } : {}) };
    await options.journal.write(command.requestId, { commandHash: hash(command), command, before: current ?? null, after: verified, status: "verified", receipt });
    receipts.push(receipt);
  }
  return { status: "verified", planHash: plan.planHash, receipts };
}

module.exports = { manifestSchema, hash, word, pageKey, findingKey, appendEvidence, buildReviewPlan, applyReviewPlan, recordMatches, safeWorkflowError };
