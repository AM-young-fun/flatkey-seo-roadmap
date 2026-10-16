const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { canMonitorKeyword, readPageAuditVerdict } = require("../src/lib/keyword-monitoring.ts");
test("only a verified formal keyword with its own site page enters the rank worklist", () => {
  const target = { siteDomain: "flatkey.ai", pool: "FORMAL", mappingStatus: "READY", targetUrls: ["https://flatkey.ai/models/claude"] };
  assert.equal(canMonitorKeyword(target), true);
  for (const change of [{ mappingStatus: "MODEL_PROTECTED" }, { mappingStatus: "NEEDS_BUILD" }, { mappingStatus: "RECORDED" }, { pool: "RESEARCH" }, { targetUrls: [] }, { targetUrls: ["https://other.example/page"] }]) {
    assert.equal(canMonitorKeyword({ ...target, ...change }), false);
  }
});

test("latest inconclusive or negative manual page evidence blocks an otherwise ready keyword", () => {
  const target = { siteDomain: "flatkey.ai", pool: "FORMAL", mappingStatus: "READY", targetUrls: ["https://flatkey.ai/models/claude"] };
  for (const latestPageAuditVerdict of ["REVIEW", "MISSING", "MISMATCH"]) assert.equal(canMonitorKeyword({ ...target, latestPageAuditVerdict }), false, latestPageAuditVerdict);
  for (const latestPageAuditVerdict of [undefined, null, "VERIFIED"]) assert.equal(canMonitorKeyword({ ...target, latestPageAuditVerdict }), true, String(latestPageAuditVerdict));
});

test("VERIFIED evidence never revives a candidate, protected model target or invalid page association", () => {
  const target = { siteDomain: "flatkey.ai", pool: "FORMAL", mappingStatus: "READY", targetUrls: ["https://flatkey.ai/models/claude"], latestPageAuditVerdict: "VERIFIED" };
  for (const mappingStatus of ["MODEL_PROTECTED", "RECORDED", "NEEDS_BUILD", "NEEDS_REMAP", "NEEDS_EXPANSION", "UNMAPPED", "MULTIPLE_CANDIDATES"]) {
    assert.equal(canMonitorKeyword({ ...target, mappingStatus }), false, mappingStatus);
  }
  for (const pool of ["RESEARCH", "ARCHIVED", "MERGED"]) assert.equal(canMonitorKeyword({ ...target, pool }), false, pool);
  for (const targetUrls of [[], ["https://other.example/page"], ["https://flatkey.ai.attacker.example/page"]]) assert.equal(canMonitorKeyword({ ...target, targetUrls }), false);
});

test("absence of manual page evidence preserves pre-existing site monitoring rules", () => {
  for (const siteDomain of ["rackrate.org", "modelfit.cc"]) {
    const target = { siteDomain, pool: "RESEARCH", mappingStatus: "RECORDED", targetUrls: [`https://${siteDomain}/models/model`] };
    assert.equal(canMonitorKeyword(target), true);
    assert.equal(canMonitorKeyword({ ...target, latestPageAuditVerdict: null }), true);
    assert.equal(canMonitorKeyword({ ...target, targetUrls: ["https://flatkey.ai/page"] }), false);
  }
});

test("existing malformed audit snapshots fail closed rather than becoming absent or verified evidence", () => {
  for (const snapshot of [null, undefined, [], true, 1, "VERIFIED", {}, { status: "VERIFIED" }, { verdict: "verified" }, { verdict: "UNKNOWN" }, { verdict: true }]) {
    assert.equal(readPageAuditVerdict(snapshot), "REVIEW", JSON.stringify(snapshot));
  }
});

test("reading an existing audit preserves its exact recognized verdict without inventing publication proof", () => {
  for (const verdict of ["VERIFIED", "MISSING", "MISMATCH", "REVIEW"]) assert.equal(readPageAuditVerdict({ verdict }), verdict);
});
