const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { workflowTaskSchema, workflowWeek, workflowWeekSchema } = require("../src/lib/seo-workflow.ts");
const { prepareWorkflowMutation, workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
const now = new Date("2026-11-10T10:00:00Z"), evidence = [{ label: "来源及验收", url: "https://flatkey.ai/docs", observedAt: "2026-11-09T01:00:00Z" }];
const approval = { kind: "explicit", approvedBy: "负责人", approvedAt: "2026-11-10T07:00:00Z", contentVersion: "v1", evidence };
const task = (patch = {}) => ({ id: "task-1", weekStart: "2026-11-09", title: "API integration", siteDomain: "flatkey.ai", kind: "landing", country: "US", language: "en", business: "API", pageType: "integration", keyword: "model api integration", pageUrl: "https://flatkey.ai/integrations/test", owner: "AI", dueAt: "2026-11-10T06:00:00Z", status: "ready", dependencies: [], evidence, nextAction: "制作", contentVersion: "v1", acceptanceCriteria: ["实际接口可运行"], research: { volume: 20, kd: 10, businessValue: 3, exceptionReason: null, intent: "integrate", observedAt: "2026-11-09T01:00:00Z", evidence }, approval: null, source: "automation", ...patch });
function save(record, all = [], action = "save_task", actor = "human", expectedVersion = 0, requestId = "request-1") { return prepareWorkflowMutation({ requestId, action, expectedVersion, record }, all, actor, now); }
const row = result => ({ kind: result.kind, record: result.record });
const strip = value => Object.fromEntries(Object.entries(value).filter(([key]) => !["version", "updatedAt", "recordedAt", "verificationRecordedAt"].includes(key)));
const approved = (patch = {}) => row(save(task({ status: "review_pending", approval: null, ...patch })));
function publication(patch = {}) { return { id: "pub-1", taskId: "task-1", approvalId: "approval-1", approvalItemId: "item-1", weekStart: "2026-11-09", runId: "BLOG-2026-11-10", siteDomain: "flatkey.ai", pageUrl: "https://flatkey.ai/integrations/test", country: "US", language: "en", keyword: "model api integration", contentVersion: "v1", title: "Integration", kind: "landing", sourcePublicationId: null, publishedAt: "2026-11-10T09:58:00Z", verifiedAt: null, status: "published", liveCheck: null, evidence, failureReason: null, ...patch }; }
function verified(patch = {}) { return publication({ status: "verified", verifiedAt: "2026-11-10T09:59:00Z", liveCheck: { checkedAt: "2026-11-10T09:59:00Z", httpStatus: 200, canonicalUrl: "https://flatkey.ai/integrations/test", language: "en", contentVersion: "v1", contentMatched: true, linksChecked: true, sourceReceipt: "deploy-123", evidence }, ...patch }); }
function grant(first, pages = [publication()]) {
 const value={id:"approval-1",weekStart:"2026-11-09",siteDomain:"flatkey.ai",title:"Exact pages",requestedBy:"AI",submittedAt:"2026-11-10T06:00:00Z",status:"pending",supersedesApprovalIds:[],evidence,items:pages.map((page,index)=>({id:index===0?"item-1":"item-"+(index+1),taskId:first.record.id,operation:first.record.kind==="optimization"?"update":"new",pageUrl:page.pageUrl,language:page.language,contentVersion:page.contentVersion,baseContentVersion:first.record.kind==="optimization"?"v0":null,changeSummary:"Exact content",beforeSummary:first.record.kind==="optimization"?"Old content":null,afterSummary:"New content",draftUrl:"https://flatkey.ai/preview",previewUrl:"https://staging-website.flatkey.ai/review",previewContentVersion:page.contentVersion,evidence:[...evidence,{label:"Desktop screenshot",url:"https://staging-website.flatkey.ai/review.jpg",observedAt:"2026-11-10T06:00:00Z"},{label:"Mobile screenshot",url:"https://staging-website.flatkey.ai/mobile.jpg",observedAt:"2026-11-10T06:00:00Z"}]})),decisions:[]};
 const pending=prepareWorkflowMutation({requestId:"approval-submit",action:"save_approval",expectedVersion:0,record:value},[first],"collector",new Date("2026-11-10T06:00:00Z"));
 return row(prepareWorkflowMutation({requestId:"approval-decide",action:"save_approval",expectedVersion:1,record:{...value,status:"approved",decisions:[{id:"decision-1",itemIds:value.items.map(item=>item.id),decision:"approved",decidedBy:"负责人",decidedAt:"2026-11-10T07:00:00Z",note:"Reviewed exact versions",evidence}]}},[first,row(pending)],"human",new Date("2026-11-10T07:00:00Z")));
}
const baseline = { capturedAt: "2026-11-09T01:00:00Z", periodStart: "2026-11-01", periodEnd: "2026-11-07", source: "GSC", sourceDate: "2026-11-08", timezone: "America/Los_Angeles", country: "US", device: "all", clicks: 0, impressions: 100, ctr: 0, averagePosition: 15, organicVisits: null, registrations: null, activation: null, payment: null, dataStatus: "complete", evidence };

test("working weeks are Monday-Sunday even across Friday reporting cutoff", () => {
  assert.equal(workflowWeek(new Date("2026-11-13T12:00Z")), "2026-11-09");
  assert.equal(workflowWeekSchema.safeParse("2026-11-13").success, false);
  assert.equal(workflowSnapshot([], { week: "next" }, "database", now).weekStart, "2026-11-16");
});
test("country language and Chinese keyword mismatch fail without reassigning countries", () => {
  assert.equal(workflowTaskSchema.safeParse(task({ country: "BR", language: "es-ES" })).success, false);
  assert.equal(workflowTaskSchema.safeParse(task({ keyword: "便宜模型接口" })).success, false);
  assert.equal(workflowTaskSchema.safeParse(task({ country: "JP", language: "ja", keyword: "生成AI API" })).success, true);
});
test("volume/KD missing or below threshold need documented business exception", () => {
  const value = task(); value.research.volume = 0;
  assert.throws(() => save(value), /例外/);
  value.research.exceptionReason = "低量但已有企业采购询问";
  assert.equal(save(value).record.status, "ready");
  assert.throws(() => save(task({ research: null })), /关键词研究/);
});
test("dependencies must exist, be acyclic, and be verified before production", () => {
  assert.throws(() => save(task({ dependencies: ["missing"] })), /不存在/);
  const first = row(save(task({ id: "a", status: "planned" })));
  const second = row(save(task({ id: "b", keyword: "other term", status: "planned", dependencies: ["a"] }), [first]));
  assert.throws(() => save({ ...strip(first.record), dependencies: ["b"] }, [first, second], "save_task", "human", 1), /循环/);
  assert.throws(() => save({ ...strip(second.record), status: "drafting" }, [first, second], "save_task", "human", 1), /前置任务/);
});
test("stale writers cannot overwrite reviewed human fields or bypass version checks", () => {
  const first = row(save(task({ source: "human" })));
  assert.throws(() => save({ ...strip(first.record), owner: "other" }, [first], "save_task", "collector", 1), /人工确认/);
  assert.throws(() => save(strip(first.record), [first], "save_task", "human", 0), /其他任务/);
});
test("new task approved status requires a real page approval and legacy approval fields cannot be newly forged", () => {
  for (const actor of ["collector", "human"]) for (const kind of ["explicit", "standing_new_blog"]) {
    assert.throws(() => save(task({ kind: "blog", status: "approved", approval: { ...approval, kind } }), [], "save_task", actor), /只保留历史/);
  }
  assert.throws(() => save(task({ status: "approved", approval: null })), /逐页审批/);
  assert.throws(() => save(task({ kind: "technical", status: "approved", approval: null })), /逐页审批/);
  const first=approved(), access=grant(first);
  assert.equal(save({...strip(first.record),status:"approved"},[first,access],"save_task","collector",1).record.status,"approved");
  const historical={...first,record:{...first.record,status:"approved",approval}};
  assert.equal(save(strip(historical.record),[historical],"save_task","human",1).record.status,"approved");
  assert.throws(()=>save({...strip(historical.record),contentVersion:"v2"},[historical],"save_task","human",1),/逐页审批/);
});
test("a task cannot count as live solely because its draft was approved", () => {
  const first = approved();
  assert.throws(() => save({ ...strip(first.record), status: "verified" }, [first], "save_task", "human", 1), /发布记录/);
  assert.throws(() => save(publication(), [row(save(task()))], "record_publication"), /尚未批准|缺少已提交/);
});
test("verified publications require matching canonical, language, content, receipt and time", () => {
  const first = approved();
  assert.throws(() => save({ ...verified(), liveCheck: null }, [first], "record_publication"), /验收上线/);
  const value = verified(); value.liveCheck.canonicalUrl = "https://flatkey.ai/elsewhere";
  assert.throws(() => save(value, [first], "record_publication"), /不匹配/);
  assert.throws(() => save(verified({ publishedAt: "2026-12-01T01:00:00Z", verifiedAt: "2026-12-01T02:00:00Z", liveCheck: { ...verified().liveCheck, checkedAt: "2026-12-01T02:00:00Z" } }), [first], "record_publication"), /未来/);
});
test("publish and first verification are distinct immutable receipt times", () => {
  const first = approved(), access = grant(first), published = row(save(publication(), [first, access], "record_publication"));
  assert.equal(published.record.verificationRecordedAt, null);
  const later = prepareWorkflowMutation({ requestId: "verify-1", action: "record_publication", expectedVersion: 1, record: verified() }, [first, access, published], "collector", new Date("2026-11-11T01:00:00Z"));
  assert.equal(later.record.publishedAt, "2026-11-10T09:58:00Z");
  assert.equal(later.record.verificationRecordedAt, "2026-11-11T01:00:00.000Z");
  assert.equal(later.record.recordedAt, published.record.recordedAt);
  assert.throws(() => save({ ...strip(later.record), verifiedAt: "2026-11-10T09:59:30Z" }, [first, access, row(later)], "record_publication", "human", 2), /不可撤写/);
});
test("same canonical/content version cannot double count under a different receipt ID", () => {
  const first = approved(), access = grant(first), existing = row(save(verified(), [first, access], "record_publication"));
  assert.throws(() => save(verified({ id: "pub-duplicate" }), [first, access, existing], "record_publication"), /已有发布记录|已有上线版本/);
});
test("source and translation counts are separate and translations require source linkage", () => {
  const first = approved({ kind: "blog", pageType: "blog" });
  const ptPage=verified({language:"pt-BR",pageUrl:"https://flatkey.ai/pt/integrations/test",contentVersion:"v1-pt"});
  const access=grant(first,[publication(),ptPage]);
  const source = row(save(verified({ kind: "source_blog" }), [first,access], "record_publication"));
  const translation = verified({ id: "translation-1", approvalItemId:"item-2", kind: "translation", country: null, keyword: null, language: "pt-BR", pageUrl: "https://flatkey.ai/pt/integrations/test", sourcePublicationId: "pub-1", contentVersion: "v1-pt", liveCheck: { ...verified().liveCheck, canonicalUrl: "https://flatkey.ai/pt/integrations/test", language: "pt-BR", contentVersion: "v1-pt" } });
  const translated = row(save(translation, [first, access, source], "record_publication"));
  const snapshot = workflowSnapshot([first, source, translated], {}, "database", now);
  assert.equal(snapshot.summary.verifiedSourceBlogs, 1); assert.equal(snapshot.summary.verifiedTranslations, 1);
  assert.throws(() => save({ ...translation, sourcePublicationId: "missing" }, [first, access], "record_publication"), /关联同任务/);
});
test("optimization baseline cannot be overwritten; a draft is never a live optimization", () => {
  const first = approved({ kind: "optimization" });
  const record = { id: "opt-1", taskId: "task-1", weekStart: "2026-11-09", siteDomain: "flatkey.ai", pageUrl: "https://flatkey.ai/integrations/test", country: "US", language: "en", keyword: "model api integration", status: "review_pending", objective: "Improve integration instructions", baseline, changes: [], observations: [], evidence };
  const optimization = row(save(record, [first], "save_optimization"));
  assert.throws(() => save({ ...record, baseline: { ...baseline, clicks: 10 } }, [first, optimization], "save_optimization", "human", 1), /不可覆盖/);
  assert.throws(() => save({ ...record, status: "verified" }, [first, optimization], "save_optimization", "human", 1), /不能计为上线/);
  assert.equal(workflowSnapshot([first, optimization], {}, "database", now).summary.optimizedPages, 0);
});
test("reviewed weekly plan declares gaps instead of reducing fixed output targets", () => {
  const plan = { id: "plan-2026-11-16", weekStart: "2026-11-16", title: "Next week", status: "reviewed", taskIds: [], owner: "AI", preparedAt: now.toISOString(), reviewedAt: now.toISOString(), reviewedBy: "AI verified", targets: { landing: 5, apiBlogs: 10, gpuBlogs: 25, optimizedPages: 5, blogLanguages: {en:14,ja:7,"pt-BR":7,"es-ES":7} }, gaps: [], evidence, notes: "" };
  assert.throws(() => save(plan, [], "save_plan"), /还缺/);
  plan.gaps = Object.entries({...plan.targets,blogLanguages:undefined,blogEn:14,blogJa:7,blogPt:7,blogEs:7}).filter(([,count])=>typeof count==="number").map(([category, count]) => ({ category, count, reason: "缺研究证据" }));
  assert.equal(save(plan, [], "save_plan").record.targets.landing, 5);
});
test("page history spans working weeks and unresolved issues stay visible", () => {
  const first = approved();
  const issue = row(save({ id: "issue-1", weekStart: "2026-11-02", siteDomain: "flatkey.ai", pageUrl: first.record.pageUrl, title: "缺证据", category: "content", priority: "P2", status: "open", owner: "AI", taskId: "task-1", firstSeenAt: "2026-11-02T01:00:00Z", impact: "旧页待证据", nextAction: "核实", evidence, resolvedAt: null, resolutionEvidence: [] }, [], "save_issue"));
  const snapshot = workflowSnapshot([first, issue], { week: "next", pageUrl: first.record.pageUrl }, "database", now);
  assert.equal(snapshot.tasks.length, 1); assert.equal(snapshot.issues.length, 1); assert.equal(snapshot.plan, null);
});
test("same keyword page country cannot create duplicate weekly production tasks", () => {
  const first = row(save(task()));
  assert.throws(() => save(task({ id: "task-copy", keyword: "MODEL  API INTEGRATION" }), [first]), /已有任务/);
});
