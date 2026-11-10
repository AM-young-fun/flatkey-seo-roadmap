const { test } = require("node:test"), assert = require("node:assert/strict");
const { requestHash, receiptMatches } = require("../scripts/seo-workflow-bridge.cjs");
const { reconciliationBinding } = require("../scripts/seo-digest-dws.cjs");
const origin = "https://flatkey-seo-roadmap.vercel.app";
const command = { requestId: "bridge-fixture", action: "save_task", expectedVersion: 0, record: { id: "fixture", title: "reviewed" } };
const receipt = () => ({ version: 1, origin, requestId: command.requestId, requestHash: requestHash(command), result: { stored: true, storage: "database" } });
test("bridge confirms only same destination, id, exact request hash and durable receipt", () => {
 assert.equal(receiptMatches(receipt(), origin, command), true);
 assert.equal(receiptMatches({ ...receipt(), origin: "http://127.0.0.1:4100" }, origin, command), false);
 assert.equal(receiptMatches({ ...receipt(), requestId: "other" }, origin, command), false);
 assert.equal(receiptMatches({ ...receipt(), requestHash: "0".repeat(64) }, origin, command), false);
 assert.equal(receiptMatches(receipt(), origin, { ...command, record: { ...command.record, title: "changed" } }), false);
 assert.equal(receiptMatches({ stored: true, storage: "database" }, origin, command), false);
 assert.equal(receiptMatches({ ...receipt(), result: { stored: true, storage: "local_preview" } }, origin, command), false);
});
const delivery = () => ({ version: 1, origin, id: "seo-digest-delivery:2026-11-10", owner: "fixture-owner", fencingToken: 1, reportId: "seo-digest:2026-11-10:" + "a".repeat(16), reportHash: "a".repeat(64), destination: "cid7d5au0J8RAKDDxMR+VNh1w==", robotCode: "dingoyxfe0koa0dme6fz", status: "provider_accepted", processQueryKey: "fixture-only-no-real-message" });
test("digest reconciliation binds production origin, group, robot and report hash", () => {
 assert.equal(reconciliationBinding(delivery(), origin).reportHash, "a".repeat(64));
 for (const patch of [{ origin: "http://127.0.0.1:4100" }, { destination: "wrong-group" }, { robotCode: "wrong-bot" }, { reportHash: "b".repeat(64) }, { reportId: "other-report" }, { version: undefined }, { processQueryKey: null }]) {
  assert.throws(() => reconciliationBinding({ ...delivery(), ...patch }, origin), /untrusted_delivery_receipt/);
 }
 assert.throws(() => reconciliationBinding(delivery(), "http://127.0.0.1:4100"), /untrusted_delivery_receipt/);
});
