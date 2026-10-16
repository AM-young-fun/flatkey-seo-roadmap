/* global process, console */
import { spawnSync } from "node:child_process";
import { URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

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
  // Schema preparation keeps the configured direct/session connection. The
  // serverless transaction pool is selected separately by the runtime client.
  let migrationUrl;
  try {
    migrationUrl = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL);
  } catch {
    throw new Error("Production database URL is invalid.");
  }
  migrationUrl.searchParams.set("connection_limit", "1");
  migrationUrl.searchParams.set("connect_timeout", "20");
  migrationUrl.searchParams.set("pool_timeout", "20");
  const environment = { ...process.env, DATABASE_URL: migrationUrl.toString() };
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
    { encoding: "utf8", env: environment, timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 },
  );
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`Preparing production database (attempt ${attempt}/3).`);
    result = execute();
    if (result.status === 0) break;
    const output = `${result.stderr ?? ""}${result.stdout ?? ""}`;
    const timedOut = result.error?.code === "ETIMEDOUT";
    const code = timedOut ? "TIMEOUT" : output.match(/\bP\d{4}\b/)?.[0] ?? (/response from the engine was empty/i.test(output) ? "ENGINE_EMPTY" : "UNKNOWN");
    console.warn(`Database preparation attempt ${attempt} failed (${code}).`);
    const retryable = ["TIMEOUT", "ENGINE_EMPTY", "P1001", "P1002", "P1017", "P2024"].includes(code) ||
      (code === "UNKNOWN" && /\bconnection\b|timed out|\btimeout\b/i.test(output));
    if (attempt === 3 || !retryable) break;
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
