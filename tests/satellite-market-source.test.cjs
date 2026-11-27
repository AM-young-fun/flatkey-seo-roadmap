require("./register-ui-modules.cjs");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const { quarterMembershipHash } = require("../src/lib/quarter-membership.ts");
const { keywordMarketAssignmentSchema } = require("../src/lib/keyword-market-policy.ts");
const { syncWorkflowMarketAssignment, verifiedWorkflowMarketAssignment } =
  require("../src/lib/services/keyword-market-assignment.ts");

const original = keywordMarketAssignmentSchema.parse({
  primaryCountry: "US", language: "en", secondaryMarkets: [{ country: "BR", reason: "Exact Brazilian market evidence for the source word" }],
  evidence: "Independent original source and search review", reviewedAt: "2026-11-26T00:00:00.000Z",
});
const rearranged = { evidence: original.evidence, language: original.language, reviewedAt: original.reviewedAt,
  primaryCountry: original.primaryCountry, secondaryMarkets: [{ reason: original.secondaryMarkets[0].reason, country: "BR" }] };

test("satellite readback verifies the two genuine workflow digest representations after JSONB reorders fields", () => {
  const legacy = createHash("sha256").update(JSON.stringify(original)).digest("hex");
  const canonical = quarterMembershipHash(original);
  assert.notEqual(legacy, canonical);
  assert.deepEqual(verifiedWorkflowMarketAssignment(rearranged, legacy), original);
  assert.deepEqual(verifiedWorkflowMarketAssignment(rearranged, canonical), original);
  assert.equal(verifiedWorkflowMarketAssignment({ ...rearranged, evidence: "A replacement that was never saved with either digest" }, legacy), null);
  assert.equal(verifiedWorkflowMarketAssignment({ ...rearranged, evidence: original.evidence + " " }, legacy), null);
  assert.equal(verifiedWorkflowMarketAssignment({ ...rearranged, primaryCountry: "JP" }, canonical), null);
  assert.equal(verifiedWorkflowMarketAssignment(rearranged, "0".repeat(64)), null);
});

test("new task market reviews write the canonical digest and preserve the existing primary market", async () => {
  let write;
  const tx = {
    $executeRaw: async () => [],
    siteKeyword: { findUnique: async () => ({ keyword: { text: "example keyword" } }) },
    keywordSourceRow: {
      findUnique: async () => ({ snapshot: original }),
      upsert: async item => { write = item; },
    },
  };
  await syncWorkflowMarketAssignment(tx, {
    siteDomain: "modelfit.cc", keywordId: "some-keyword", keyword: "example keyword",
    country: "BR", language: "pt-BR", reviewedAt: "2026-11-27T01:00:00.000Z",
    evidence: [{ label: "Brazilian exact original evidence" }],
  });
  assert.equal(write.update.snapshot.primaryCountry, "US");
  assert.equal(write.update.snapshot.language, "en");
  assert.equal(write.update.snapshot.secondaryMarkets[0].country, "BR");
  assert.equal(write.update.snapshotHash, quarterMembershipHash(write.update.snapshot));
});
