#!/usr/bin/env node
// Durable local outbox → authenticated platform; failures retain the exact request for safe replay.
const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { workflowMutationSchema, workflowClaimSchema } = (() => {
 const ts = require("typescript"), syncfs = require("node:fs");
 require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(syncfs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
 return require("../src/lib/seo-workflow.ts");
})();
const requestHash = command => crypto.createHash("sha256").update(JSON.stringify(command)).digest("hex");
function receiptMatches(receipt, origin, command) {
 return receipt?.version === 1 && receipt.origin === origin && receipt.requestId === command.requestId && receipt.requestHash === requestHash(command) && receipt.result?.stored === true && receipt.result.storage === "database";
}
const arg = name => process.argv.find(value => value.startsWith(name + "="))?.slice(name.length + 1);
async function run() {
 const directory = process.env.SEO_WORKFLOW_OUTBOX || path.join(process.cwd(), ".local", "workflow-outbox");
 const input = arg("--input"), claimFile = arg("--claim");
 const apply = process.argv.includes("--apply");
 const origin = new URL(process.env.SEO_PLATFORM_ORIGIN || "https://flatkey-seo-roadmap.vercel.app");
 if (origin.origin !== "https://flatkey-seo-roadmap.vercel.app" && !["localhost", "127.0.0.1"].includes(origin.hostname)) throw Error("unexpected_platform_origin");
 const submit = async (route, body) => {
  if (!process.env.SEO_IMPORT_TOKEN) throw Error("missing_import_token");
  const response = await fetch(origin.origin + route, { method: "POST", headers: { authorization: "Bearer " + process.env.SEO_IMPORT_TOKEN, "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(60000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(`workflow_${response.status}:${result.code || "unavailable"}`);
  return result;
 };
 if (claimFile) {
  if (!apply) throw Error("claim_requires_apply");
  const command = workflowClaimSchema.parse(JSON.parse(await fs.readFile(claimFile, "utf8")));
  console.log(JSON.stringify(await submit("/api/seo/workflow/claims", command)));
  return;
 }
 await fs.mkdir(directory, { recursive: true, mode: 0o700 });
 const orderFile = path.join(directory, ".order.ndjson");
 const readOrder = async () => {
  try { return (await fs.readFile(orderFile, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === "ENOENT") return []; throw Error("outbox_order_unconfirmed"); }
 };
 if (input) {
  const raw = JSON.parse(await fs.readFile(input, "utf8"));
  const commands = Array.isArray(raw) ? raw : [raw];
  if (!commands.length || commands.length > 1000) throw Error("invalid_command_count");
  for (const command of commands) {
   const value = workflowMutationSchema.parse(command);
   const body = JSON.stringify(value), hash = crypto.createHash("sha256").update(body).digest("hex");
   const file = path.join(directory, value.requestId + ".json");
   try { await fs.writeFile(file, body, { flag: "wx", mode: 0o600 }); }
   catch (error) { if (error.code !== "EEXIST" || await fs.readFile(file, "utf8") !== body) throw Error("outbox_id_conflict"); }
   if (!(await readOrder()).includes(value.requestId)) await fs.appendFile(orderFile, JSON.stringify(value.requestId) + "\n", { mode: 0o600 });
   console.log(JSON.stringify({ status: "queued", requestId: value.requestId, hash, file }));
  }
 }
 if (!apply) return;
 // Replays use identical request IDs and payloads. Never substitute a fresh ID after timeout.
 const order = [...new Set(await readOrder())];
 const existingFiles = (await fs.readdir(directory)).filter(name => name.endsWith(".json") && !name.endsWith(".receipt.json"));
 if (existingFiles.some(file => !order.includes(file.slice(0, -5)))) throw Error("outbox_has_unordered_requests_requeue_original_input");
 const files = order.map(id => {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_.:-]+$/.test(id)) throw Error("invalid_outbox_request_id");
  return id + ".json";
 });
 for (const file of files) {
  const receiptFile = path.join(directory, file.replace(/\.json$/, ".receipt.json"));
  const command = workflowMutationSchema.parse(JSON.parse(await fs.readFile(path.join(directory, file), "utf8")));
  try { const receipt = JSON.parse(await fs.readFile(receiptFile, "utf8")); if (receiptMatches(receipt, origin.origin, command)) continue; } catch { /* No confirmed destination-bound receipt. */ }
  const result = await submit("/api/seo/workflow", command);
  if (result.stored !== true || result.storage !== "database") throw Error("production_persistence_unconfirmed");
  await fs.writeFile(receiptFile, JSON.stringify({ version: 1, origin: origin.origin, requestId: command.requestId, requestHash: requestHash(command), result }), { mode: 0o600 });
  console.log(JSON.stringify({ status: "persisted", requestId: command.requestId, replay: result.replay, version: result.record?.version }));
 }
}
module.exports = { requestHash, receiptMatches };
if (require.main === module) run().catch(error => { console.error(JSON.stringify({ error: error.message, nextAction: "保留原请求核对；不要替换幂等ID或覆盖人工版本" })); process.exitCode = 1; });
