/* global process, console */
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import databaseUrl from "../src/lib/database-url.cjs";

if (process.env.VERCEL_ENV !== "production") {
  console.log(
    "Skipping production database preparation outside a production deployment.",
  );
} else {
  if (!process.env.DATABASE_URL)
    throw new Error("Production DATABASE_URL is required.");
  if (!process.env.LOGIN_PWD)
    throw new Error(
      "Production LOGIN_PWD is required to protect import credential access.",
    );
  // The SQL is additive, transactional, and repeatable. Never use db push here:
  // an unrelated schema change must not drop production columns during a build.
  // The SQL file uses one explicit transaction and transaction-scoped locks.
  // It can share the serverless pool without reserving another session slot.
  const environment = { ...process.env, DATABASE_URL: databaseUrl.buildDatabaseUrl(process.env.DATABASE_URL, true) };
  const execute = () => spawnSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "db",
      "execute",
      "--file",
      "prisma/ranking-import.sql",
      "--schema",
      "prisma/schema.prisma",
    ],
    { encoding: "utf8", env: environment },
  );
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = execute();
    if (result.status === 0) break;
    const output = `${result.stderr ?? ""}${result.stdout ?? ""}`;
    const code = output.match(/\bP\d{4}\b/)?.[0] ?? (/response from the engine was empty/i.test(output) ? "ENGINE_EMPTY" : "UNKNOWN");
    console.warn(`Database preparation attempt ${attempt} failed (${code}).`);
    if (attempt === 3 || !/P1001|P1002|P1017|connection|timed out|timeout|response from the engine was empty/i.test(output)) break;
    await delay(attempt * 1000);
  }
  if (result.status !== 0) {
    // Prisma failures can contain connection information. Keep credentials out
    // of deployment logs and fail before the new application replaces the old.
    throw new Error(
      "Production database preparation failed; the existing deployment is unchanged.",
    );
  }
  console.log("Production ranking import tables and indexes are ready.");
}
