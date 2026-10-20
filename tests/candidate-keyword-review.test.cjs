const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
let state;
let displayInvalidations = 0, displayVersionReads = 0;
const member = (id, text, extras = {}) => ({ keywordId: id, siteDomain: "flatkey.ai", pool: "RESEARCH", active: true, protected: false, reviewStatus: "UNREVIEWED", exclusionReason: null, excludedAt: null, keyword: { text, active: true }, ...extras });
const db = {
  $transaction: async fn => { const before = structuredClone(state); try { return await fn(db); } catch (error) { state = before; throw error; } },
  siteKeyword: { findMany: async ({ where }) => structuredClone(state.members.filter(row => row.siteDomain === where.siteDomain && row.pool === where.pool && row.active === where.active && row.keyword.active).sort((a,b) => a.keywordId.localeCompare(b.keywordId))) },
  $executeRaw: async query => {
    if (!query.sql?.includes('UPDATE "SiteKeyword"')) return 0;
    assert.match(query.sql, /sk.pool = 'RESEARCH'/); assert.match(query.sql, /sk.protected = false/);
    const changes = JSON.parse(query.values.find(value => typeof value === "string" && value.startsWith("[{")));
    if (state.concurrentEdit) return 0;
    for (const change of changes) { const row = state.members.find(row => row.keywordId === change.keywordId); row.active = false; row.pool = "ARCHIVED"; row.exclusionReason = change.reason; }
    return changes.length;
  },
  keywordCurationAudit: { create: async ({ data }) => { if (state.auditFailure) throw new Error("write failed"); state.audits.push(data); } },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
for (const [file, exports] of [["display-change", { displayDataChanged: async () => { displayInvalidations++; } }], ["display-snapshots", { syncDisplaySourceVersion: async () => { displayVersionReads++; } }]]) {
  const filename = path.join(root, `src/lib/services/${file}.ts`); require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { reviewCandidateKeyword } = require("../src/lib/candidate-keyword-review.ts");
const { loadCandidateReview, applyCandidateReview } = require("../src/lib/services/candidate-keyword-review.ts");
const route = require("../src/app/api/keywords/candidates/cleanup/route.ts");
beforeEach(() => { process.env.DATABASE_URL = "postgresql://unused.invalid/test"; state = { members: [member("brand", "openrouter pricing"), member("good", "qwen3.8 max api pricing"), member("formal", "portkey pricing", { pool: "FORMAL" }), member("protected", "groq models", { protected: true }), member("other", "runpod pricing", { siteDomain: "rackrate.org" })], audits: [] }; });

test("competitor services are screened with word boundaries while models, hardware and integrations remain", () => {
  for (const text of ["OpenRouter alternatives", "runpod gpu rental", "vast.ai pricing", "groq api free tier", "cloudflare ai gateway", "portkey", "litellm vs vllm", "kong ai gateway"]) assert.equal(reviewCandidateKeyword(text).kind, "COMPETITOR", text);
  for (const text of ["grok api", "openai compatible API", "claude api", "deepseek v4.1", "nvidia h100 vs a100", "typesafe/jev-1.13", "vllm --enable-expert-parallel", "cline custom base url", "Vercel AI SDK custom provider base URL"]) assert.equal(reviewCandidateKeyword(text).kind, "KEEP", text);
  assert.equal(reviewCandidateKeyword("portkey", true).kind, "KEEP");
});
test("quality screening distinguishes query debris and unrelated entities from legitimate questions and languages", () => {
  for (const text of ["%deepseek api", "site:openai.com api", "gemini api k", "gemini_api_key settings.py", "metered billing api,billing infrastructure,commercial,bofu,primary,developers,direct fit", "xai api images generations aspect_ratio b64_json"]) assert.equal(reviewCandidateKeyword(text).kind, "LOW_QUALITY", text);
  for (const text of ["hurom h100 vs h200", "g shock gst b200 vs b300", "far cry 6 low gpu utilization", "unified health api"]) assert.equal(reviewCandidateKeyword(text).kind, "UNRELATED", text);
  for (const text of ["how do i set up model routing with fallback between providers and keep a full audit log", "gemini api料金", "免费deepseek v4", "70b model vram requirements"]) assert.equal(reviewCandidateKeyword(text).kind, "KEEP", text);
});
test("preview is read-only and apply archives only the exact selected candidate records with an audit", async () => {
  const before = structuredClone(state), plan = await loadCandidateReview();
  assert.equal(plan.total, 3); assert.equal(plan.suggested, 1); assert.deepEqual(state, before);
  const result = await applyCandidateReview(["brand", "brand"], plan.stateHash);
  assert.equal(result.changed, 1); assert.equal(result.remaining, 2); assert.equal(state.members.find(row => row.keywordId === "brand").pool, "ARCHIVED");
  for (const id of ["good", "formal", "protected", "other"]) assert.deepEqual(state.members.find(row => row.keywordId === id), before.members.find(row => row.keywordId === id));
  assert.equal(state.audits.length, 1); assert.equal(state.audits[0].before[0].pool, "RESEARCH"); assert.match(state.audits[0].after[0].reason, /COMPETITOR/);
  await assert.rejects(applyCandidateReview(["brand"], plan.stateHash), error => error.status === 409);
});
test("stale previews, protected words, formal words and cross-site IDs cannot be archived", async () => {
  for (const id of ["formal", "protected", "other", "missing"]) { const plan = await loadCandidateReview(); await assert.rejects(applyCandidateReview([id], plan.stateHash), error => error.status === 409); }
  const plan = await loadCandidateReview(); state.members[0].pool = "FORMAL";
  await assert.rejects(applyCandidateReview(["brand"], plan.stateHash), error => error.status === 409);
  assert.equal(state.audits.length, 0);
});
test("concurrent edits or audit failures roll the entire batch back", async () => {
  for (const failure of ["concurrentEdit", "auditFailure"]) {
    const plan = await loadCandidateReview(); state[failure] = true; const before = structuredClone(state);
    await assert.rejects(applyCandidateReview(["brand"], plan.stateHash)); assert.deepEqual(state, before); delete state[failure];
  }
});
test("route rejects cross-origin requests and invalid batches before any mutation", async () => {
  const request = (body, origin) => new Request("https://seo.test/api/keywords/candidates/cleanup", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  assert.equal((await route.POST(request({}, "https://other.test"))).status, 403);
  assert.equal((await route.POST(request({ keywordIds: [], expectedStateHash: "a".repeat(64) }))).status, 400);
  assert.equal((await route.POST(request({ keywordIds: ["brand"], expectedStateHash: "a".repeat(64), siteDomain: "rackrate.org" }))).status, 400);
  const plan = await (await route.GET()).json();
  assert.equal((await route.POST(request({ keywordIds: ["brand"], expectedStateHash: plan.stateHash }))).status, 200);
  if (fs.existsSync(path.join(root, "src/lib/services/display-change.ts"))) {
    assert.equal(displayVersionReads, 1, "preview detects membership changes for persisted display views");
    assert.equal(displayInvalidations, 1, "committed cleanup invalidates and refreshes persisted views");
  }
});
