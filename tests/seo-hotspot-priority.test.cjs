const { test } = require("node:test");
const assert = require("node:assert/strict");
const { HOTSPOT_WINDOW_MS, activeHotspotPriority, compareHotspotPriority } = require("../scripts/lib/seo-hotspot-priority.cjs");
const { dueTasks } = require("../scripts/lib/seo-task-due.cjs");

const now = new Date("2026-11-23T08:00:00Z");
const at = "2026-11-23T02:00:00Z";
const observedAt = "2026-11-23T03:00:00Z";
function evidence(role, overrides = {}) {
  const marker = { event: "model-release-a", at, basis: "event", role, verified: "1", ...overrides };
  return { label: "seo-hotspot-v1;" + Object.entries(marker).map(([key, value]) => key + "=" + value).join(";"),
    url: role === "official" ? "https://vendor.example/news/release" : "https://community.example/discussions/release", observedAt };
}
const pair = () => [evidence("official"), evidence("demand")];
function task(id, overrides = {}) {
  return { id, siteDomain: "modelfit.cc", kind: "research", status: "researching", dueAt: "2026-11-23T07:00:00Z",
    country: "US", language: "en", dependencies: [], research: null, evidence: [], ...overrides };
}
function snapshot(tasks) {
  return { tasks, workWeek: { overdueTaskIds: [], reviewOrReleaseTaskIds: [], dependencyStatuses: {} } };
}

test("verified official facts and independent demand metadata give current events P0", () => {
  const result = activeHotspotPriority({ evidence: pair() }, now);
  assert.equal(result.priority, "P0");
  assert.equal(result.eventKey, "model-release-a");
  assert.equal(result.expiresAt, "2026-11-30T02:00:00.000Z");
  assert.equal(compareHotspotPriority({ evidence: pair() }, {}, now), -1);
});

test("a hot word, arbitrary priority, or a single source cannot declare P0", () => {
  for (const value of [{ priority: "P0", nextAction: "热点最高优先" }, { evidence: [evidence("official")] },
    { evidence: [evidence("demand")] }, { evidence: [evidence("official"), evidence("official")] }]) {
    assert.equal(activeHotspotPriority(value, now), null);
  }
});

test("the pair must refer to the same stable event, anchor and basis", () => {
  for (const patch of [{ event: "other-event" }, { at: "2026-11-23T01:00:00Z" }, { basis: "rise" }]) {
    assert.equal(activeHotspotPriority({ evidence: [evidence("official"), evidence("demand", patch)] }, now), null);
  }
  const matching = { evidence: [evidence("official", { basis: "rise" }), evidence("demand", { basis: "rise" })] };
  assert.equal(activeHotspotPriority(matching, now).basis, "rise");
});

test("timestamps must be real, timezone-explicit, nonfuture and observed after the event", () => {
  for (const value of ["2026-11-23", "2026-11-31T02:00:00Z", "2026-11-23T25:00:00Z", "2026-11-23T09:00:00Z"]) {
    assert.equal(activeHotspotPriority({ evidence: [evidence("official", { at: value }), evidence("demand", { at: value })] }, now), null);
  }
  for (const stamp of ["2026-11-23T01:00:00Z", "2026-11-23T09:00:00Z", "unknown"]) {
    assert.equal(activeHotspotPriority({ evidence: pair().map(row => ({ ...row, observedAt: stamp })) }, now), null);
  }
});

test("a scan of old news cannot renew the seven-day hotspot window", () => {
  const old = "2026-11-16T07:59:59Z";
  assert.equal(activeHotspotPriority({ evidence: [evidence("official", { at: old }), evidence("demand", { at: old })] }, now), null);
  const boundary = new Date(now.getTime() - HOTSPOT_WINDOW_MS).toISOString();
  const data = { evidence: [evidence("official", { at: boundary }), evidence("demand", { at: boundary })] };
  assert.equal(activeHotspotPriority(data, now).priority, "P0");
  assert.equal(activeHotspotPriority(data, new Date(now.getTime() + 1)), null);
});

test("HTTPS links and distinct sources are required, including tracking URL aliases", () => {
  const official = evidence("official");
  for (const url of [official.url, official.url + "?utm_source=community#discussion", "https://www.vendor.example/news/release/",
    "http://community.example/release", "https://user:password@community.example/release", "https://community.example:8443/release"]) {
    assert.equal(activeHotspotPriority({ evidence: [official, { ...evidence("demand"), url }] }, now), null);
  }
  assert.equal(activeHotspotPriority({ evidence: pair().map(({ url: _url, ...row }) => ({ ...row, artifact: "/local/proof.json" })) }, now), null);
});

test("malformed, unknown, duplicate and unverified marker fields are rejected", () => {
  for (const row of [evidence("official", { verified: "0" }), evidence("official", { role: "unverified" }),
    evidence("official", { event: "event;injection" }), { ...evidence("official"), label: evidence("official").label + ";verified=1" },
    { ...evidence("official"), label: evidence("official").label + ";extra=1" }]) {
    assert.equal(activeHotspotPriority({ evidence: [row, evidence("demand")] }, now), null);
  }
});

test("existing evidence locations are read without creating a Task priority field or changing records", () => {
  const value = { evidence: [evidence("official")], brief: { evidence: [evidence("demand")] }, research: { evidence: pair() } };
  const before = JSON.stringify(value);
  assert.equal(activeHotspotPriority(value, now).priority, "P0");
  assert.equal(JSON.stringify(value), before);
  assert.equal(Object.hasOwn(value, "priority"), false);
  assert.equal(activeHotspotPriority({ research: { evidence: pair() } }, now).priority, "P0");
  assert.equal(activeHotspotPriority(value, new Date("invalid")), null);
});

test("timezone aliases refer to the same real event rather than making another event identity", () => {
  const value = { evidence: [evidence("official"), evidence("demand", { at: "2026-11-23T10:00:00+08:00" })] };
  assert.equal(activeHotspotPriority(value, now).eventKey, "model-release-a");
});

test("eligible current hotspots lead older ordinary work; ties retain due date and ID ordering", () => {
  const ordinary = task("ordinary-old", { dueAt: "2026-11-19T07:00:00Z" });
  const hotB = task("hot-b", { evidence: pair() });
  const hotA = task("hot-a", { evidence: pair() });
  const oldHot = task("hot-old", { dueAt: "2026-11-20T07:00:00Z", evidence: pair() });
  const value = snapshot([ordinary, hotB, hotA, oldHot]);
  const before = JSON.stringify(value);
  assert.deepEqual(dueTasks(value, "cluster", now).candidates.map(row => row.task.id), ["hot-old", "hot-a", "hot-b", "ordinary-old"]);
  assert.equal(JSON.stringify(value), before);
});

test("hotspot sorting cannot admit future, blocked dependencies, review queue or out-of-scope work", () => {
  const value = snapshot([
    task("future", { evidence: pair(), dueAt: "2026-11-24T07:00:00Z" }),
    task("dependent", { evidence: pair(), dependencies: ["unfinished"] }),
    task("await-review", { evidence: pair(), status: "review_pending" }),
    task("product", { evidence: pair(), channel: "product" }),
    task("foreign", { evidence: pair(), pageUrl: "https://outside.example/page" }),
    task("rackrate-blog", { evidence: pair(), siteDomain: "rackrate.org", kind: "blog" }),
    task("allowed"),
  ]);
  value.workWeek.reviewOrReleaseTaskIds.push("await-review");
  assert.deepEqual(dueTasks(value, "cluster", now).candidates.map(row => row.task.id), ["allowed"]);
  assert.equal(dueTasks(snapshot([task("hot", { evidence: pair() })]), "cluster", new Date("2026-11-22T08:00:00Z")).candidates.length, 0);
});

test("expired priority falls back to the original ordinary task order", () => {
  const stale = [evidence("official", { at: "2026-11-15T01:00:00Z" }), evidence("demand", { at: "2026-11-15T01:00:00Z" })];
  const value = snapshot([task("expired", { evidence: stale }), task("older", { dueAt: "2026-11-20T07:00:00Z" })]);
  assert.deepEqual(dueTasks(value, "cluster", now).candidates.map(row => row.task.id), ["older", "expired"]);
});

test("registered extra work follows due regular tasks and leaves later regular slots protected", () => {
  const regular = task("regular", { dueAt: "2026-11-23T07:00:00Z" });
  const extra = task("extra", { capacityClass: "authorized_hotspot_extra", evidence: pair() });
  assert.deepEqual(dueTasks(snapshot([extra, regular]), "cluster", now).candidates.map(row => row.task.id), ["regular", "extra"]);
  const later = { ...regular, dueAt: "2026-11-23T09:30:00Z" };
  assert.deepEqual(dueTasks(snapshot([extra, later]), "cluster", now).candidates, []);
  assert.deepEqual(dueTasks(snapshot([extra, { ...later, status: "verified" }]), "cluster", now).candidates.map(row => row.task.id), ["extra"]);
});
