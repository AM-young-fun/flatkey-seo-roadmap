#!/usr/bin/env node
// Default: authenticated reads and a local preview. Applying requires its exact hash.
const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { manifestSchema, hash, buildReviewPlan, applyReviewPlan, safeWorkflowError } = require("./lib/seo-content-review.cjs");
const arg = name => process.argv.find(value => value.startsWith(name + "="))?.slice(name.length + 1);

async function verifySources(manifest) {
  const verified = new Set();
  for (const source of manifest.sources) {
    const stat = await fs.stat(source.artifact).catch(() => null);
    if (!stat?.isFile() || stat.size > 64 * 1024 * 1024) continue;
    const actual = crypto.createHash("sha256").update(await fs.readFile(source.artifact)).digest("hex");
    if (actual === source.sha256) verified.add(source.id);
  }
  return verified;
}
function workflowApi(origin, token, fetcher = fetch) {
  async function request(route, body) {
    const response = await fetcher(origin + route, { method: body ? "POST" : "GET", redirect: "error", cache: "no-store",
      headers: { authorization: "Bearer " + token, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      const diagnostic = safeWorkflowError({ status: response.status, code: value.code, publicMessage: value.message });
      const error = Error(`workflow_${response.status}:${diagnostic.code}`);
      Object.assign(error, { status: response.status, code: diagnostic.code, publicMessage: diagnostic.message }); throw error;
    }
    return value;
  }
  return { snapshot: () => request("/api/seo/workflow?allHistory=true"), save: command => request("/api/seo/workflow", command),
    history: async (kind, id) => (await request("/api/seo/workflow/history?kind=" + kind + "&id=" + encodeURIComponent(id))).records ?? [] };
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + "." + process.pid + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(temporary, file);
}
async function run() {
  const input = arg("--input"), offline = arg("--workflow"), out = arg("--out"), apply = process.argv.includes("--apply");
  if (!input) throw Error("input_manifest_required");
  if (apply && offline) throw Error("apply_requires_live_all_history_read");
  const origin = new URL(process.env.SEO_PLATFORM_ORIGIN || "https://flatkey-seo-roadmap.vercel.app");
  if (origin.origin !== "https://flatkey-seo-roadmap.vercel.app" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw Error("unexpected_platform_origin");
  const token = process.env.SEO_IMPORT_TOKEN;
  if (!offline && !token) throw Error("missing_import_token_for_workflow_read");
  const inputBytes = await fs.readFile(input), inputStat = await fs.stat(input);
  const manifest = manifestSchema.parse(JSON.parse(inputBytes.toString("utf8"))), verifiedSourceIds = await verifySources(manifest);
  const decisionArtifact = { artifact: path.resolve(input), sha256: crypto.createHash("sha256").update(inputBytes).digest("hex"), observedAt: inputStat.mtime.toISOString() };
  const protectedPaths = new Set([input, offline, ...manifest.sources.map(source => source.artifact)].filter(Boolean).map(file => path.resolve(file)));
  const writeArtifact = async (file, value) => {
    if (protectedPaths.has(path.resolve(file))) throw Error("output_cannot_replace_input_or_source_snapshot");
    return writeJson(file, value);
  };
  const api = offline ? null : workflowApi(origin.origin, token);
  const snapshot = offline ? JSON.parse(await fs.readFile(offline, "utf8")) : await api.snapshot();
  let keywordInventory;
  // Never manufacture a formal identity or reuse workflow credentials for the
  // dedicated keyword read. Missing credentials block only new identity binds.
  if (manifest.findings.some(row => row.keywordId) && process.env.SEO_RESEARCH_READ_KEY && !offline) {
    const response = await fetch(origin.origin + "/api/keywords", { method: "GET", redirect: "error", cache: "no-store",
      headers: { "X-SEO-Research-Key": process.env.SEO_RESEARCH_READ_KEY }, signal: AbortSignal.timeout(60000) });
    if (response.ok) { const value = await response.json(); if (value.usingDemoData === false && Array.isArray(value.keywords)) keywordInventory = value.keywords; }
  }
  const planningOptions = { verifiedSourceIds, keywordInventory, decisionArtifact };
  const plan = buildReviewPlan(manifest, snapshot, planningOptions);
  const preview = { mode: "preview", origin: origin.origin, completeHistoryRead: !offline, ...plan };
  if (out) await writeArtifact(path.resolve(out), preview);
  if (!apply) { console.log(JSON.stringify(preview)); return preview; }
  const expectedPlanHash = arg("--expected-plan");
  if (!expectedPlanHash || expectedPlanHash !== plan.planHash || !plan.canApply) throw Error("reviewed_plan_hash_required_or_plan_blocked");
  if ((await verifySources(manifest)).size !== manifest.sources.length) throw Error("source_snapshot_changed_before_apply");
  if (crypto.createHash("sha256").update(await fs.readFile(input)).digest("hex") !== decisionArtifact.sha256) throw Error("decision_manifest_changed_before_apply");
  const directory = path.resolve(arg("--state-dir") || path.join(process.cwd(), ".local", "seo-content-review"));
  const journal = {
    read: async id => { try { const saved = JSON.parse(await fs.readFile(path.join(directory, hash(id) + ".json"), "utf8"));
      if (saved.origin !== origin.origin) throw Error("outbox_origin_conflict"); return saved; }
      catch (error) { if (error.code === "ENOENT") return null; throw error; } },
    write: (id, record) => writeArtifact(path.join(directory, hash(id) + ".json"), { origin: origin.origin, ...record }),
  };
  // The journal is destination-bound and retained before the only POST. An
  // unknown response is reconciled by reads; this tool never blindly retries it.
  const result = await applyReviewPlan(plan, api, { expectedPlanHash, journal, revalidate: fresh => buildReviewPlan(manifest, fresh, planningOptions) });
  const receipt = { mode: "apply", origin: origin.origin, ...result };
  if (out) await writeArtifact(path.resolve(out), { preview, receipt });
  console.log(JSON.stringify(receipt));
  if (result.status !== "verified") process.exitCode = 1;
  return receipt;
}
module.exports = { run, verifySources, workflowApi, writeJson };
if (require.main === module) run().catch(error => { console.error(JSON.stringify({ error: error instanceof require("zod").z.ZodError ? "invalid_review_manifest" : error.message,
  ...(error instanceof require("zod").z.ZodError ? { issues: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) } : {}),
  ...(Number.isInteger(error.status) ? { diagnostic: safeWorkflowError(error) } : {}),
  nextAction: "保留原预览与请求，核对来源及生产原记录；冲突重新读取，响应不明不得换编号重发。" })); process.exitCode = 1; });
