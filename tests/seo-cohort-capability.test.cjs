const assert = require("node:assert/strict"), { test } = require("node:test");
const { resolveCohortCollectionGate, collectOptionalApiCohorts } = require("../scripts/seo-cohort-capability.cjs");
const options = { coverageStart: "2026-11-12T08:00:00Z", importing: true, token: "fixture-only", range: { start: "2026-11-10", end: "2026-11-10" } };
const record = { version: 1, siteDomain: "flatkey.ai", observedAt: "2026-11-11T10:00:00.000Z", timezone: "America/Los_Angeles", rows: [] };

test("unverified coverage performs no capability request, no funnel, and leaves the legacy import payload byte-for-byte unchanged", async () => {
  let requests = 0, funnels = 0;
  const gate = await resolveCohortCollectionGate({ ...options, coverageStart: null, fetchImpl: async () => { requests++; throw Error("unexpected request"); } });
  assert.deepEqual(gate, { enabled: false, reason: "coverage_start_unverified" });
  const actual = await collectOptionalApiCohorts(record, {}, gate, async () => { funnels++; return []; });
  assert.equal(actual, record); assert.equal(JSON.stringify(actual), JSON.stringify(record)); assert.equal(requests, 0); assert.equal(funnels, 0);
  assert.equal(Object.hasOwn(actual, "apiCohorts"), false);
});

test("legacy 6ed response or capability failure cannot add a new field even with a configured coverage epoch", async () => {
  for (const response of [Response.json({ record: null, status: "missing" }), Response.json({ capabilities: { apiCohorts: 2 } }), new Response("Forbidden", { status: 403 })]) {
    const gate = await resolveCohortCollectionGate({ ...options, fetchImpl: async (url, init) => {
      assert.equal(new URL(url).origin, "https://flatkey-seo-roadmap.vercel.app"); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
      assert.equal(init.headers.authorization, "Bearer fixture-only"); assert.equal(init.body, undefined);
      return response;
    } });
    assert.equal(gate.enabled, false);
    const actual = await collectOptionalApiCohorts(record, {}, gate, () => { throw Error("unexpected funnel"); });
    assert.equal(actual, record); assert.equal(Object.hasOwn(actual, "apiCohorts"), false);
  }
  const failed = await resolveCohortCollectionGate({ ...options, fetchImpl: async () => { throw Error("secret diagnostic must not propagate"); } });
  assert.deepEqual(failed, { enabled: false, reason: "platform_capability_unavailable" });
});

test("explicit new API capability enables only the separately verified collector and preserves source time", async () => {
  const gate = await resolveCohortCollectionGate({ ...options, fetchImpl: async () => Response.json({ capabilities: { apiCohorts: 1 }, record: null }) });
  assert.deepEqual(gate, { enabled: true, reason: "platform_schema_v1_verified" });
  const rows = [{ fixture: true }];
  const actual = await collectOptionalApiCohorts(record, { start: "2026-10-01" }, gate, async (query, proof) => {
    assert.equal(query.start, "2026-10-01"); assert.equal(proof.now.toISOString(), record.observedAt); assert.equal(proof.verifiedTimezone, record.timezone); return rows;
  });
  assert.equal(actual.apiCohorts, rows); assert.equal(Object.hasOwn(record, "apiCohorts"), false);
});

test("read-only collection needs verified coverage but no importer capability or write token", async () => {
  const gate = await resolveCohortCollectionGate({ ...options, importing: false, token: undefined, fetchImpl: () => { throw Error("unexpected platform request"); } });
  assert.deepEqual(gate, { enabled: true, reason: "read_only_no_import" });
});
