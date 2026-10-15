const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildDatabaseUrl } = require("../src/lib/database-url.cjs");
const pooler = "aws-0-ap-southeast-1.pooler.supabase.com";

for (const port of [":5432", ""]) test(`serverless Supabase session endpoint ${port || "default port"} moves to transaction port with one client`, () => {
  const raw = `postgresql://user:p%40ss%3Aword@${pooler}${port}/project?sslmode=require&schema=public&application_name=seo%20monitor&connection_limit=10&pgbouncer=false`;
  const before = new URL(raw);
  const url = new URL(buildDatabaseUrl(raw, true));
  assert.equal(url.hostname, before.hostname);
  assert.equal(url.port, "6543");
  assert.equal(url.searchParams.get("pgbouncer"), "true");
  assert.equal(url.searchParams.get("connection_limit"), "1");
  assert.equal(url.searchParams.get("connect_timeout"), "20");
  assert.equal(url.searchParams.get("pool_timeout"), "20");
  assert.equal(url.username, before.username);
  assert.equal(url.password, before.password);
  assert.equal(url.pathname, before.pathname);
  for (const name of ["sslmode", "schema", "application_name"]) assert.deepEqual(url.searchParams.getAll(name), before.searchParams.getAll(name));
});

test("an existing transaction pool endpoint is idempotent and preserves explicit timeouts and other parameters", () => {
  const raw = `postgres://app:secret@${pooler}:6543/db?connect_timeout=9&pool_timeout=12&sslmode=verify-full&options=a&options=b`;
  const built = buildDatabaseUrl(raw, true);
  const url = new URL(built);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.port, "6543");
  assert.equal(url.searchParams.get("connection_limit"), "1");
  assert.equal(url.searchParams.get("pgbouncer"), "true");
  assert.equal(url.searchParams.get("connect_timeout"), "9");
  assert.equal(url.searchParams.get("pool_timeout"), "12");
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.deepEqual(url.searchParams.getAll("options"), ["a", "b"]);
  assert.equal(buildDatabaseUrl(built, true), built);
});

test("local runtime keeps session mode and explicit connection limits, defaulting missing limits to three", () => {
  const configured = new URL(buildDatabaseUrl(`postgresql://app:secret@${pooler}:5432/db?connection_limit=7&connect_timeout=8&pool_timeout=15&pgbouncer=false`, false));
  assert.equal(configured.port, "5432");
  assert.equal(configured.searchParams.get("connection_limit"), "7");
  assert.equal(configured.searchParams.get("pgbouncer"), "false");
  assert.equal(configured.searchParams.get("connect_timeout"), "8");
  assert.equal(configured.searchParams.get("pool_timeout"), "15");
  const fallback = new URL(buildDatabaseUrl("postgresql://app:secret@localhost:5432/db", false));
  assert.equal(fallback.port, "5432");
  assert.equal(fallback.searchParams.get("connection_limit"), "3");
  assert.equal(fallback.searchParams.get("connect_timeout"), "20");
  assert.equal(fallback.searchParams.get("pool_timeout"), "20");
  assert.equal(fallback.searchParams.has("pgbouncer"), false);
});

test("an explicit local Supabase transaction endpoint still uses PgBouncer compatibility", () => {
  const url = new URL(buildDatabaseUrl(`postgresql://app:secret@${pooler}:6543/db?connection_limit=6`, false));
  assert.equal(url.port, "6543");
  assert.equal(url.searchParams.get("pgbouncer"), "true");
  assert.equal(url.searchParams.get("connection_limit"), "6");
});

for (const [host, port] of [
  ["db.project.supabase.co", "5432"],
  ["pooler.supabase.com", "5432"],
  ["evilpooler.supabase.com", "5432"],
  ["aws.pooler.supabase.com.attacker.example", "5432"],
  ["aws.pooler.supabase.com.", "5432"],
  ["postgres.example.com", "5432"],
  ["postgres.example.com", "6543"],
  [pooler, "5433"],
]) test(`serverless leaves unrecognized endpoint ${host}:${port} intact`, () => {
  const raw = `postgresql://app:secret@${host}:${port}/db?sslmode=require&pgbouncer=false&connection_limit=11`;
  const url = new URL(buildDatabaseUrl(raw, true));
  assert.equal(url.hostname, new URL(raw).hostname);
  assert.equal(url.port, port);
  assert.equal(url.searchParams.get("pgbouncer"), "false");
  assert.equal(url.searchParams.get("sslmode"), "require");
  assert.equal(url.searchParams.get("connection_limit"), "1");
});

test("serverless overwrites duplicate connection limits once while retaining unrelated repeated values", () => {
  const url = new URL(buildDatabaseUrl(`postgresql://app:secret@${pooler}:5432/db?connection_limit=5&connection_limit=9&options=x&options=y`, true));
  assert.deepEqual(url.searchParams.getAll("connection_limit"), ["1"]);
  assert.deepEqual(url.searchParams.getAll("options"), ["x", "y"]);
});
