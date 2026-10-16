const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts/prepare-production-db.mjs");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runtimeUrl = "postgresql://runtime-user:fictional-runtime-password@aws-0-us-east-1.pooler.supabase.com:5432/runtime_db?sslmode=require&connection_limit=99&connect_timeout=500&pool_timeout=400&schema=public";
const directUrl = "postgresql://migration-user:fictional-direct-password@db.fake-project.supabase.co:5432/migration_db?sslmode=verify-full&connection_limit=21&connect_timeout=300&pool_timeout=200&application_name=schema%20preparation";
const productionEnv = extras => ({ VERCEL_ENV: "production", DATABASE_URL: runtimeUrl, LOGIN_PWD: "fictional-login-password", ...extras });

// Execute the actual build step with a fake process and intercepted imports.
// No real child process, network connection, environment secret, or delay runs.
async function runPreparation(env, results = [{ status: 0, stderr: "", stdout: "" }]) {
  const calls = [], waits = [], logs = [];
  const environment = { ...env };
  const output = ts.transpileModule(fs.readFileSync(script, "utf8"), {
    fileName: "prepare-production-db.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const dependencies = {
    "node:child_process": { spawnSync: (command, args, options) => {
      calls.push({ command, args, options: structuredClone(options) });
      return results[Math.min(calls.length - 1, results.length - 1)];
    } },
    "node:timers/promises": { setTimeout: async milliseconds => { waits.push(milliseconds); } },
    "node:url": { URL },
    "../src/lib/database-url.cjs": require("../src/lib/database-url.cjs"),
  };
  const restrictedRequire = name => {
    if (!(name in dependencies)) throw new Error(`Unstubbed build dependency: ${name}`);
    return dependencies[name];
  };
  let error;
  try {
    await new AsyncFunction("require", "exports", "process", "console", output)(
      restrictedRequire, {}, { env: environment, execPath: "/fake/node" },
      { log: (...values) => logs.push(values.join(" ")), warn: (...values) => logs.push(values.join(" ")), error: (...values) => logs.push(values.join(" ")) },
    );
  } catch (caught) { error = caught; }
  return { calls, waits, logs, error, environment };
}

test("the production schema CLI prefers DIRECT_URL, preserves its endpoint, and never changes the parent environment", async () => {
  const env = productionEnv({ DIRECT_URL: directUrl });
  const result = await runPreparation(env);
  assert.equal(result.error, undefined);
  assert.equal(result.calls.length, 1);
  const call = result.calls[0], url = new URL(call.options.env.DATABASE_URL), before = new URL(directUrl);
  assert.equal(url.hostname, before.hostname);
  assert.equal(url.port, "5432");
  assert.equal(url.username, before.username);
  assert.equal(url.password, before.password);
  assert.equal(url.pathname, before.pathname);
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(url.searchParams.get("application_name"), "schema preparation");
  assert.equal(url.searchParams.get("connection_limit"), "1");
  assert.equal(url.searchParams.get("connect_timeout"), "20");
  assert.equal(url.searchParams.get("pool_timeout"), "20");
  assert.deepEqual(result.environment, env);
  assert.equal(call.options.timeout, 60_000);
  assert.equal(call.options.killSignal, "SIGKILL");
  assert.deepEqual(call.args, ["node_modules/prisma/build/index.js", "db", "execute", "--file", "prisma/ranking-import.sql", "--schema", "prisma/schema.prisma"]);
  assert.ok(!result.logs.join(" ").includes("fictional-"));
});

test("without DIRECT_URL the schema CLI retains the original session pool port instead of forcing transaction mode", async () => {
  const result = await runPreparation(productionEnv());
  assert.equal(result.error, undefined);
  const url = new URL(result.calls[0].options.env.DATABASE_URL);
  assert.equal(url.hostname, new URL(runtimeUrl).hostname);
  assert.equal(url.port, "5432");
  assert.equal(url.searchParams.has("pgbouncer"), false);
  assert.equal(url.searchParams.get("connection_limit"), "1");
  assert.equal(url.searchParams.get("connect_timeout"), "20");
  assert.equal(url.searchParams.get("pool_timeout"), "20");
});

test("an explicitly configured CLI transaction endpoint is left intact rather than silently rewriting its port", async () => {
  const raw = "postgresql://app:fictional-password@other-provider.example:6543/db?pgbouncer=true&sslmode=require";
  const result = await runPreparation(productionEnv({ DIRECT_URL: raw }));
  assert.equal(result.error, undefined);
  const url = new URL(result.calls[0].options.env.DATABASE_URL);
  assert.equal(url.hostname, "other-provider.example");
  assert.equal(url.port, "6543");
  assert.equal(url.searchParams.get("pgbouncer"), "true");
  assert.equal(url.searchParams.get("sslmode"), "require");
});

test("a hung Prisma subprocess is force-killed after sixty seconds and fails the build after at most three attempts", async () => {
  const result = await runPreparation(productionEnv(), [{ status: null, signal: "SIGKILL", error: { code: "ETIMEDOUT" }, stdout: "", stderr: "" }]);
  assert.equal(result.calls.length, 3);
  for (const call of result.calls) {
    assert.equal(call.options.timeout, 60_000);
    assert.equal(call.options.killSignal, "SIGKILL");
    assert.equal(new URL(call.options.env.DATABASE_URL).searchParams.get("connection_limit"), "1");
  }
  assert.ok(result.error instanceof Error);
  assert.match(result.error.message, /database preparation failed/i);
  assert.ok(!/fictional-|postgresql:\/\//.test(result.error.message + result.logs.join(" ")));
  assert.equal(result.waits.length, 2);
});

test("transient connection failures retry safely, while a successful retry ends the loop", async () => {
  const result = await runPreparation(productionEnv(), [
    { status: 1, stderr: `P1001: could not connect to ${runtimeUrl}`, stdout: "" },
    { status: 0, stderr: "", stdout: "completed" },
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.calls.length, 2);
  assert.equal(result.waits.length, 1);
  assert.ok(!result.logs.join(" ").includes("fictional-runtime-password"));
  assert.ok(!result.logs.join(" ").includes("postgresql://"));
});

test("a non-transient SQL/schema failure stops immediately and never logs raw database output", async () => {
  const result = await runPreparation(productionEnv(), [{ status: 1, stderr: `P3018: syntax error at ${directUrl}`, stdout: "" }]);
  assert.equal(result.calls.length, 1);
  assert.equal(result.waits.length, 0);
  assert.ok(result.error instanceof Error);
  assert.ok(!/fictional-|postgresql:\/\//.test(result.error.message + result.logs.join(" ")));
});

test("non-production builds skip database preparation, and missing production prerequisites cannot spawn a client", async () => {
  const local = await runPreparation({ VERCEL_ENV: "preview" });
  assert.equal(local.error, undefined);
  assert.equal(local.calls.length, 0);
  for (const env of [productionEnv({ LOGIN_PWD: undefined }), productionEnv({ DATABASE_URL: undefined })]) {
    const result = await runPreparation(env);
    assert.ok(result.error instanceof Error);
    assert.equal(result.calls.length, 0);
  }
});
