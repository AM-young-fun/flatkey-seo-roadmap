#!/usr/bin/env node
"use strict";
const fs = require("node:fs"), path = require("node:path");
const { createRecoveryGuard } = require("./lib/seo-recovery-guard.cjs");
const guard = createRecoveryGuard(path.resolve(__dirname, ".."));
const [action, entrypoint, explicitOwner] = process.argv.slice(2);
const owner = explicitOwner || process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID;
try {
  let result;
  if (action === "status") {
    const current = guard.status();
    result = { batchId: current.batchId, runtime: current.runtime, ledgerFile: guard.ledgerFile,
      taskReceipts: current.ledger.tasks.map(row => ({ taskId: row.taskId, date: row.date, category: row.category, state: row.state })),
      scopes: current.ledger.scopes.map(row => ({ entrypoint: row.entrypoint, sourceDate: row.sourceDate, status: row.status })) };
  } else if (action === "once-claim") result = guard.once("claim", entrypoint, owner);
  else if (action === "once-receipt") result = guard.once("receipt", entrypoint, owner, JSON.parse(fs.readFileSync(0, "utf8")));
  else if (action === "claim-receipt") result = guard.claimReceipt({ key: entrypoint }, JSON.parse(fs.readFileSync(0, "utf8")));
  else throw Error("recovery_command_invalid");
  console.log(JSON.stringify(result));
} catch (error) { console.error(JSON.stringify({ status: "recovery_guard_failed", code: error.message })); process.exitCode = 1; }
