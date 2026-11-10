const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const { spawn } = require("node:child_process");
const { approvalRequest, platformOrigin, requestHash, runApprovalCheck } = require("../scripts/seo-page-approval-check.cjs");
const SECRET = "fixture-only-import-secret-do-not-log-971";
const input = () => ({ approvalId: "approval-one", approvalItemId: "translation-ja-v3", taskId: "blog-one", pageUrl: "https://flatkey.ai/ja/blog/model-api", language: "ja", contentVersion: "sha256-translation-v3" });
const passed = request => ({ allowed: true, request, approvalId: request.approvalId, itemId: request.itemId, decisionId: "decision-approved", decisionVersion: 2, decisionRecordedAt: new Date(Date.now() - 1000).toISOString(), checkedAt: new Date().toISOString(), storage: "database" });
async function setup(t, value = input()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "seo-page-approval-check-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "input.json"), JSON.stringify(value));
  const config = { cwd: directory, argv: ["--input=input.json"], env: { SEO_IMPORT_TOKEN: SECRET } };
  return { directory, config, read: async result => JSON.parse(await fs.readFile(result.output.receipt, "utf8")) };
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test("translation preflight sends only exact six-field request and saves destination-bound private receipt", async t => {
  const s = await setup(t); const calls = [];
  const result = await runApprovalCheck({ ...s.config, fetchImpl: async (url, options) => {
    calls.push(url); assert.equal(url, "https://flatkey-seo-roadmap.vercel.app/api/seo/workflow/approval-check");
    assert.equal(options.method, "POST"); assert.equal(options.headers.authorization, "Bearer " + SECRET);
    assert.equal(options.headers.origin, undefined); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    const request = JSON.parse(options.body); assert.deepEqual(request, approvalRequest(input()));
    assert.equal(request.language, "ja"); assert.equal(request.itemId, "translation-ja-v3");
    return json({ ...passed(request), arbitraryServerField: "not-persisted" });
  } });
  assert.equal(result.exitCode, 0); assert.equal(calls.length, 1);
  const receipt = await s.read(result);
  assert.equal(receipt.origin, "https://flatkey-seo-roadmap.vercel.app");
  assert.equal(receipt.requestHash, requestHash(approvalRequest(input())));
  assert.deepEqual(receipt.request, approvalRequest(input())); assert.equal(receipt.result.storage, "database");
  assert.equal(receipt.result.arbitraryServerField, undefined); assert.equal(receipt.reusable, false);
  assert.equal(receipt.isPublicationReceipt, false); assert.equal(receipt.revalidateAtPublication, true);
  assert.equal((await fs.stat(result.output.receipt)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify({ result, receipt }).includes(SECRET), false);
});

test("refused, withdrawn, missing, and unavailable approvals fail closed with a receipt and no other request", async t => {
  for (const [status, code] of [[409, "publication_unapproved"], [409, "publication_approval_mismatch"], [401, "unauthorized"], [403, "invalid_origin"], [503, "storage_unavailable"]]) {
    await t.test(status + ":" + code, async t => {
      const s = await setup(t); let calls = 0;
      const result = await runApprovalCheck({ ...s.config, fetchImpl: async () => { calls++; return json({ code, message: "Untrusted provider explanation" }, status); } });
      assert.equal(result.exitCode, 1); assert.equal(result.output.code, code); assert.equal(calls, 1);
      const receipt = await s.read(result); assert.equal(receipt.result.allowed, false);
      assert.equal(JSON.stringify(receipt).includes("Untrusted provider"), false);
    });
  }
});

test("every echoed page binding is checked; source approval cannot approve translated or revised content", async t => {
  for (const key of ["approvalId", "itemId", "taskId", "pageUrl", "language", "contentVersion"]) {
    await t.test(key, async t => {
      const s = await setup(t);
      const result = await runApprovalCheck({ ...s.config, fetchImpl: async (_url, options) => {
        const response = passed(JSON.parse(options.body)); response.request[key] = "different-value"; return json(response);
      } });
      assert.equal(result.exitCode, 1); assert.equal(result.output.code, "approval_response_mismatch");
    });
  }
});

test("truthy allowed, incomplete response, preview storage and stale receipts never pass", async t => {
  const patches = [
    [{ allowed: "true" }, "approval_not_allowed"], [{ allowed: false }, "approval_not_allowed"],
    [{ storage: "local_preview" }, "approval_storage_unconfirmed"], [{ request: null }, "approval_response_mismatch"],
    [{ itemId: "other" }, "approval_response_mismatch"], [{ approvalId: "other" }, "approval_response_mismatch"],
    [{ decisionVersion: 0 }, "invalid_approval_response"], [{ checkedAt: "2025-01-01T00:00:00Z" }, "approval_response_time_invalid"],
    [{ decisionRecordedAt: "2099-01-01T00:00:00Z" }, "approval_response_time_invalid"],
  ];
  for (const [patch, code] of patches) {
    await t.test(JSON.stringify(patch), async t => {
      const s = await setup(t);
      const result = await runApprovalCheck({ ...s.config, fetchImpl: async (_url, options) => json({ ...passed(JSON.parse(options.body)), ...patch }) });
      assert.equal(result.exitCode, 1); assert.equal(result.output.code, code);
    });
  }
});

test("network failures, redirects, malformed/oversized JSON and reflected secrets cannot leak or allow publication", async t => {
  const scenarios = [
    async () => { throw new Error("network " + SECRET); },
    async () => json({ code: "redirect" }, 302),
    async () => new Response("invalid-json " + SECRET),
    async () => new Response(JSON.stringify({ message: "x".repeat(70 * 1024) })),
    async (_url, options) => json({ ...passed(JSON.parse(options.body)), decisionId: SECRET }),
  ];
  for (const [index, fetchImpl] of scenarios.entries()) {
    await t.test("scenario " + index, async t => {
      const s = await setup(t); const result = await runApprovalCheck({ ...s.config, fetchImpl });
      assert.equal(result.exitCode, 1); assert.equal(JSON.stringify({ result, receipt: await s.read(result) }).includes(SECRET), false);
    });
  }
});

test("old positive receipts are never a cache: a later withdrawal is queried and gets a new negative receipt", async t => {
  const s = await setup(t); let calls = 0;
  const fetchImpl = async (_url, options) => ++calls === 1 ? json(passed(JSON.parse(options.body))) : json({ code: "publication_unapproved" }, 409);
  const first = await runApprovalCheck({ ...s.config, fetchImpl });
  const second = await runApprovalCheck({ ...s.config, fetchImpl });
  assert.equal(first.exitCode, 0); assert.equal(second.exitCode, 1); assert.equal(calls, 2);
  assert.notEqual(first.output.receipt, second.output.receipt);
  assert.equal((await s.read(first)).result.allowed, true); assert.equal((await s.read(second)).result.allowed, false);
});

test("missing fields, generic task approval, extra flags, non-approved destination and missing secret make no request", async t => {
  const s = await setup(t); let calls = 0; const fetchImpl = async () => { calls++; throw Error("must not run"); };
  for (const patch of [
    { env: {} }, { env: { SEO_IMPORT_TOKEN: SECRET, SEO_PLATFORM_ORIGIN: "https://example.com" } },
    { argv: ["--input=input.json", "--publish"] }, { argv: ["--input=input.json", "--input=input.json"] },
  ]) await assert.rejects(runApprovalCheck({ ...s.config, ...patch, fetchImpl }));
  for (const key of Object.keys(input())) {
    const malformed = input(); delete malformed[key]; assert.throws(() => approvalRequest(malformed), /invalid_approval_input/);
  }
  assert.throws(() => approvalRequest({ ...input(), kind: "standing_new_blog" }), /invalid_approval_input/);
  for (const origin of ["http://flatkey-seo-roadmap.vercel.app", "https://flatkey-seo-roadmap.vercel.app.evil.example", "https://token@flatkey-seo-roadmap.vercel.app", "https://flatkey-seo-roadmap.vercel.app/?token=secret"]) assert.throws(() => platformOrigin(origin));
  assert.equal(calls, 0);
});

test("failed receipt persistence cannot yield a successful preflight", async t => {
  const s = await setup(t); await fs.writeFile(path.join(s.directory, "not-a-directory"), "occupied");
  await assert.rejects(runApprovalCheck({ ...s.config, argv: [...s.config.argv, "--receipt-dir=not-a-directory"], fetchImpl: async (_url, options) => json(passed(JSON.parse(options.body))) }), /approval_receipt_not_saved/);
});

test("real CLI exits nonzero against a loopback refusal and sends no CMS or publication request", async t => {
  const s = await setup(t); const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, method: req.method, body: JSON.parse(Buffer.concat(chunks).toString()) });
    assert.equal(req.headers.authorization, "Bearer " + SECRET); assert.equal(req.headers.origin, undefined);
    res.writeHead(409, { "content-type": "application/json" }); res.end(JSON.stringify({ code: "publication_unapproved" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = "http://127.0.0.1:" + server.address().port;
  const script = path.resolve(__dirname, "../scripts/seo-page-approval-check.cjs");
  const execution = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--input=input.json"], { cwd: s.directory, env: { ...process.env, SEO_IMPORT_TOKEN: SECRET, SEO_PLATFORM_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject); child.on("exit", code => resolve({ code, stdout, stderr }));
  });
  assert.equal(execution.code, 1); assert.equal(execution.stderr, ""); assert.equal(JSON.stringify(execution).includes(SECRET), false);
  const output = JSON.parse(execution.stdout); assert.equal(output.allowed, false); assert.equal(output.code, "publication_unapproved");
  assert.deepEqual(requests, [{ url: "/api/seo/workflow/approval-check", method: "POST", body: approvalRequest(input()) }]);
});
