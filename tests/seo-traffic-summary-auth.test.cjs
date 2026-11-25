const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
require("./register-ui-modules.cjs");
const original = Module._load;
Module._load = function(name, parent, ...args) {
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
};
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
});
