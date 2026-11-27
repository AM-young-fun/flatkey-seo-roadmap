const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
require("./register-ui-modules.cjs");
const original = Module._load;
function mockLoad(name, parent, ...args) {
  if (name === "@/lib/auth") return { AUTH_COOKIE_NAME: "test-auth", isAuthEnabled: () => true, isValidAuthToken: async () => false };
  if (name === "@/lib/services/import-tokens") return {
    authenticateImportToken: async request => request.headers.get("authorization") === "Bearer verified-collector",
  };
  if (name === "@/lib/seo-analytics-access") return {
    privateAnalyticsHeaders: { "Cache-Control": "private, no-store" },
    authorizeAnalyticsRead: async request => request.headers.get("cookie") === "test=verified-user",
  };
  if (name === "@/lib/prisma") return { prisma: { seoAnalyticsDay: { findMany: async () => [] } } };
  if (name === "@/lib/seo-workflow-http") return {
    readWorkflowBody: request => request.json(),
    workflowErrorResponse: error => Response.json({ message: error.message }, { status: 400 }),
  };
  return original.call(this, name, parent, ...args);
}
Module._load = mockLoad;
const route = require("../src/app/api/seo/traffic-summary/route.ts");
const { NextRequest } = require("next/server");
const { proxy } = require("../src/proxy.ts");
Module._load = original;
const url = "https://example.com/api/seo/traffic-summary";

test("the collector reaches the exact route and the handler independently checks reads and writes", async () => {
  const collector = { authorization: "Bearer verified-collector" };
  for (const method of ["GET", "POST"]) {
    const result = await proxy(new NextRequest(url, { method, headers: collector }));
    assert.equal(result.headers.get("x-middleware-next"), "1");
  }
  assert.equal((await route.GET(new Request(url))).status, 401);
  assert.equal((await route.GET(new Request(url, { headers: collector }))).status, 200);
  assert.equal((await route.GET(new Request(url, { headers: { cookie: "test=verified-user" } }))).status, 200);
  assert.equal((await route.POST(new Request(url, { method: "POST", headers: { cookie: "test=verified-user" } }))).status, 403);
  assert.equal((await route.POST(new Request(url, { method: "POST", headers: { ...collector, origin: "https://example.com" } }))).status, 403);
  const range = await route.GET(new Request(url + "?start=2026-11-18&end=2026-11-20", { headers: collector }));
  assert.equal(range.status, 200);
  const { daily } = await range.json();
  assert.deepEqual(daily.map(point => [point.date, point.site.organicSessions]), [
    ["2026-11-18", null], ["2026-11-19", null], ["2026-11-20", null],
  ]);
  assert.equal((await route.GET(new Request(url + "?start=2026-11-18", { headers: collector }))).status, 400);
});

test("only the saved old-post view reaches its own collector authenticator", async () => {
  const endpoint = "https://example.com/api/seo/analytics";
  const headers = { authorization: "Bearer verified-collector" };
  const shortlist = endpoint + "?view=old-post-shortlist";
  assert.equal((await proxy(new NextRequest(shortlist, { headers }))).headers.get("x-middleware-next"), "1");
  assert.equal((await proxy(new NextRequest(shortlist, { method: "POST", headers }))).status, 401);
  assert.equal((await proxy(new NextRequest(endpoint + "?view=traffic-overview", { headers }))).status, 401);
});

test("the core keyword archive POST reaches the handler only with a verified collector or normal login", async () => {
  const endpoint = "https://example.com/api/seo/growth/core-keywords";
  const collector = { authorization: "Bearer verified-collector" };
  Module._load = mockLoad;
  try {
    assert.equal((await proxy(new NextRequest(endpoint, { method: "POST" }))).status, 401);
    assert.equal((await proxy(new NextRequest(endpoint, { method: "POST", headers: { authorization: "Bearer invalid" } }))).status, 401);
    assert.equal((await proxy(new NextRequest(endpoint, { method: "GET", headers: collector }))).status, 401);
    assert.equal((await proxy(new NextRequest(endpoint + "/other", { method: "POST", headers: collector }))).status, 401);
    assert.equal((await proxy(new NextRequest(endpoint, { method: "POST", headers: { ...collector, origin: "https://other.test" } }))).status, 401);
    assert.equal((await proxy(new NextRequest(endpoint, { method: "POST", headers: collector }))).headers.get("x-middleware-next"), "1");
  } finally {
    Module._load = original;
  }
});
