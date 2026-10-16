const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);

let state;
const link = (siteDomain, keywordId, active = true) => ({ siteDomain, keywordId, active, topicId: "topic-1", origin: "PLANNED", targetUrls: [], sourceUrl: null });
const db = {
  seoSite: { findUnique: async ({ where }) => ["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(where.domain) ? { domain: where.domain, active: true } : null },
  $executeRaw: async (query) => {
    const sql = Array.isArray(query) ? query.join("") : query.sql;
    if (!sql.includes("keyword-cleanup:archive")) return 0;
    if (state.failArchive) throw new Error("simulated archive failure");
    const values = query.values;
    let count = 0;
    for (let index = 1; index < values.length - 1; index += 2) {
      const row = state.links.find(row => row.keywordId === values[index] && row.siteDomain === values.at(-1) && row.active);
      if (row) { Object.assign(row, { active: false, excludedAt: values[0], exclusionReason: values[index + 1] }); count++; }
    }
    return count;
  },
  $queryRaw: async (query, ...args) => {
    const sql = Array.isArray(query) ? query.join("") : query.sql;
    const values = Array.isArray(query) ? args : query.values;
    if (sql.includes("keyword-cleanup:candidates")) return state.links.filter(row => row.siteDomain === values[0] && row.active).map(row => {
      const keyword = state.keywords.find(keyword => keyword.id === row.keywordId);
      const observations = [...state.observations, ...state.pages].filter(record => record.siteDomain === row.siteDomain && record.keywordId === row.keywordId);
      return { keywordId: row.keywordId, text: keyword.text, firstTrackedAt: row.createdAt ?? new Date(), restoredAt: row.restoredAt ?? null, defaultVolume: keyword.defaultVolume ?? 0,
        targetUrls: row.targetUrls, topicTexts: row.topicTexts ?? [], hasSearchActivity: observations.some(record => record.clicks > 0 || record.impressions > 0),
        observedUrls: observations.filter(record => record.rank >= 1 && record.url).map(record => record.url),
        volumeHistory: [...state.volumes.filter(record => record.keywordId === row.keywordId).map(record => ({ region: record.region, volume: record.volume, dataDate: record.observedAt?.toISOString() ?? null })),
          ...state.observations.filter(record => record.keywordId === row.keywordId && record.source === "ahrefs" && record.volume != null).map(record => ({ region: record.region, volume: record.volume, dataDate: record.dataUpdatedAt?.toISOString() ?? null }))],
      };
    });
    return state.keywords.filter((keyword) => values.includes(keyword.text.toLowerCase()));
  },
  $transaction: async (callback) => {
    const before = structuredClone(state);
    try { return await callback(db); } catch (error) { state = before; throw error; }
  },
  rankingImport: {
    findUnique: async ({ where }) => state.batches.find((batch) => batch.requestId === where.requestId) ?? null,
    create: async ({ data }) => {
      const batch = { ...data, id: `batch-${state.batches.length}`, importedAt: new Date() };
      state.batches.push(batch);
      return batch;
    },
  },
  topic: {
    findMany: async ({ where }) => state.topics.filter((topic) => where.text.in.includes(topic.text)),
    createMany: async ({ data }) => { state.topics.push(...data); },
  },
  siteTopic: { createMany: async () => ({ count: 0 }) },
  topicRelation: { createMany: async () => ({ count: 0 }) },
  keyword: {
    createMany: async ({ data }) => { state.keywords.push(...data.map((keyword) => ({ active: true, ...keyword }))); },
    upsert: async ({ where, create, update }) => {
      state.keywordWrites += 1;
      let keyword = state.keywords.find((row) => row.text === where.text);
      if (keyword) Object.assign(keyword, update);
      else { keyword = { id: `keyword-${state.keywords.length + 1}`, ...create }; state.keywords.push(keyword); }
      return keyword;
    },
  },
  siteKeyword: {
    findMany: async ({ where, skip = 0, take }) => state.links.filter((row) => row.siteDomain === where.siteDomain)
      .filter((row) => where.active == null || row.active === where.active)
      .filter((row) => !where.keywordId?.in || where.keywordId.in.includes(row.keywordId))
      .filter((row) => !where.OR || where.OR.some((selector) => selector.keywordId?.in.includes(row.keywordId) || selector.keyword?.text.in.includes(state.keywords.find((keyword) => keyword.id === row.keywordId).text.toLowerCase())))
      .slice(skip, take == null ? undefined : skip + take)
      .map((row) => ({ ...row, keyword: state.keywords.find((keyword) => keyword.id === row.keywordId) })),
    count: async ({ where }) => state.links.filter(row => row.siteDomain === where.siteDomain && row.active === where.active).length,
    updateMany: async ({ where, data }) => {
      const matches = state.links.filter((row) => row.siteDomain === where.siteDomain && where.keywordId.in.includes(row.keywordId) && row.active === where.active);
      matches.forEach((row) => Object.assign(row, data));
      return { count: matches.length };
    },
    createMany: async ({ data }) => { state.links.push(...data); },
    upsert: async ({ where, create, update }) => {
      const key = where.siteDomain_keywordId;
      const existing = state.links.find((row) => row.siteDomain === key.siteDomain && row.keywordId === key.keywordId);
      if (existing) Object.assign(existing, update);
      else state.links.push({ active: true, ...create });
    },
  },
  siteKeywordTopic: { createMany: async () => ({ count: 0 }), upsert: async () => ({}) },
  keywordVolume: { createMany: async ({ data }) => { state.volumes.push(...data); } },
  keywordObservation: { createMany: async ({ data }) => { if (state.failWrite) throw new Error("simulated write failure"); state.observations.push(...data); } },
  keywordPageObservation: { createMany: async ({ data }) => { state.pages.push(...data); } },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const { rankingImportSchema } = require("../src/lib/ranking-import.ts");
const { importSeo } = require("../src/lib/services/seo-import.ts");
const { POST: review } = require("../src/app/api/keywords/review/route.ts");
const { POST: importCsv } = require("../src/app/api/keywords/import/route.ts");

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test.invalid/exclusions";
  state = {
    keywords: [{ id: "keep", text: "claude api", active: true }, { id: "remove", text: "unrelated query", active: true }],
    links: [link("flatkey.ai", "keep"), link("flatkey.ai", "remove", false), link("rackrate.org", "remove")],
    topics: [{ id: "topic-1", text: "LLM API Routing", active: true }],
    batches: [], observations: [], pages: [], volumes: [], keywordWrites: 0,
  };
});
const observation = (keyword, overrides = {}) => ({ keyword, source: "ahrefs", region: "US", rank: 12, collectedAt: "2026-10-14T02:30:00Z", ...overrides });
const payload = (overrides = {}) => rankingImportSchema.parse({ requestId: "exclusions-1", targetDomain: "flatkey.ai", ...overrides });
const requestReview = (body) => review(new Request("http://localhost/api/keywords/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const requestCsv = (csv, siteDomain = "flatkey.ai") => {
  const form = new FormData();
  form.set("siteDomain", siteDomain);
  form.set("file", new File([csv], "keywords.csv", { type: "text/csv" }));
  return importCsv(new Request("http://localhost/api/keywords/import", { method: "POST", body: form }));
};

test("mixed JSON imports skip reviewed exclusions across inventory, queries and pages without rejecting valid rows", async () => {
  const result = await importSeo(payload({
    inventory: [{ keyword: "UNRELATED QUERY", topic: "LLM API Routing" }],
    observations: [observation("Unrelated Query"), observation("claude api")],
    pages: [observation("unrelated query", { url: "https://flatkey.ai/page" })],
  }));
  assert.equal(result.imported, 1);
  assert.equal(result.excluded, 3);
  assert.deepEqual(state.observations.map((row) => row.keywordId), ["keep"]);
  assert.equal(state.pages.length, 0);
  assert.equal(state.links.find((row) => row.siteDomain === "flatkey.ai" && row.keywordId === "remove").active, false);
  assert.equal(state.keywords.find((row) => row.id === "remove").active, true);
});

test("automatic discoveries cannot resurrect excluded keywords and retry counts stay stable after a restore", async () => {
  const batch = payload({ allowNewKeywords: true, observations: [observation("UNRELATED QUERY")] });
  const result = await importSeo(batch);
  assert.equal(result.imported, 0);
  assert.equal(result.excluded, 1);
  assert.equal(state.topics.length, 1);
  assert.equal(state.observations.length, 0);
  const restored = await requestReview({ siteDomain: "flatkey.ai", action: "restore", keywords: ["Unrelated Query"] });
  assert.equal((await restored.json()).changed, 1);
  const retry = await importSeo(batch);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.excluded, 1);
  assert.equal(state.observations.length, 0);
  await importSeo(payload({ requestId: "restored-new-batch", observations: [observation("unrelated query")] }));
  assert.equal(state.observations.length, 1);
});

test("a site's exclusion does not suppress the same keyword's observations at another site", async () => {
  const result = await importSeo(payload({ targetDomain: "rackrate.org", observations: [observation("unrelated query")] }));
  assert.equal(result.imported, 1);
  assert.equal(result.excluded, 0);
  assert.equal(state.observations[0].siteDomain, "rackrate.org");
  assert.equal(state.links.find((row) => row.siteDomain === "flatkey.ai" && row.keywordId === "remove").active, false);
});

test("bulk review matches IDs and case-insensitive texts once, reports missing selectors and is reversible per site", async () => {
  const response = await requestReview({ siteDomain: "flatkey.ai", action: "exclude", keywordIds: ["keep", "keep", "unknown"], keywords: ["CLAUDE API", "not imported"] });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.matched, 1);
  assert.equal(result.changed, 1);
  assert.equal(result.unchanged, 0);
  assert.deepEqual(result.notFound, { keywordIds: ["unknown"], keywords: ["not imported"] });
  assert.equal(state.links.find((row) => row.siteDomain === "rackrate.org").active, true);
  assert.ok(state.keywords.every((row) => row.active));
  const again = await requestReview({ siteDomain: "flatkey.ai", action: "exclude", keywordIds: ["keep"] });
  assert.equal((await again.json()).changed, 0);
  const restore = await requestReview({ siteDomain: "flatkey.ai", action: "restore", keywordIds: ["keep"] });
  assert.equal((await restore.json()).changed, 1);
  assert.equal(state.links.find((row) => row.keywordId === "keep").active, true);
});

test("review rejects empty, unscoped and oversized requests before writing", async () => {
  for (const body of [
    { siteDomain: "all", action: "exclude", keywordIds: ["keep"] },
    { siteDomain: "flatkey.ai", action: "exclude" },
    { siteDomain: "flatkey.ai", action: "exclude", keywordIds: Array(501).fill("keep") },
  ]) {
    const response = await requestReview(body);
    assert.equal(response.status, 400);
  }
  assert.equal(state.links.find((row) => row.keywordId === "keep").active, true);
});

test("CSV imports skip excluded words regardless of casing and preserve active words and shared global state", async () => {
  const response = await requestCsv("keyword,topic,us_volume\nUNRELATED QUERY,LLM API Routing,900\nCLAUDE API,LLM API Routing,100\n");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.created, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.excluded, 1);
  assert.equal(result.skipped, 1);
  assert.equal(state.keywordWrites, 1);
  assert.deepEqual(state.volumes.map((row) => row.keywordId), ["keep"]);
  assert.equal(state.keywords.length, 2);
  assert.equal(state.links.find((row) => row.siteDomain === "flatkey.ai" && row.keywordId === "remove").active, false);
  assert.equal(state.links.find((row) => row.siteDomain === "rackrate.org").active, true);
});

test("a CSV consisting only of excluded words succeeds with an explicit skipped count", async () => {
  const response = await requestCsv("keyword,topic\nunrelated query,Old removed topic\n");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.excluded, 1);
  assert.equal(state.keywordWrites, 0);
});

test("business relevance blocks standalone noise and currency/count queries before JSON discovery or inventory creation", async () => {
  state.keywords.push({ id: "noise", text: "yes", active: true });
  state.links.push(link("flatkey.ai", "noise"), link("rackrate.org", "noise"));
  const noise = ["yes", "true", "ture", "$10", "100"];
  const result = await importSeo(payload({
    allowNewKeywords: true,
    inventory: noise.map((keyword) => ({ keyword, topic: "LLM API Routing" })),
    observations: noise.map((keyword) => observation(keyword)),
  }));
  assert.equal(result.imported, 0);
  assert.equal(result.excluded, 10);
  assert.equal(state.keywords.length, 3);
  assert.equal(state.observations.length, 0);
  assert.equal(state.links.find((row) => row.siteDomain === "flatkey.ai" && row.keywordId === "noise").active, true);
  assert.equal(state.links.find((row) => row.siteDomain === "rackrate.org" && row.keywordId === "noise").active, true);
  assert.equal(state.keywords.find((row) => row.id === "noise").active, true);
});

test("CSV relevance screening skips noise without removing candidates or creating new noise", async () => {
  state.keywords.push({ id: "noise", text: "yes", active: true });
  state.links.push(link("flatkey.ai", "noise"), link("rackrate.org", "noise"));
  const response = await requestCsv("keyword,topic\nyes,LLM API Routing\ntrue,LLM API Routing\nture,LLM API Routing\n$10,LLM API Routing\n100,LLM API Routing\nclaude api,LLM API Routing\n");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.excluded, 5);
  assert.equal(result.updated, 1);
  assert.equal(result.created, 0);
  assert.equal(state.keywords.length, 3);
  assert.equal(state.links.find((row) => row.siteDomain === "flatkey.ai" && row.keywordId === "noise").active, true);
  assert.equal(state.links.find((row) => row.siteDomain === "rackrate.org" && row.keywordId === "noise").active, true);
});

test("relevance exclusions roll back with a failed mixed import", async () => {
  state.keywords.push({ id: "noise", text: "yes", active: true });
  state.links.push(link("flatkey.ai", "noise"));
  state.failWrite = true;
  await assert.rejects(importSeo(payload({ allowNewKeywords: true, observations: [observation("yes"), observation("claude api")] })), /simulated write failure/);
  assert.equal(state.links.find((row) => row.keywordId === "noise").active, true);
  assert.equal(state.batches.length, 0);
});

const ago = days => new Date(Date.now() - days * 86400000);
const addTracked = (id, text, overrides = {}) => {
  state.keywords.push({ id, text, active: true });
  state.links.push({ ...link("flatkey.ai", id), createdAt: ago(120), ...overrides });
};
const addZeroHistory = (id, observed = true, repeat = false) => {
  for (const region of ["US", "JP", "ES", "BR"]) for (const days of [60, 30, 0]) state.volumes.push({
    keywordId: id, region, volume: 0, source: "csv", fetchedAt: ago(days), observedAt: observed ? ago(repeat ? 0 : days) : null,
  });
};
const volumeOnly = requestId => payload({ requestId, observations: [observation("claude api", { rank: undefined, volume: 10 })] });

test("each successful import screens all memberships without removing existing candidates", async () => {
  addTracked("noise", "yes");
  const result = await importSeo(volumeOnly("full-site-cleanup"));
  assert.equal(result.cleanup.unrelated, 1);
  assert.equal(result.cleanup.archived, 0);
  assert.equal(result.cleanup.recommended, 1);
  const archived = state.links.find(row => row.keywordId === "noise");
  assert.equal(archived.active, true);
  assert.match(result.cleanup.records[0].reason, /业务无关/);
  assert.equal(state.keywords.find(row => row.id === "noise").active, true);
});

test("dated sustained zeros remain candidates and preserve source history and other-site membership", async () => {
  addTracked("old", "legacy connector endpoint");
  state.links.push({ ...link("rackrate.org", "old"), createdAt: ago(5) });
  addZeroHistory("old");
  const result = await importSeo(volumeOnly("old-zero-cleanup"));
  assert.equal(result.cleanup.sustainedZero, 1);
  assert.equal(result.cleanup.archived, 0);
  assert.equal(state.links.find(row => row.keywordId === "old" && row.siteDomain === "flatkey.ai").active, true);
  assert.equal(state.links.find(row => row.keywordId === "old" && row.siteDomain === "rackrate.org").active, true);
  assert.equal(state.volumes.filter(row => row.keywordId === "old").length, 12);
  const next = await importSeo(volumeOnly("repeat-zero-review"));
  assert.equal(next.cleanup.archived, 0);
  assert.equal(state.links.find(row => row.keywordId === "old" && row.siteDomain === "flatkey.ai").active, true);
});

test("models, recent site tracking, real activity, valid pages and positive demand protect against automatic zero-volume cleanup", async () => {
  for (const [id, text, overrides] of [
    ["model", "gpt-7 api", {}],
    ["new", "recent connector endpoint", { createdAt: ago(10) }],
    ["target", "nova 2 api", { targetUrls: ["https://flatkey.ai/models/nova-2"] }],
    ["activity", "integration request endpoint", {}],
    ["page", "connector callback endpoint", {}],
    ["positive", "compatible connector endpoint", {}],
  ]) { addTracked(id, text, overrides); addZeroHistory(id); }
  state.observations.push({ keywordId: "activity", siteDomain: "flatkey.ai", region: "US", source: "gsc", rank: null, impressions: 1 });
  state.observations.push({ keywordId: "page", siteDomain: "flatkey.ai", region: "US", source: "ahrefs", rank: 40, url: "https://flatkey.ai/connector" });
  state.volumes.push({ keywordId: "positive", region: "BR", volume: 1, source: "csv", observedAt: null });
  const result = await importSeo(volumeOnly("protected-cleanup"));
  assert.equal(result.cleanup.archived, 0);
  assert.ok(state.links.filter(row => row.keywordId !== "remove").every(row => row.active));
});

test("undated legacy CSV history and repeated reads of one source day never trigger automatic cleanup", async () => {
  addTracked("undated", "archived connector endpoint");
  addTracked("repeat", "repeated connector endpoint");
  addZeroHistory("undated", false);
  addZeroHistory("repeat", true, true);
  const result = await importSeo(volumeOnly("undated-cleanup"));
  assert.equal(result.cleanup.sustainedZero, 0);
  assert.equal(state.links.find(row => row.keywordId === "undated").active, true);
  assert.equal(state.links.find(row => row.keywordId === "repeat").active, true);
});

test("JSON inventory stores upstream volume date separately and leaves missing provenance undated", async () => {
  await importSeo(payload({ requestId: "provenance-json", inventory: [{ keyword: "claude api", topic: "LLM API Routing", volumeObservedAt: "2026-10-01T00:00:00Z", marketVolumes: { US: 0 } }] }));
  assert.equal(state.volumes[0].observedAt.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(state.volumes[0].fetchedAt, undefined);
  await importSeo(payload({ requestId: "undated-json", inventory: [{ keyword: "claude api", topic: "LLM API Routing", marketVolumes: { JP: 0 } }] }));
  assert.equal(state.volumes[1].observedAt, null);
});

test("CSV accepts explicit ISO source dates, leaves old format undated and rejects future or invalid dates", async () => {
  const dated = await requestCsv("keyword,topic,us_volume,volume_observed_at\nclaude api,LLM API Routing,0,2026-10-01\n");
  assert.equal(dated.status, 200);
  assert.equal(state.volumes[0].observedAt.toISOString(), "2026-10-01T00:00:00.000Z");
  const undated = await requestCsv("keyword,topic,jp_volume\nclaude api,LLM API Routing,0\n");
  assert.equal(undated.status, 200);
  assert.equal(state.volumes[1].observedAt, null);
  for (const invalid of ["2026-02-30", "2099-01-01", "2026/10/01"]) {
    const response = await requestCsv(`keyword,topic,us_volume,volume_observed_at\nclaude api,LLM API Routing,0,${invalid}\n`);
    assert.equal(response.status, 400);
  }
  assert.equal(state.volumes.length, 2);
});

test("repeated uploads of the same dated zero CSV do not manufacture a sixty-day history", async () => {
  addTracked("repeat", "repeated connector endpoint");
  for (let index = 0; index < 3; index++) {
    const response = await requestCsv("keyword,topic,us_volume,jp_volume,es_volume,br_volume,volume_observed_at\nrepeated connector endpoint,LLM API Routing,0,0,0,0,2026-10-01\n");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cleanup.sustainedZero, 0);
  }
  assert.equal(state.links.find(row => row.keywordId === "repeat").active, true);
});

test("daily screening never calls the archive writer or removes a zero-volume candidate", async () => {
  addTracked("old", "legacy connector endpoint");
  addZeroHistory("old");
  state.failArchive = true;
  const result = await importSeo(volumeOnly("no-auto-archive"));
  assert.equal(result.cleanup.archived, 0);
  assert.equal(state.links.find(row => row.keywordId === "old").active, true);
  assert.equal(state.observations.length, 1);
  assert.equal(state.batches.length, 1);
});

test("later JSON inventory preserves curated target URLs and topic while still accepting query evidence", async () => {
  const curated = state.links.find(row => row.keywordId === "keep");
  Object.assign(curated, { pool: "FORMAL", curationId: "approved-review", mappingStatus: "NEEDS_REMAP", targetUrls: [], candidateUrls: ["https://flatkey.ai/claude"], topicId: "topic-1" });
  const before = structuredClone(curated);
  const result = await importSeo(payload({ requestId: "curated-import", inventory: [{ keyword: "claude api", topic: "Old incorrect topic", targetUrls: ["https://flatkey.ai/wrong-old-page"] }], observations: [observation("claude api")] }));
  assert.equal(result.imported, 2);
  assert.deepEqual(state.links.find(row => row.keywordId === "keep"), before);
  assert.equal(state.observations.length, 1);
});

test("CSV volume updates cannot move a curated formal keyword back to an old topic", async () => {
  const curated = state.links.find(row => row.keywordId === "keep");
  Object.assign(curated, { pool: "FORMAL", curationId: "approved-review", targetUrls: ["https://flatkey.ai/claude"] });
  const before = structuredClone(curated);
  state.topics.push({ id: "old-topic", text: "Old incorrect topic", active: true });
  state.keywords.find(row => row.id === "keep").topicId = "topic-1";
  const response = await requestCsv("keyword,topic,us_volume\nclaude api,Old incorrect topic,300\n");
  assert.equal(response.status, 200);
  assert.deepEqual(state.links.find(row => row.keywordId === "keep"), before);
  assert.equal(state.keywords.find(row => row.id === "keep").topicId, "topic-1");
  assert.equal(state.volumes[0].volume, 300);
});
