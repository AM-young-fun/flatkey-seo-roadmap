#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const origin = "https://flatkey-seo-roadmap.vercel.app";
const project = path.resolve(__dirname, "..");
const store = process.env.SEO_CODEX_PROGRESS_DIR ?? path.join(project, ".local/seo-codex-progress");
const bindings = path.join(store, "bindings");
const outbox = path.join(store, "outbox");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const emit = value => console.log(JSON.stringify(value));

function validId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
}

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function list(dir) {
  try { return fs.readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort(); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

function storeOnce(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = path.join(path.dirname(file), randomUUID() + ".tmp");
  fs.writeFileSync(temp, JSON.stringify(value), { flag: "wx", mode: 0o600 });
  try { fs.linkSync(temp, file); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  finally { fs.unlinkSync(temp); }
  return read(file);
}

function bindingFile(taskId, phase) {
  if (!validId(taskId) || !["work", "release", "rollback"].includes(phase)) throw Error("invalid_task_binding");
  return path.join(bindings, hash([taskId, phase]) + ".json");
}

function lookup(taskId, phase) {
  return read(bindingFile(taskId, phase));
}

function bind(taskId, phase, sessionId) {
  if (!validId(sessionId)) throw Error("missing_codex_session_id");
  const existing = bySession(sessionId);
  if (existing && (existing.taskId !== taskId || existing.phase !== phase)) throw Error("session_already_bound");
  const saved = storeOnce(bindingFile(taskId, phase), { taskId, phase, sessionId });
  if (saved.sessionId !== sessionId) throw Error("resume_bound_session:" + saved.sessionId);
  return saved;
}

function bySession(sessionId) {
  if (!validId(sessionId)) return null;
  const matches = list(bindings).map(name => read(path.join(bindings, name))).filter(row => row?.sessionId === sessionId);
  if (matches.length > 1) throw Error("ambiguous_session_binding");
  return matches[0] ?? null;
}

function credential() {
  if (process.env.SEO_IMPORT_TOKEN?.trim()) return process.env.SEO_IMPORT_TOKEN.trim();
  const tokenFile = process.env.SEO_IMPORT_TOKEN_FILE ?? read(path.join(store, "settings.json"))?.tokenFile;
  if (!tokenFile || !path.isAbsolute(tokenFile)) throw Error("missing_import_token_path");
  const info = fs.lstatSync(tokenFile);
  if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077) throw Error("insecure_import_token_file");
  return fs.readFileSync(tokenFile, "utf8").trim();
}

async function request(query, signal, body) {
  const response = await fetch(origin + "/api/seo/workflow" + query, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer " + credential(), "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal, redirect: "error", cache: "no-store",
  });
  const data = await response.json();
  if (response.status === 409 && data.code === "version_conflict") return null;
  if (!response.ok || data.storage !== "database") throw Error(data.code ?? "workflow_http_" + response.status);
  return data;
}

function textField(value, limit, optional = false) {
  if (typeof value !== "string" || value.trim().length > limit || (!optional && !value.trim())) throw Error("invalid_checkpoint_text");
  return value.trim();
}

function makeCheckpoint(binding, payload) {
  const { summary, nextAction = "", evidence } = payload;
  if (!Array.isArray(evidence) || !evidence.length || evidence.length > 10) throw Error("checkpoint_requires_evidence");
  const observedAt = payload.observedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(observedAt)) || Date.parse(observedAt) > Date.now() + 300_000) throw Error("invalid_checkpoint_time");
  const references = evidence.map(item => {
    const label = textField(item.label, 300);
    if (item.url) {
      const url = new URL(textField(item.url, 3000));
      if (url.protocol !== "https:" || url.username || url.password) throw Error("invalid_evidence_url");
      return { label, url: url.href };
    }
    return { label, artifact: textField(item.artifact, 2000) };
  });
  const fact = { summary: textField(summary, 1000), nextAction: textField(nextAction, 1000, true), evidence: references };
  const id = hash([binding.taskId, binding.sessionId, fact]);
  return { id, sessionId: binding.sessionId, ...fact, observedAt, evidence: references.map(item => ({ ...item, observedAt })) };
}

async function deliver(job, signal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const detail = await request("?taskId=" + encodeURIComponent(job.taskId), signal);
    const task = detail?.task;
    if (!task || task.id !== job.taskId) throw Error("original_task_not_found");
    if (task.progress?.some(entry => entry.id === job.checkpoint.id)) return;
    const record = { ...task };
    const { version } = record;
    delete record.version;
    delete record.updatedAt;
    delete record.recordedAt;
    const saved = await request("", signal, {
      action: "save_task", expectedVersion: version,
      requestId: `codex-progress:${job.checkpoint.id}:${version}`,
      record: { ...record, progress: [job.checkpoint] },
    });
    if (!saved) continue;
    if (saved.stored !== true || !saved.record?.progress?.some(entry => entry.id === job.checkpoint.id)) throw Error("checkpoint_save_unconfirmed");
    return;
  }
  throw Error("checkpoint_version_conflict");
}

async function flush(sessionId, timeout) {
  const result = { synced: 0, pending: 0 };
  const signal = AbortSignal.timeout(timeout);
  for (const name of list(outbox)) {
    const file = path.join(outbox, name);
    const job = read(file);
    if (!job || (sessionId && job.checkpoint.sessionId !== sessionId)) continue;
    const binding = lookup(job.taskId, job.phase);
    try {
      if (binding?.sessionId !== job.checkpoint.sessionId) throw Error("checkpoint_binding_changed");
      await deliver(job, signal);
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
      result.synced++;
    } catch {
      result.pending++;
    }
  }
  return result;
}

const localCommand = `rtk proxy node "${project}/.local/seo-codex-progress.cjs" --checkpoint`;
const reminder = `有已完成的实质进展时立即运行 ${localCommand}，stdin 传 JSON {summary,nextAction,evidence:[{label,url 或 artifact}]}。证据用已有稿件、提交、测试、分析产物或发布回执。只读、领取、计划或重复事实不写回。禁止传聊天全文、密钥或原始日志。沿用原任务和当前会话。`;

async function hook(input) {
  const binding = bySession(input.session_id);
  if (!binding) return {};
  const event = input.hook_event_name;
  const result = await flush(binding.sessionId, event === "SessionEnd" || event === "Interrupt" ? 2000 : 6500);
  const warning = result.pending ? { systemMessage: "工作任务有待同步回执，已保留在本机，稍后重试。" } : {};
  if (event === "SessionStart") return { ...warning, hookSpecificOutput: {
    hookEventName: "SessionStart", additionalContext: `当前 Codex 会话绑定原工作任务 ${binding.taskId}。${reminder}`,
  } };
  if (event === "Stop" && !input.stop_hook_active && input.last_assistant_message) return {
    ...warning, decision: "block", reason: `收尾时只核对本轮是否有尚未回填的可验证进展。${reminder} 无新进展时直接结束，不重跑工作。`,
  };
  return warning;
}

function dispatch(scope, args) {
  const scanner = read(path.join(store, "settings.json"))?.scanner;
  if (!scanner || !path.isAbsolute(scanner)) throw Error("missing_scanner_path");
  const phase = ["release", "rollback"].includes(scope) ? scope : "work";
  const taskId = scope === "--renew" ? null : args[0];
  const resumeArg = args.find(value => value.startsWith("--resume-session="));
  if (taskId) {
    const existing = lookup(taskId, phase);
    if (existing && !resumeArg) return emit({ acquired: false, reason: "existing_codex_session", ...existing });
    if (resumeArg && resumeArg.slice("--resume-session=".length) !== existing?.sessionId) throw Error("resume_session_not_bound");
  }
  // The scanner must receive the already-validated original session identity:
  // a published CMS write resumes verification through that exact reservation.
  const execution = spawnSync(process.execPath, [scanner, scope, ...args], { stdio: "inherit" });
  if (execution.error) throw execution.error;
  process.exitCode = execution.status ?? 1;
}

async function main() {
  const [action, taskId, phase = "work", explicitSession] = process.argv.slice(2);
  const runningSession = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID;
  if (action === "--dispatch") return dispatch(taskId, process.argv.slice(4));
  if (action === "--lookup") return emit(lookup(taskId, phase));
  if (action === "--bind") return emit(bind(taskId, phase, explicitSession || runningSession));
  if (action === "--flush") return emit(await flush(null, 15_000));
  if (action === "--hook") return emit(await hook(JSON.parse(fs.readFileSync(0, "utf8"))));
  if (action !== "--checkpoint") throw Error("unknown_progress_command");
  const binding = bySession(runningSession);
  if (!binding) throw Error("current_codex_session_not_bound");
  const checkpoint = makeCheckpoint(binding, JSON.parse(fs.readFileSync(0, "utf8")));
  const file = path.join(outbox, checkpoint.id + ".json");
  storeOnce(file, { ...binding, checkpoint });
  const result = await flush(binding.sessionId, 15_000);
  emit({ ...result, taskId: binding.taskId, receiptId: checkpoint.id, stored: !fs.existsSync(file) });
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { bind, lookup, bySession, makeCheckpoint, deliver, flush, hook };
