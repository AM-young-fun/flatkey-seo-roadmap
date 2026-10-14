/* global process, console */
import { spawnSync } from "node:child_process";

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
  const result = spawnSync(
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
    { encoding: "utf8", env: process.env },
  );
  if (result.status !== 0) {
    // Prisma failures can contain connection information. Keep credentials out
    // of deployment logs and fail before the new application replaces the old.
    throw new Error(
      "Production database preparation failed; the existing deployment is unchanged.",
    );
  }
  console.log("Production ranking import tables and indexes are ready.");
}
