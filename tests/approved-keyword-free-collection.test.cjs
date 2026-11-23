const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
class WorkflowError extends Error { constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; } }
class ImportRequestError extends Error { constructor(message, status) { super(message); this.status = status; } }
mock("src/lib/seo-workflow-state.ts", { WorkflowError });
mock("src/lib/ranking-import.ts", { ImportRequestError });
mock("src/lib/seo-analytics-access.ts", {
  analyticsLocalPreview: () => false,
  authorizeAnalyticsRead: async request => request.headers.get("cookie") === "fictional-valid-session",
  privateAnalyticsHeaders: { "Cache-Control": "private, no-store" },
});
mock("src/lib/services/import-tokens.ts", {
  authenticateImportToken: async request => request.headers.get("authorization") === "Bearer fictional-existing-import-token",
});
let calls, authWrites, failure;
mock("src/lib/services/approved-keyword-review.ts", {
  prepareApprovedKeywordReview: async () => assert.fail("a free collection route must not prepare a paid ledger"),
  advanceApprovedKeywordReview: async allowSubmit => {
    assert.equal(allowSubmit, false, "existing SEO import credentials cannot submit paid queries");
    calls.push({ scope: "original", allowSubmit });
    if (failure) throw failure;
    return { runId: "approved-keyword-review-20261123-v1", collected: true };
  },
});
mock("src/lib/services/approved-other-keyword-review.ts", {
  prepareApprovedOtherKeywordReview: async () => assert.fail("a free collection route must not prepare the supplement"),
  advanceApprovedOtherKeywordReview: async allowSubmit => {
    assert.equal(allowSubmit, false, "the second scope has the same free-only boundary");
    calls.push({ scope: "other", allowSubmit });
    if (failure) throw failure;
    return { runId: "approved-other-keyword-review-20261123-v1", collected: true };
  },
});
// Exercise the real common workflow authorizer and body reader, with only the
// account/token storage seams mocked. This verifies write-origin semantics.
const workflow = require("../src/lib/seo-workflow-http.ts"), authorize = workflow.authorizeWorkflow;
workflow.authorizeWorkflow = async (request, write) => { authWrites.push(write); return authorize(request, write); };
const { APPROVED_KEYWORD_REVIEW_RUN_ID: firstId } = require("../src/lib/approved-keyword-review.ts");
const { APPROVED_OTHER_KEYWORD_REVIEW_RUN_ID: otherId } = require("../src/lib/approved-other-keyword-review.ts");
const { POST } = require("../src/app/api/seo/approved-keyword-review/collect/route.ts");
const collector = { authorization: "Bearer fictional-existing-import-token" };
const post = (body, headers = collector) => POST(new Request("https://seo.test/api/seo/approved-keyword-review/collect", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
}));
beforeEach(t => {
  calls = []; authWrites = []; failure = null;
  t.mock.method(globalThis, "fetch", async () => assert.fail("route tests must not call a provider or perform a paid request"));
});

test("existing import credentials collect each fixed approved scope with allowSubmit=false", async () => {
  for (const runId of [firstId, otherId]) {
    const response = await post({ runId });
    assert.equal(response.status, 200); assert.equal((await response.json()).runId, runId);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.deepEqual(calls, [{ scope: "original", allowSubmit: false }, { scope: "other", allowSubmit: false }]);
  assert.deepEqual(authWrites, [true, true]);
});

test("unauthenticated and invalid-token calls stop before collection", async () => {
  for (const headers of [{}, { authorization: "Bearer invalid-token" }]) {
    const response = await post({ runId: firstId }, headers);
    assert.equal(response.status, 401);
  }
  assert.equal(calls.length, 0);
});

test("collector credentials reject browser-origin requests and cannot bypass the origin boundary", async () => {
  for (const origin of ["https://seo.test", "https://untrusted.test"]) {
    assert.equal((await post({ runId: firstId }, { ...collector, origin })).status, 403);
  }
  assert.equal(calls.length, 0);
});

test("cookie collection requires a same-origin write request", async () => {
  assert.equal((await post({ runId: firstId }, { cookie: "fictional-valid-session" })).status, 403);
  assert.equal((await post({ runId: firstId }, { cookie: "fictional-valid-session", origin: "https://untrusted.test" })).status, 403);
  assert.equal((await post({ runId: otherId }, { cookie: "fictional-valid-session", origin: "https://seo.test" })).status, 200);
  assert.deepEqual(calls, [{ scope: "other", allowSubmit: false }]);
});

test("arbitrary, absent, coerced or non-string run identities cannot dispatch either scope", async () => {
  const invalid = [null, [], {}, { runId: "serp-cycle-2026-11-17" }, { runId: firstId + "-retry" },
    { runId: firstId.toUpperCase() }, { runId: 123 }, { runId: true }, { runId: null },
    { runId: [firstId] }, { runId: [otherId] }, { runId: { toString: firstId } }];
  for (const body of invalid) assert.equal((await post(body)).status, 400, JSON.stringify(body));
  assert.equal(calls.length, 0);
});

test("extra paid, prepare, arbitrary task or budget parameters are all rejected", async () => {
  const extras = [{ allowSubmit: true }, { action: "prepare" }, { taskIds: ["arbitrary-provider-task"] },
    { maxCostMicros: 1 }, { quoteSha256: "changed" }, { paidEnabled: true }, { region: "CN" }];
  for (const runId of [firstId, otherId]) for (const extra of extras) {
    assert.equal((await post({ runId, ...extra })).status, 400);
  }
  assert.equal(calls.length, 0);
});

test("invalid JSON and an oversized body fail before selecting any saved run", async () => {
  const request = body => new Request("https://seo.test/api/seo/approved-keyword-review/collect", {
    method: "POST", headers: { "Content-Type": "application/json", ...collector }, body,
  });
  assert.equal((await POST(request("{"))).status, 400);
  assert.equal((await POST(request(JSON.stringify({ runId: "x".repeat(513 * 1024) })))).status, 413);
  assert.equal(calls.length, 0);
});

test("a failed free collection is returned once and never retried or prepared", async () => {
  failure = new ImportRequestError("original paid receipt unavailable", 409);
  const response = await post({ runId: firstId });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).message, "original paid receipt unavailable");
  assert.deepEqual(calls, [{ scope: "original", allowSubmit: false }]);
});
