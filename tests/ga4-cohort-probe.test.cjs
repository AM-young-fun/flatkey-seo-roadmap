const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path");
const { PROBE_BRANCH, assertProbeExecution, createProbeCases, runCohortProbe, aggregateShape } = require("../scripts/ga4-cohort-probe.cjs");
const now = new Date("2026-11-11T12:00:00Z");
const token = "probe-test-token-not-a-credential";
const table = { funnelTable: { dimensionHeaders: [{ name: "funnelStepName" }], metricHeaders: [{ name: "activeUsers" }], rows: [
  { dimensionValues: [{ value: "1. Registration" }], metricValues: [{ value: "2" }] },
  { dimensionValues: [{ value: "2. Outcome" }], metricValues: [{ value: "1" }] },
] } };

test("probe CLI is exact-branch dispatch only and refuses write secrets, coverage and all extra arguments", () => {
  const env = { GITHUB_REF: PROBE_BRANCH, GITHUB_EVENT_NAME: "workflow_dispatch", GA4_COHORT_PROBE_OUTPUT_DIR: "/tmp/fixture" };
  assert.doesNotThrow(() => assertProbeExecution(env, []));
  for (const change of [{ GITHUB_REF: "refs/heads/main" }, { GITHUB_REF: "refs/heads/codex/another" }, { GITHUB_EVENT_NAME: "schedule" },
    { SEO_IMPORT_TOKEN: "fixture" }, { SEO_DINGTALK_CONFIG: "fixture" }, { GA4_COHORT_COVERAGE_START: "2026-10-01T00:00:00Z" }, { GA4_COHORT_PROBE_OUTPUT_DIR: "" }]) {
    assert.throws(() => assertProbeExecution({ ...env, ...change }, []));
  }
  assert.throws(() => assertProbeExecution(env, ["--import"]));
});

test("four fixed diagnostic cases exercise date, country, organic source and both independent horizons without coverage", () => {
  const cases = createProbeCases(now);
  assert.equal(cases.length, 4);
  assert.deepEqual(cases.map(row => row.query.scope), ["all-channels", "session-organic-search", "all-channels", "session-organic-search"]);
  assert.ok(cases.every(row => row.query.start === "2026-09-30" && row.query.end === "2026-10-06"));
  for (const row of cases) {
    assert.equal(row.request.funnel.isOpenFunnel, false);
    const [registration, outcome] = row.request.funnel.steps;
    assert.match(JSON.stringify(registration), /20260930/);
    assert.doesNotMatch(JSON.stringify(outcome), /Organic Search|countryId/);
    if (row.query.scope === "session-organic-search") {
      assert.match(JSON.stringify(registration), /Organic Search/); assert.match(JSON.stringify(registration), /"JP"/);
    }
    assert.ok(row.observationEnd < "2026-11-09");
    assert.equal(row.coverageStart, undefined);
  }
});

test("probe makes one timezone proof and four read-only report requests without rates, imports or readiness claims", async () => {
  const requests = [], scopes = [];
  const result = await runCohortProbe({ now, getToken: async scope => { scopes.push(scope); return token; }, fetchImpl: async (url, init) => {
    requests.push({ url, ...init, body: JSON.parse(init.body) });
    assert.equal(init.redirect, "error"); assert.equal(init.method, "POST");
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    return Response.json(requests.length === 1 ? { metadata: { timeZone: "America/Los_Angeles" } } : table);
  } });
  assert.deepEqual(scopes, ["https://www.googleapis.com/auth/analytics.readonly"]);
  assert.equal(requests.length, 5);
  assert.match(requests[0].url, /:runReport$/);
  assert.ok(requests.slice(1).every(row => row.url === "https://analyticsdata.googleapis.com/v1alpha/properties/541304395:runFunnelReport"));
  assert.equal(result.success, true); assert.equal(result.imported, false); assert.equal(result.coverageVerified, false); assert.equal(result.conversionRates, null);
  assert.ok(result.queries.every(row => row.receipt.status === "api_accepted" && row.receipt.responseSha256.length === 64));
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /"ready"|registeredUsers|convertedUsers|"rate"|Bearer|probe-test-token/);
});

test("unverified timezone blocks every funnel query; no guessed LA timezone or empty success", async () => {
  for (const body of [{}, { metadata: { timeZone: "UTC" } }]) {
    let calls = 0;
    const result = await runCohortProbe({ now, getToken: async () => token, fetchImpl: async () => { calls++; return Response.json(body); } });
    assert.equal(calls, 1); assert.equal(result.success, false); assert.deepEqual(result.queries, []);
    assert.equal(result.timezoneVerification.verified, false);
  }
});

test("provider rejection retains sanitized error and continues the remaining bounded diagnostic cases", async () => {
  let calls = 0;
  const result = await runCohortProbe({ now, getToken: async () => token, fetchImpl: async () => {
    calls++;
    if (calls === 1) return Response.json({ metadata: { timeZone: "America/Los_Angeles" } });
    if (calls === 2) return Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", message: `Unsupported date field. Bearer ${token}` } }, { status: 400 });
    return Response.json(table);
  } });
  assert.equal(calls, 5); assert.equal(result.success, false);
  assert.equal(result.queries[0].receipt.providerError.status, "INVALID_ARGUMENT");
  assert.match(result.queries[0].receipt.providerError.message, /Unsupported date/);
  assert.doesNotMatch(JSON.stringify(result), /probe-test-token/);
});

test("diagnostic artifact excludes unknown labels and nonnumeric arbitrary values", () => {
  const shape = aggregateShape({ funnelTable: { rows: [{ dimensionValues: [{ value: "private user text" }], metricValues: [{ value: "private text" }] }] } });
  assert.equal(shape.rows[0].step, null); assert.deepEqual(shape.rows[0].values, [null]);
  assert.doesNotMatch(JSON.stringify(shape), /private/);
});

test("HTTP 200 without a funnel table remains failed diagnostic evidence", async () => {
  let calls = 0;
  const result = await runCohortProbe({ now, getToken: async () => token, fetchImpl: async () => {
    calls++;
    return Response.json(calls === 1 ? { metadata: { timeZone: "America/Los_Angeles" } } : {});
  } });
  assert.equal(calls, 5); assert.equal(result.success, false);
  assert.ok(result.queries.every(row => row.receipt.status === "invalid_response"));
});

test("workflow probe receives only existing Google read credentials; main production and all notification gates remain closed for branch", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/seo-daily.yml"), "utf8");
  const probe = workflow.split("  cohort-probe:\n")[1].split("  collect:\n")[0];
  assert.match(probe, /github\.event_name == 'workflow_dispatch'/);
  assert.match(probe, /github\.ref == 'refs\/heads\/codex\/ga4-registration-cohorts-20261111'/);
  assert.match(probe, /inputs\.business_only == true/); assert.match(probe, /inputs\.send_notifications == false/);
  assert.match(probe, /!inputs\.report_only && !inputs\.periods_only && !inputs\.verify_dingtalk && !inputs\.send_report/);
  assert.match(probe, /secrets\.SEO_GOOGLE_SERVICE_ACCOUNT_JSON/);
  assert.doesNotMatch(probe, /SEO_IMPORT_TOKEN|SEO_DINGTALK_CONFIG|COVERAGE_START|--import/);
  assert.match(workflow.split("  collect:\n")[1].split("    runs-on:")[0], /github\.ref == 'refs\/heads\/main'/);
  const script = fs.readFileSync(path.join(__dirname, "../scripts/ga4-cohort-probe.cjs"), "utf8");
  assert.doesNotMatch(script, /loadEnvConfig|prisma|saveBusinessAnalytics|parseApiCohortResponse/);
});

test("Vercel prevents automatic main and exact probe branch deployment while retaining other branch defaults", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../vercel.json"), "utf8"));
  assert.deepEqual(config.git.deploymentEnabled, { main: false, "codex/ga4-registration-cohorts-20261111": false });
  assert.deepEqual(config.regions, ["sin1"]); assert.equal(config.crons.length, 1);
});
