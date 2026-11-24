const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { buildConversionProjection, conversionReportLines } = require("../src/lib/seo-conversion.ts");
const now = new Date("2026-11-05T20:00:00Z"), scope = { site: "flatkey.ai", start: "2026-10-01", end: "2026-10-01", country: "all", timezone: "America/Los_Angeles" };
const registration = (id, at = "2026-10-01T12:00:00Z") => ({ registrationId: `reg-${id}`, userKey: `private-user-${id}`, visitorKey: `private-visitor-${id}`, registeredAt: at });
const payment = (id, at = "2026-10-02T12:00:00Z") => ({ transactionId: `private-transaction-${id}`, userKey: `private-user-${id}`, paidAt: at, amount: 10, successful: true, isTest: false, creditGrant: false });
function evidence() { return { version: 1, source: "existing-authorized-readonly", site: scope.site, start: scope.start, end: scope.end, country: "all", timezone: scope.timezone,
  observedAt: now.toISOString(), populationBusiness: "api", attribution: "first-user-organic-search", registeredUsers: 2,
  coverage: { registrationsComplete: true, firstRegistrationHistoryVerified: true, acquisitionVerified: true, visitorPopulationComplete: true, visitorEligibilityVerified: true,
    paymentHistoryComplete: true, paymentCompleteThrough: now.toISOString(), gpuStagesVerified: true, gpuComplete: true },
  registrations: [registration("a"), registration("b")], visitors: [{ visitorKey: "private-visitor-a", enteredAt: "2026-10-01T11:00:00Z", eligibleAtEntry: true }, { visitorKey: "private-visitor-b", enteredAt: "2026-10-01T11:00:00Z", eligibleAtEntry: true }, { visitorKey: "existing-account", enteredAt: "2026-10-01T11:00:00Z", eligibleAtEntry: false }],
  payments: [payment("a"), payment("b", "2026-11-02T12:00:00Z")], gpuEvents: [{ id: "inquiry-1", stage: "inquiries", occurredAt: "2026-10-01T11:00:00Z", valid: true, isTest: false }] }; }
const build = (row, selected = scope, at = now) => buildConversionProjection(selected, [{ reference: "archive:verified-source", payload: row }], at);
test("mature API cohorts use same first-registered users and qualified visitors while GPU stages stay separate", () => {
  const result = build(evidence());
  assert.equal(result.api.registration.eligibleVisitors.value, 2); assert.equal(result.api.registration.firstRegistrations.value, 2); assert.equal(result.api.registration.rate.value, 1);
  assert.equal(result.api.firstPayment30d.rate.value, .5); assert.equal(result.api.firstPayment30d.registeredUsers.value, 2);
  assert.equal(result.gpu.inquiries.value, 1); assert.equal(result.gpu.quotes.value, 0); assert.equal(result.gpu.quotes.unit, "quotes");
  assert.equal(result.api.firstPayment30d.cohorts[0].maturity, "mature"); assert.doesNotMatch(JSON.stringify(result), /private-user|private-visitor|private-transaction/);
});
test("duplicate signup events and payment receipts cannot create new users or first payments", () => {
  const row = evidence(); row.registrations.push({ ...registration("a"), registrationId: "repeat-signup", registeredAt: "2026-10-01T15:00:00Z" }); row.payments.push(payment("a"));
  const result = build(row); assert.equal(result.api.registration.firstRegistrations.value, 2); assert.equal(result.api.firstPayment30d.confirmedFirstPayers.value, 1);
});
test("an earlier actual first registration stays in its original cohort despite a repeated signup in this window", () => {
  const row = evidence(); row.registrations = [registration("a", "2026-09-30T12:00:00Z"), { ...registration("a"), registrationId: "later-event" }]; row.registeredUsers = 0;
  const result = build(row); assert.equal(result.api.firstPayment30d.registeredUsers.value, 0); assert.equal(result.api.firstPayment30d.rate.value, null);
});
test("registered return visits never remove the original eligible visitor denominator", () => {
  const row = evidence(); row.visitors.push({ visitorKey: "private-visitor-a", enteredAt: "2026-10-01T18:00:00Z", eligibleAtEntry: false });
  assert.equal(build(row).api.registration.eligibleVisitors.value, 2);
});
test("registration rate uses only the same-window eligible visitor subset, while the first-payment cohort keeps all original registrations", () => {
  const row = evidence(); row.visitors = [row.visitors[0], { visitorKey: "not-registered", enteredAt: "2026-10-01T11:00:00Z", eligibleAtEntry: true }];
  const result = build(row); assert.equal(result.api.registration.firstRegistrations.value, 2); assert.equal(result.api.registration.eligibleVisitors.value, 2);
  assert.equal(result.api.registration.eligibleFirstRegistrations.value, 1); assert.equal(result.api.registration.rate.value, .5);
  assert.equal(result.api.firstPayment30d.registeredUsers.value, 2); assert.equal(result.api.firstPayment30d.rate.value, .5);
});
test("missing stable payment identity retains all original registered users and suppresses the whole cohort rate", () => {
  const row = evidence(); row.registrations[1].userKey = null;
  const result = build(row); assert.equal(result.api.firstPayment30d.registeredUsers.value, 2); assert.equal(result.api.firstPayment30d.rate.value, null);
  assert.match(result.api.firstPayment30d.rate.reason, /未从分母删除/);
  row.payments = [];
  assert.equal(build(row).api.firstPayment30d.confirmedFirstPayers.value, null);
});
test("missing members and delayed ledgers do not become zero or a smaller denominator", () => {
  const row = evidence(); row.registrations.pop(); row.coverage.paymentCompleteThrough = "2026-10-10T00:00:00Z";
  const result = build(row); assert.equal(result.api.firstPayment30d.registeredUsers.value, 2); assert.equal(result.api.firstPayment30d.confirmedFirstPayers.value, null);
  assert.equal(result.api.firstPayment30d.rate.value, null); assert.equal(result.api.firstPayment30d.cohorts[0].registeredUsers, 2);
});
test("immature cohorts show confirmed progress without a final rate", () => {
  const row = evidence(), selected = { ...scope, start: "2026-10-25", end: "2026-10-25" }; Object.assign(row, selected); row.registeredUsers = 1; row.registrations = [registration("a", "2026-10-25T12:00:00Z")]; row.payments = [payment("a", "2026-10-26T12:00:00Z")];
  const result = build(row, selected); assert.equal(result.api.firstPayment30d.cohorts[0].maturity, "immature"); assert.equal(result.api.firstPayment30d.confirmedFirstPayers.value, 1); assert.equal(result.api.firstPayment30d.rate.value, null);
});
test("the 720 hour payment window excludes an exact end-boundary payment and non-payments", () => {
  const row = evidence(); row.payments = [payment("a", "2026-10-31T12:00:00Z"), { ...payment("b"), amount: 0 }, { ...payment("a"), transactionId: "test", isTest: true }, { ...payment("b"), transactionId: "failed", successful: false }];
  assert.equal(build(row).api.firstPayment30d.rate.value, 0);
});
test("an earlier payment cannot be replaced by a later renewal inside the window", () => {
  const row = evidence(); row.payments = [payment("a", "2026-09-20T12:00:00Z"), { ...payment("a"), transactionId: "renewal" }];
  const result = build(row); assert.equal(result.api.firstPayment30d.rate.value, null); assert.equal(result.api.firstPayment30d.confirmedFirstPayers.value, null); assert.match(result.api.firstPayment30d.rate.reason, /付款早于/);
});
test("unlinked successful payments cannot turn into a zero paying-user count", () => {
  const row = evidence(); row.payments = [{ ...payment("a"), userKey: null }];
  const result = build(row); assert.equal(result.api.firstPayment30d.confirmedFirstPayers.value, null); assert.equal(result.api.firstPayment30d.rate.value, null);
  assert.equal(result.api.firstPayment30d.registeredUsers.value, 2); assert.match(result.api.firstPayment30d.rate.reason, /关联缺失当未付费/);
});
test("unqualified visitors, legacy GA funnels, wrong scopes and absent sources cannot produce rates or placeholder zeros", () => {
  const row = evidence(); row.coverage.visitorEligibilityVerified = false; assert.equal(build(row).api.registration.rate.value, null);
  for (const input of [null, { apiCohorts: [{ registeredUsers: 10, convertedUsers: 8, rate: .8 }] }, { ...evidence(), country: "JP" }]) {
    const result = build(input); assert.equal(result.api.registration.firstRegistrations.value, null); assert.equal(result.gpu.deals.value, null); assert.equal(result.readiness.status, "unavailable");
  }
});
test("GPU source absence is independent of API identity readiness, and reports explain business attribution", () => {
  const row = evidence(); row.coverage.gpuStagesVerified = false;
  const result = build(row); assert.equal(result.gpu.deals.value, null); assert.equal(result.api.firstPayment30d.rate.value, .5);
  const text = conversionReportLines(result).join("\n"); assert.match(text, /GPU业务承接/); assert.match(text, /API自然获客/); assert.doesNotMatch(text, /GitHub/);
});
