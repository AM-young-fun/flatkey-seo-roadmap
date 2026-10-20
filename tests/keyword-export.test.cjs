const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
let state, session = true, reads = 0;
const project = (row, select) => row ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : null;
const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
const db = {
  keywordExportApiKey: {
    create: async ({ data, select }) => { const row = { id: `key-${state.keys.length}`, createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...data }; state.keys.push(row); return project(row, select); },
    findMany: async ({ select }) => { reads++; return state.keys.map(row => project(row, select)); },
    findFirst: async ({ where, select }) => { reads++; return project(state.keys.find(row => matches(row, where)), select); },
    updateMany: async ({ where, data }) => { let count = 0; for (const row of state.keys) if (matches(row, where)) { Object.assign(row, data); count++; } return { count }; },
  },
  seoSite: { findMany: async ({ where }) => { reads++; return state.sites.filter(row => row.active && (typeof where.domain === "string" ? row.domain === where.domain : where.domain.in.includes(row.domain))); } },
  siteKeyword: { findMany: async ({ where }) => {
    reads++;
    assert.equal(where.active, true); assert.deepEqual(where.keyword, { active: true });
    assert.deepEqual(where.pool, { in: ["FORMAL", "RESEARCH"] });
    return state.members.filter(row => where.siteDomain.in.includes(row.siteDomain) && row.active && row.keyword.active
      && where.pool.in.includes(row.pool));
  } },
  keywordContentTask: { findMany: async ({ where }) => state.tasks.filter(row => where.siteDomain.in.includes(row.siteDomain) && !where.status.notIn.includes(row.status)) },
  keywordSourceRow: { findMany: async ({ where }) => state.audits.filter(row => where.siteDomain.in.includes(row.siteDomain) && where.rowKey.in.includes(row.rowKey)) },
};
mock("src/lib/prisma.ts", { prisma: db });
mock("src/lib/services/serp-results.ts", { loadSerpTasks: async () => { if (state.serpFailure) throw new Error("database unavailable"); return state.serpTasks; } });
mock("src/lib/auth.ts", { AUTH_COOKIE_NAME: "seo_rank_auth", isAuthEnabled: () => Boolean(process.env.LOGIN_PWD), isValidAuthToken: async value => value === "valid-session" });
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => ({ get: () => session ? { value: "valid-session" } : undefined }) } };
const crypto = require("../src/lib/export-api-key-crypto.ts");
const service = require("../src/lib/services/export-api-keys.ts");
const { loadContentOpportunities } = require("../src/lib/services/content-opportunities.ts");
const management = require("../src/app/api/api-keys/route.ts");
const endpoint = require("../src/app/api/keywords/content-opportunities/route.ts");
const { proxy } = require("../src/proxy.ts");
const { NextRequest } = require("next/server");
const member = (id, extra = {}) => ({ siteDomain: "flatkey.ai", keywordId: id, pool: "FORMAL", active: true, topicId: "topic", mappingStatus: "NEEDS_BUILD", targetUrls: [], candidateUrls: [], keyword: { text: id, active: true, defaultVolume: 100 }, ...extra });
const task = (id, words, extra = {}) => ({ id, siteDomain: "flatkey.ai", type: "NEW", status: "TODO", plannedUrl: `https://flatkey.ai/blog/${id}`, keywords: words, targetUrls: [], ...extra });
const audit = (id, snapshot, siteDomain = "flatkey.ai") => ({ siteDomain, rowKey: `keyword:${id}`, snapshot: { keywordId: id, keyword: id, ...snapshot } });
const post = body => new Request("https://example.test/api/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const request = (secret, query = "", header = "X-API-Key") => new Request(`https://example.test/api/keywords/content-opportunities${query}`, { headers: secret ? { [header]: header === "Authorization" ? `Bearer ${secret}` : secret } : {} });
beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://unused.invalid/export"; process.env.LOGIN_PWD = "test-login-password";
  session = true; reads = 0;
  state = { keys: [], sites: [{ domain: "flatkey.ai", active: true }, { domain: "rackrate.org", active: true }, { domain: "modelfit.cc", active: false }], members: [], tasks: [], audits: [], serpTasks: [] };
});

test("random export keys are encrypted at rest and cannot be decrypted with another login password", () => {
  const first = crypto.generateExportApiKey(), second = crypto.generateExportApiKey();
  assert.match(first, /^seo_export_[A-Za-z0-9_-]{43}$/); assert.notEqual(first, second);
  const encrypted = crypto.encryptExportApiKey(first);
  assert.ok(!encrypted.includes(first)); assert.equal(crypto.decryptExportApiKey(encrypted), first);
  assert.equal(crypto.hashExportApiKey(first).length, 64);
  process.env.LOGIN_PWD = "different";
  assert.throws(() => crypto.decryptExportApiKey(encrypted));
});

test("management requires a real login, rejects cross-origin mutations, validates scopes, and does not expose stored credentials", async () => {
  session = false;
  assert.equal((await management.GET()).status, 401);
  assert.equal((await management.POST(post({ action: "create", name: "denied" }))).status, 401);
  assert.equal(reads, 0); assert.equal(state.keys.length, 0);
  session = true; delete process.env.LOGIN_PWD;
  assert.equal((await management.GET()).status, 401);
  process.env.LOGIN_PWD = "test-login-password";
  const crossOrigin = post({ action: "create", name: "denied" }); crossOrigin.headers.set("Origin", "https://other.test");
  assert.equal((await management.POST(crossOrigin)).status, 403);
  assert.equal((await management.POST(post({ action: "create", name: "invalid", siteDomain: "other.test" }))).status, 400);
  assert.equal((await management.POST(post({ action: "create", name: "  " }))).status, 400);
  const response = await management.POST(post({ action: "create", name: "content", siteDomain: "flatkey.ai" }));
  assert.equal(response.status, 201); assert.match(response.headers.get("cache-control"), /no-store/);
  const { key, secret } = await response.json();
  assert.equal(state.keys[0].keyHash, crypto.hashExportApiKey(secret));
  const list = await (await management.GET()).json();
  assert.equal(list.keys[0].id, key.id);
  for (const value of [secret, "keyHash", "encryptedKey"]) assert.ok(!JSON.stringify(list).includes(value));
  assert.equal((await (await management.POST(post({ action: "reveal", id: key.id }))).json()).secret, secret);
});

test("exports require their dedicated key even with page sessions; revoked keys and ambiguous credentials are rejected", async () => {
  assert.equal((await endpoint.GET(request())).status, 401);
  assert.equal((await endpoint.GET(request("test-login-password"))).status, 401);
  const { key, secret } = await service.mutateExportApiKey({ action: "create", name: "export", siteDomain: null });
  const conflicting = request(secret); conflicting.headers.set("Authorization", "Bearer different");
  assert.equal((await endpoint.GET(conflicting)).status, 401);
  const malformed = request(secret); malformed.headers.set("Authorization", "Basic not-bearer");
  assert.equal((await endpoint.GET(malformed)).status, 401);
  assert.equal((await endpoint.GET(request(null, `?apiKey=${secret}`))).status, 401);
  const response = await endpoint.GET(request(secret, "", "Authorization"));
  assert.equal(response.status, 200); assert.ok(state.keys[0].lastUsedAt instanceof Date);
  assert.deepEqual((await response.json()).rows, []);
  await management.POST(post({ action: "revoke", id: key.id }));
  assert.equal((await endpoint.GET(request(secret))).status, 401);
  assert.equal((await management.POST(post({ action: "reveal", id: key.id }))).status, 404);
});

test("site-scoped keys default to their site, cannot escalate, and both export formats are private", async () => {
  state.members = [member("flatkey"), member("rackrate", { siteDomain: "rackrate.org" }), member("disabled", { siteDomain: "modelfit.cc" })];
  const { secret } = await service.mutateExportApiKey({ action: "create", name: "scoped", siteDomain: "rackrate.org" });
  state.serpTasks = noRankTasks(state.members);
  const response = await endpoint.GET(request(secret));
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /private, no-store/);
  const json = await response.json(); assert.equal(json.siteDomain, "rackrate.org"); assert.equal(json.total, 1); assert.equal(json.rows[0].keyword, "rackrate");
  assert.equal((await endpoint.GET(request(secret, "?siteDomain=flatkey.ai"))).status, 403);
  assert.equal((await endpoint.GET(request(secret, "?siteDomain=other.test"))).status, 400);
  assert.equal((await endpoint.GET(request(secret, "?siteDomain="))).status, 400);
  assert.equal((await endpoint.GET(request(secret, "?format=xml"))).status, 400);
  const csv = await endpoint.GET(request(secret, "?format=csv"));
  assert.equal(csv.status, 200); assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.headers.get("content-disposition"), /content-opportunities-rackrate.org.csv/);
  assert.match(await csv.text(), /rackrate/);
});

test("active targets and candidates are eligible without topics, regardless of page identity and task states", async () => {
  state.members = [member("unassigned"), member("todo"), member("in-progress"), member("done"), member("blocked"), member("unknown"), member("expansion-task"),
    member("expand"), member("verified"), member("missing"), member("needs-review"), member("mismatch"), member("legacy", { mappingStatus: "UNMAPPED" }),
    member("research", { pool: "RESEARCH" }), member("archived", { pool: "ARCHIVED" }), member("merged", { pool: "MERGED" }),
    member("inactive", { active: false }), member("inactive-word", { keyword: { text: "inactive-word", active: false, defaultVolume: 10 } }),
    member("candidate", { candidateUrls: ["https://flatkey.ai/candidate"] }), member("bad-identity"), member("retired"),
    member("todo", { siteDomain: "rackrate.org", keywordId: "rack-word" }), member("no-topic", { siteDomain: "rackrate.org", topicId: null })];
  state.audits = [audit("expand", { verdict: "CONTENT_GAP" }), audit("verified", { verdict: "VERIFIED" }), audit("missing", { verdict: "MISSING" }),
    audit("needs-review", { verdict: "REVIEW" }), audit("mismatch", { verdict: "MISMATCH" }), audit("bad-identity", { keyword: "different", verdict: "NO_MATCH" })];
  state.tasks = [task("t1", [" TODO "]), task("t2", ["in-progress"], { status: "IN_PROGRESS" }), task("t3", ["done"], { status: "DONE" }), task("t4", ["blocked"], { status: "BLOCKED" }),
    task("t5", ["unknown"], { status: "UNKNOWN" }), task("t6", ["expansion-task"], { type: "EXPAND" }), task("t7", ["retired"], { status: "MERGED" }), task("t8", ["retired"], { status: "RESTORED" })];
  state.serpTasks = noRankTasks(state.members);
  const rows = await loadContentOpportunities(null);
  assert.deepEqual(rows.filter(row => row.siteDomain === "flatkey.ai").map(row => row.keyword).sort(), ["bad-identity", "blocked", "candidate", "done", "expand", "expansion-task", "in-progress", "legacy", "mismatch", "missing", "needs-review", "research", "retired", "todo", "unassigned", "unknown", "verified"]);
  assert.ok(rows.some(row => row.keyword === "no-topic"));
  assert.equal(rows.find(row => row.keyword === "todo" && row.siteDomain === "flatkey.ai").taskStatus, "TODO");
  assert.equal(rows.find(row => row.siteDomain === "rackrate.org").taskStatus, "UNASSIGNED");
  assert.equal(rows.find(row => row.keyword === "unassigned").taskStatus, "UNASSIGNED");
  assert.equal(rows.find(row => row.keyword === "in-progress").taskStatus, "IN_PROGRESS");
  assert.equal(rows.find(row => row.keyword === "done").taskStatus, "DONE");
  assert.ok(rows.every(row => row.opportunityStatus === "OUTSIDE_TOP100" && row.isTop100 === false));
});

test("shared-page progress is returned so callers can avoid duplicate work; valid build plans are retained", async () => {
  const plan = { originalVerdict: "MISMATCH", action: "BUILD", pageUrls: [], previousPageUrl: null, plannedPageUrl: "https://flatkey.ai/blog/shared", proposedTitle: "New content guide",
    requirements: ["Explain setup requirements.", "Include runnable code examples.", "Add primary source references."], acceptance: ["Examples can be reproduced.", "Sources can be verified."] };
  state.members = [member("shared"), member("planned")];
  state.audits = [audit("shared", { verdict: "NO_MATCH", workPlan: plan }), audit("planned", { verdict: "NO_MATCH", workPlan: { ...plan, plannedPageUrl: "https://flatkey.ai/blog/new" } })];
  state.tasks = [task("existing", ["another keyword"], { status: "IN_PROGRESS", plannedUrl: "https://flatkey.ai/blog/shared/" })];
  state.serpTasks = noRankTasks(state.members);
  const rows = await loadContentOpportunities(null);
  assert.equal(rows.length, 2);
  const planned = rows.find(row => row.keyword === "planned");
  assert.equal(planned.proposedTitle, plan.proposedTitle);
  assert.deepEqual(planned.requirements, plan.requirements); assert.deepEqual(planned.plannedUrls, ["https://flatkey.ai/blog/new"]);
  assert.equal(rows.find(row => row.keyword === "shared").taskStatus, "IN_PROGRESS");
});

test("CSV escapes quotes, newlines and spreadsheet formulas", () => {
  const { opportunitiesCsv } = require("../src/lib/keyword-export.ts");
  const csv = opportunitiesCsv([{ keywordId: "id", keyword: ' =SUM(1,2)\n"quoted"', siteDomain: "flatkey.ai", pool: "FORMAL", searchVolume: 1, hasPage: true, pageStatus: "MATCHED", pageUrls: ["https://flatkey.ai/guide"], candidateUrls: [], currentRank: null, isTop100: false, opportunityStatus: "OUTSIDE_TOP100", recommendedAction: "OPTIMIZE", rankingEvidence: [], taskStatus: "UNASSIGNED", taskStatuses: [], taskIds: [], plannedUrls: [], proposedTitle: null, requirements: [], acceptance: [] }]);
  assert.ok(csv.startsWith("\uFEFF")); assert.match(csv, /"' =SUM\(1,2\)\n""quoted"""/);
  assert.match(csv, /是否有页面/); assert.match(csv, /是否前100/); assert.match(csv, /"","否","OUTSIDE_TOP100"/);
});

function serpTask(id, rank, { region = "US", siteDomain = "flatkey.ai", keywordId = id, keyword = id, state: taskState = "COMPLETE", normalized = {}, date = "2026-10-19T08:00:00Z" } = {}) {
  return { id: `${id}-${region}-${date}`, keyword, region, targetsJson: [{ siteDomain, keywordId }], state: taskState, runId: `run-${date}`, providerTaskId: "provider", errorCode: null,
    runCreatedAt: date, updatedAt: date, checkedAt: date, normalizedJson: { normalizationVersion: 2, captureComplete: true, queryStatus: "EXACT", rankingVerified: true,
      completeDepth: true, coveredThroughRank: 100, organicCount: 100, organicResults: rank === null ? [] : [{ url: `https://${siteDomain}/guide`, domain: siteDomain, rankGroup: rank }], ...normalized } };
}

function noRankTasks(members, regions = ["US", "JP", "ES", "BR"]) {
  return members.flatMap(member => regions.map(region => serpTask(member.keywordId, null, { region, siteDomain: member.siteDomain, keywordId: member.keywordId, keyword: member.keyword.text })));
}

test("all top100 ranks are excluded, including 50, 51 and exactly 100; unmeasured words are retained", async () => {
  state.members = [member("rank1"), member("rank50"), member("rank51"), member("rank100"), member("outside"), member("unmeasured")];
  state.serpTasks = [serpTask("rank1", 1), serpTask("rank50", 50), serpTask("rank51", 51), serpTask("rank100", 100), serpTask("outside", null)];
  const rows = await loadContentOpportunities(null, "US");
  assert.deepEqual(rows.map(row => row.keyword).sort(), ["outside", "unmeasured"]);
  assert.equal(rows.find(row => row.keyword === "unmeasured").isTop100, null);
  const outside = rows.find(row => row.keyword === "outside");
  assert.equal(outside.currentRank, null); assert.equal(outside.isTop100, false); assert.equal(outside.hasPage, false);
  assert.equal(outside.recommendedAction, "BUILD"); assert.equal(outside.opportunityStatus, "OUTSIDE_TOP100");
});

test("bound, unbound and unmeasured keywords are exported regardless of task completion", async () => {
  state.members = [member("existing", { mappingStatus: "READY", targetUrls: ["https://flatkey.ai/blog/existing"] }), member("unbound"),
    member("unmeasured", { mappingStatus: "READY", targetUrls: ["https://flatkey.ai/blog/unmeasured"] })];
  state.tasks = [task("done", ["existing"], { type: "EXPAND", status: "DONE", plannedUrl: "https://flatkey.ai/blog/existing" })];
  state.serpTasks = [serpTask("existing", null), serpTask("unbound", null)];
  const rows = await loadContentOpportunities(null, "US");
  assert.deepEqual(rows.map(row => row.keyword).sort(), ["existing", "unbound", "unmeasured"]);
  assert.equal(rows.find(row => row.keyword === "unmeasured").opportunityStatus, "NEEDS_VERIFICATION");
  const existing = rows.find(row => row.keyword === "existing");
  assert.equal(existing.hasPage, true); assert.deepEqual(existing.pageUrls, ["https://flatkey.ai/blog/existing"]);
  assert.equal(existing.isTop100, false); assert.equal(existing.recommendedAction, "OPTIMIZE"); assert.equal(existing.taskStatus, "DONE");
  assert.equal(rows.find(row => row.keyword === "unbound").hasPage, false);
});

test("blog exports exclude entire keywords bound or planned to other pages in JSON and CSV", async () => {
  const bound = (id, urls, extra = {}) => member(id, { mappingStatus: "READY", targetUrls: urls, ...extra });
  state.members = [bound("blog-only", ["https://flatkey.ai/blog/guide?from=seo#intro"]),
    bound("localized-blog", ["https://flatkey.ai/ja/blog/guide/"]), bound("cloud-blog", ["https://flatkey.ai/cloud/blog/gpu-guide"]),
    bound("localized-cloud-blog", ["https://flatkey.ai/zh/cloud/blog/gpu-guide"]),
    bound("model-page", ["https://flatkey.ai/models/gpt"]), bound("home-page", ["https://flatkey.ai/"]),
    bound("docs-page", ["https://flatkey.ai/docs/guide"]), bound("blog-index", ["https://flatkey.ai/blog"]),
    bound("fake-blog-path", ["https://flatkey.ai/docs/blog/guide"]),
    bound("mixed-bindings", ["https://flatkey.ai/blog/guide", "https://flatkey.ai/tools"]),
    bound("hidden-product-binding", ["https://flatkey.ai/models/old"], { mappingStatus: "NEEDS_BUILD" }),
    member("planned-product"), member("task-product"), member("task-target-product"), member("retired-product-task"),
    member("unbound-candidate", { pool: "RESEARCH", candidateUrls: ["https://flatkey.ai/models/candidate"] })];
  state.audits = [audit("hidden-product-binding", { verdict: "MISSING" }), audit("planned-product", { verdict: "NO_MATCH", workPlan: {
    originalVerdict: "MISMATCH", action: "BUILD", pageUrls: [], previousPageUrl: null, plannedPageUrl: "https://flatkey.ai/models/new",
    proposedTitle: "New model product page", requirements: ["Document supported inputs.", "Document model pricing.", "Include model limits."],
    acceptance: ["Pricing can be verified.", "Inputs can be reproduced."] } })];
  state.tasks = [task("product", ["task-product"], { plannedUrl: "https://flatkey.ai/models/new" }),
    task("product-target", ["task-target-product"], { targetUrls: ["https://flatkey.ai/docs/guide"] }),
    task("retired-product", ["retired-product-task"], { plannedUrl: "https://flatkey.ai/models/old", status: "MERGED" })];
  state.serpTasks = noRankTasks(state.members, ["US"]);
  const { secret } = await service.mutateExportApiKey({ action: "create", name: "blog export", siteDomain: "flatkey.ai" });
  const response = await endpoint.GET(request(secret, "?region=US"));
  assert.equal(response.status, 200);
  const body = await response.json();
  const expected = ["blog-only", "cloud-blog", "localized-blog", "localized-cloud-blog", "retired-product-task", "unbound-candidate"];
  assert.deepEqual(body.rows.map(row => row.keyword).sort(), expected);
  assert.equal(body.total, expected.length);
  assert.equal(body.rows.find(row => row.keyword === "blog-only").hasPage, true);
  assert.equal(body.rows.find(row => row.keyword === "unbound-candidate").hasPage, false);
  const csv = await (await endpoint.GET(request(secret, "?region=US&format=csv"))).text();
  for (const row of state.members) assert.equal(csv.includes(`"${row.keywordId}"`), expected.includes(row.keywordId), row.keywordId);
});

test("all-region exports exclude any positive rank, retain incomplete coverage, and isolate sites", async () => {
  state.members = [member("regional"), member("regional", { keywordId: "rack-id", siteDomain: "rackrate.org" }), member("incomplete-markets")];
  state.serpTasks = [...noRankTasks(state.members.slice(0, 2)), serpTask("regional", 100, { region: "JP", date: "2026-10-19T09:00:00Z" }), serpTask("incomplete-markets", null)];
  const rows = await loadContentOpportunities(null);
  assert.deepEqual(rows.map(row => row.keywordId).sort(), ["incomplete-markets", "rack-id"]);
  const rack = rows.find(row => row.keywordId === "rack-id");
  assert.equal(rack.rankingEvidence.length, 4); assert.ok(rack.rankingEvidence.every(row => row.status === "OUTSIDE_TOP100"));
  assert.equal(rows.find(row => row.keywordId === "incomplete-markets").isTop100, null);
  const us = await loadContentOpportunities(null, "US");
  assert.deepEqual(us.map(row => row.keywordId).sort(), ["incomplete-markets", "rack-id", "regional"]);
});

test("missing, failed, corrected, shallow and queued results remain exported with their actual unknown states", async () => {
  state.members = [member("failed"), member("corrected"), member("shallow"), member("partial50"), member("partial-hit"), member("queued"), member("unmeasured"), member("outside")];
  state.serpTasks = [serpTask("failed", null, { date: "2026-10-18T08:00:00Z" }), serpTask("failed", null, { state: "FAILED" }),
    serpTask("corrected", 3, { normalized: { queryStatus: "AUTOCORRECTED" } }),
    serpTask("shallow", null, { normalized: { completeDepth: false, coveredThroughRank: 30 } }),
    serpTask("partial50", null, { normalized: { completeDepth: false, coveredThroughRank: 50 } }),
    serpTask("partial-hit", 50, { normalized: { completeDepth: false, coveredThroughRank: 50 } }), serpTask("queued", null, { state: "QUEUED" }), serpTask("outside", null)];
  const rows = await loadContentOpportunities(null, "US");
  assert.deepEqual(rows.map(row => row.keyword).sort(), ["corrected", "failed", "outside", "partial50", "queued", "shallow", "unmeasured"]);
  assert.equal(rows.find(row => row.keyword === "outside").isTop100, false);
  assert.ok(rows.filter(row => row.keyword !== "outside").every(row => row.isTop100 === null && row.opportunityStatus === "NEEDS_VERIFICATION"));
});

test("endpoint declares the top100 boundary, validates region, and fails closed if ranking evidence cannot be read", async () => {
  state.members = [member("one")]; state.serpTasks = [serpTask("one", null)];
  const { secret } = await service.mutateExportApiKey({ action: "create", name: "rank-export", siteDomain: null });
  assert.equal((await endpoint.GET(request(secret, "?region=CN"))).status, 400);
  const body = await (await endpoint.GET(request(secret, "?region=US"))).json();
  assert.equal(body.targetRank, 100); assert.equal(body.region, "US"); assert.equal(body.rankingSource, "dataforseo_serp");
  assert.deepEqual(body.summary, { outsideTop100: 1, needsVerification: 0 }); assert.equal(body.rows[0].isTop100, false);
  state.serpFailure = true;
  assert.equal((await endpoint.GET(request(secret))).status, 503);
});

test("formal targets and research candidates export once per site, excluding ranked candidates too", async () => {
  state.members = [...Array.from({ length: 1512 }, (_, i) => member(`word-${i}`, { topicId: null })),
    ...Array.from({ length: 4000 }, (_, i) => member(`research-${i}`, { pool: "RESEARCH" }))];
  state.tasks = [task("one", ["word-0"]), task("two", ["word-0"]), task("research-plan", ["research-0"])];
  state.serpTasks = [serpTask("word-0", null), serpTask("word-1", 1), serpTask("word-2", 100), serpTask("research-1", 51)];
  const { secret } = await service.mutateExportApiKey({ action: "create", name: "formal targets", siteDomain: "flatkey.ai" });
  const body = await (await endpoint.GET(request(secret))).json();
  const rows = body.rows;
  assert.equal(body.total, 5509);
  assert.equal(rows.length, 5509);
  assert.equal(new Set(rows.map(row => `${row.siteDomain}:${row.keywordId}`)).size, rows.length);
  assert.ok(!rows.some(row => ["word-1", "word-2", "research-1"].includes(row.keyword)));
  assert.ok(rows.every(row => ["FORMAL", "RESEARCH"].includes(row.pool) && row.siteDomain === "flatkey.ai"));
  assert.equal(rows.filter(row => row.pool === "RESEARCH").length, 3999);
  assert.deepEqual(rows.find(row => row.keyword === "research-0").taskIds, ["research-plan"]);
  assert.deepEqual(rows.find(row => row.keyword === "research-0").plannedUrls, ["https://flatkey.ai/blog/research-plan"]);
  assert.deepEqual(rows.find(row => row.keyword === "word-0").taskIds, ["one", "two"]);
  assert.equal(rows.find(row => row.keyword === "word-0").rankingEvidence.length, 4);
  assert.ok(rows.every(row => row.opportunityStatus === "NEEDS_VERIFICATION"));
  const usRows = await loadContentOpportunities("flatkey.ai", "US");
  assert.equal(usRows.length, 5509);
  assert.equal(usRows.filter(row => row.opportunityStatus === "OUTSIDE_TOP100").length, 1);
});

test("proxy allows only the exact export path to reach API-key authentication", async () => {
  session = false;
  assert.equal((await proxy(new NextRequest("https://example.test/api/keywords/content-opportunities"))).headers.get("x-middleware-next"), "1");
  assert.equal((await proxy(new NextRequest("https://example.test/api/api-keys"))).status, 401);
  assert.equal((await proxy(new NextRequest("https://example.test/api/keywords/candidates/cleanup"))).status, 401);
  assert.equal((await proxy(new NextRequest("https://example.test/api/keywords/page-tasks"))).status, 401);
});
