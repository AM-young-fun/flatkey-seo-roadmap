const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");
require("./register-ui-modules.cjs");

const original = Module._load;
const writes = [];
const reads = [];
Module._load = function (name, parent, ...rest) {
  if (name === "@/lib/seo-workflow-http") return { readWorkflowBody: request => request.json() };
  if (name === "@/lib/services/satellite-quarter") return {
    applySatelliteQuarter: async (command, actor) => {
      writes.push({ command, actor });
      return { status: "SATELLITE_QUARTER_APPLIED" };
    },
    loadSatelliteQuarterReceipt: async requestId => {
      reads.push(requestId);
      return { readbackVerified: true };
    },
  };
  if (name === "@/lib/auth") return { isAuthEnabled: () => true, isValidAuthToken: async () => false };
  if (name === "@/lib/services/import-tokens") return {
    authenticateImportToken: async request => request.headers.get("authorization") === "Bearer authorized-collector",
  };
  if (name === "@/lib/services/display-change") return { displayDataChanged: async () => {} };
  if (name === "@/lib/services/pre-freeze-market-identities" || name === "@/lib/services/quarter-membership") return {};
  return original.call(this, name, parent, ...rest);
};
const route = require("../src/app/api/keywords/quarter-membership/route.ts");


const url = "https://seo.example/api/keywords/quarter-membership";
const headers = { authorization: "Bearer authorized-collector", "content-type": "application/json" };
const post = (body, requestHeaders = headers) => route.POST(new Request(url, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) }));
test("automation is limited to the supplemental command and exact receipt", async () => {
  assert.equal((await post({ action: "stage_new_words" })).status, 403);
  assert.equal((await post({ action: "preview_identities" })).status, 403);
  assert.equal((await post({ action: "apply_satellite_quarter" }, { ...headers, origin: "https://seo.example" })).status, 403);
  assert.equal((await route.GET(new Request(url + "?membershipRequestId=original-id", { headers }))).status, 403);
  assert.equal((await route.GET(new Request(url + "?satelliteRequestId=bad", { headers: { authorization: "Bearer wrong" } }))).status, 403);
  assert.deepEqual(writes, []);
  assert.deepEqual(reads, []);
  const command = { action: "apply_satellite_quarter", requestId: "satellite-example" };
  assert.equal((await post(command)).status, 200);
  assert.equal((await route.GET(new Request(url + "?satelliteRequestId=satellite-example", { headers }))).status, 200);
  assert.deepEqual(writes, [{ command, actor: "collector" }]);
  assert.deepEqual(reads, ["satellite-example"]);
});
