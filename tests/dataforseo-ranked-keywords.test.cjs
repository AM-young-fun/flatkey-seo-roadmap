const assert = require("node:assert/strict");
const { test, before, beforeEach, afterEach } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let api, rootDir;
const runId = "fictional-ranked-keywords-trial-v1";
const collectedAt = "2026-10-16T06:00:00.000Z";
const credentials = { DATAFORSEO_API_LOGIN: "fictional-dfs-login@example.invalid", DATAFORSEO_API_PASSWORD: "fictional-dfs-password-no-real-account" };
const clone = value => structuredClone(value);

before(async () => {
  api = await import(pathToFileURL(path.resolve(__dirname, "../scripts/dataforseo-ranked-keywords.mjs")).href);
});
beforeEach(async () => { rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "flatkey-dfs-unit-")); });
afterEach(async () => { if (rootDir) await fs.rm(rootDir, { recursive: true, force: true }); });

function item(keyword = "fictional model api", overrides = {}) {
  return {
    se_type: "google",
    keyword_data: { se_type: "google", keyword, location_code: 2840, language_code: "en",
      keyword_info: { search_volume: 0, last_updated_time: "2026-10-01 04:00:00 +00:00" },
      serp_info: { last_updated_time: "2026-10-12 03:00:00 +00:00" } },
    ranked_serp_element: { se_type: "google", last_updated_time: "2026-10-14 03:00:00 +00:00",
      serp_item: { type: "organic", rank_group: 17, rank_absolute: 25, url: "https://flatkey.ai/models/fictional-model", is_lost: false },
      serp_info: { last_updated_time: "2026-10-13 03:00:00 +00:00" } },
    ...overrides,
  };
}

function raw(items = [item()]) {
  return { version: "0.1.fictional", status_code: 20000, status_message: "Ok.", tasks_count: 1, tasks_error: 0,
    tasks: [{ id: "fictional-task-id", status_code: 20000, status_message: "Ok.", result_count: 1,
      data: { api: "dataforseo_labs", function: "ranked_keywords", se_type: "google", target: "flatkey.ai", location_code: 2840, language_code: "en" },
      result: [{ se_type: "google", target: "flatkey.ai", location_code: 2840, language_code: "en", total_count: items.length, items_count: items.length, items }] }],
  };
}

async function outputFiles(directory = rootDir) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await outputFiles(location));
    else if (entry.isFile()) files.push(location);
  }
  return files;
}

const options = overrides => ({ execute: true, runId, limit: 1000, ...overrides });
const context = (fetchFn, env = credentials) => ({ rootDir, env: { ...env }, fetchFn, now: () => new Date(collectedAt) });
const normalize = body => api.normalizeRankedKeywords(body, { runId, collectedAt, limit: 1000 });

test("CLI defaults to the fixed first-trial dry run and requires an explicit execute flag", () => {
  assert.deepEqual(api.parseCliArgs([]), { execute: false, runId: "flatkey-us-en-ranked-keywords-first-trial-v1", limit: 1000 });
  assert.equal(api.parseCliArgs(["--execute"]).execute, true);
  const custom = api.parseCliArgs(["--run-id", runId, "--limit", "250"]);
  assert.equal(custom.execute, false);
  assert.equal(custom.runId, runId);
  assert.equal(custom.limit, 250);
  for (const argv of [["--unknown"], ["--execute=false"], ["--limit", "0"], ["--limit", "1.5"], ["--limit", "NaN"], ["--run-id", "../unsafe-run"]]) {
    assert.throws(() => api.parseCliArgs(argv), undefined, JSON.stringify(argv));
  }
});

test("budget quotes use integer microdollars for the fixed request plus requested keyword limit", () => {
  for (const limit of [1, 10, 250, 1000]) {
    const quote = api.quoteForLimit(limit);
    assert.equal(quote.maxCostMicros, 12000 + 120 * limit);
    assert.equal(Number(quote.maxCostUsd), quote.maxCostMicros / 1_000_000);
    assert.ok(Number.isSafeInteger(quote.maxCostMicros));
  }
  assert.equal(Number(api.quoteForLimit(1000).maxCostUsd), 0.132);
});

test("dry run requires no credentials and never performs a fetch or creates an execution journal", async () => {
  let calls = 0;
  await api.runRankedKeywordsCollector(api.parseCliArgs([]), context(async () => { calls++; throw new Error("dry-run must not fetch"); }, {}));
  assert.equal(calls, 0);
  const files = await outputFiles();
  assert.ok(!files.some(file => /journal/i.test(file)), files.join("\n"));
});

test("task is one fixed US English organic top-100 live request without unsupported SERP-info options", () => {
  const task = api.buildRankedKeywordsTask(250, runId);
  assert.equal(task.target, "flatkey.ai");
  assert.equal(task.location_code, 2840);
  assert.equal(task.language_code, "en");
  assert.equal(task.limit, 250);
  assert.equal(task.offset, 0);
  assert.equal(task.historical_serp_mode, "live");
  assert.equal(task.include_clickstream_data, false);
  assert.deepEqual(task.item_types, ["organic"]);
  assert.ok(task.filters.some(filter => Array.isArray(filter) && filter[0] === "ranked_serp_element.serp_item.type" && filter[1] === "=" && filter[2] === "organic"));
  assert.ok(task.filters.some(filter => Array.isArray(filter) && filter[0] === "ranked_serp_element.serp_item.rank_group" && filter[1] === "<=" && filter[2] === 100));
  assert.equal(Object.hasOwn(task, "include_serp_info"), false);
  assert.equal(task.tag, runId);
});

test("normalization preserves organic group rank, zero volume and independent provider timestamps", () => {
  const result = normalize(raw());
  assert.equal(result.source, "dataforseo_labs");
  assert.equal(result.realTimeSerpFetch, false);
  assert.equal(result.rows.length, 1);
  const observation = result.rows[0];
  assert.equal(observation.keyword, "fictional model api");
  assert.equal(observation.rank_group, 17);
  assert.equal(observation.rank_absolute, 25);
  assert.equal(observation.volume, 0);
  assert.equal(observation.url, "https://flatkey.ai/models/fictional-model");
  assert.equal(observation.sourceSerpUpdatedAt, "2026-10-14T03:00:00.000Z");
  assert.equal(observation.volumeUpdatedAt, "2026-10-01T04:00:00.000Z");
  assert.equal(observation.sourceSerpDateField, "ranked_serp_element.last_updated_time");
  assert.notEqual(observation.sourceSerpUpdatedAt, observation.collectedAt);
});

test("SERP date falls back to the keyword SERP-info date and never to collection time or volume update", () => {
  const fallback = item("fallback api");
  delete fallback.ranked_serp_element.last_updated_time;
  const unknown = clone(fallback);
  unknown.keyword_data.keyword = "unknown date api";
  delete unknown.keyword_data.serp_info;
  const result = normalize(raw([fallback, unknown]));
  const dated = result.rows.find(row => row.keyword === "fallback api");
  assert.equal(dated.sourceSerpUpdatedAt, "2026-10-12T03:00:00.000Z");
  assert.equal(dated.sourceSerpDateField, "keyword_data.serp_info.last_updated_time");
  const undated = result.rows.find(row => row.keyword === "unknown date api");
  assert.equal(undated.sourceSerpUpdatedAt, null);
  assert.equal(undated.sourceSerpUpdatedAtRaw, null);
  assert.equal(undated.sourceSerpDateField, null);
  assert.equal(undated.volumeUpdatedAt, "2026-10-01T04:00:00.000Z");
});

test("missing or malformed volume and provider dates remain null rather than invented zero or collection-day values", () => {
  const missing = item();
  delete missing.keyword_data.keyword_info;
  missing.ranked_serp_element.last_updated_time = "not-a-provider-date";
  missing.keyword_data.serp_info.last_updated_time = "2026-02-30 03:00:00 +00:00";
  const observation = normalize(raw([missing])).rows[0];
  assert.equal(observation.volume, null);
  assert.equal(observation.volumeUpdatedAt, null);
  assert.equal(observation.sourceSerpUpdatedAt, null);
});

test("non-organic, lost, rank-invalid, foreign and unsafe URL observations are excluded", () => {
  const bad = [];
  for (const rank_group of [0, 101, 1.5, null]) { const value = item(); value.ranked_serp_element.serp_item.rank_group = rank_group; bad.push(value); }
  const absoluteOnly = item(); delete absoluteOnly.ranked_serp_element.serp_item.rank_group; absoluteOnly.ranked_serp_element.serp_item.rank_absolute = 1; bad.push(absoluteOnly);
  const notOrganic = item(); notOrganic.ranked_serp_element.serp_item.type = "paid"; bad.push(notOrganic);
  const lost = item(); lost.ranked_serp_element.is_lost = true; bad.push(lost);
  for (const url of ["https://other.example/page", "https://flatkey.ai.attacker.example/page", "https://user:secret@flatkey.ai/page", "ftp://flatkey.ai/page", "https://flatkey.ai:444/page", "invalid-url"]) {
    const value = item(); value.ranked_serp_element.serp_item.url = url; bad.push(value);
  }
  const wrongMarket = item(); wrongMarket.keyword_data.location_code = 2392; bad.push(wrongMarket);
  const wrongLanguage = item(); wrongLanguage.keyword_data.language_code = "es"; bad.push(wrongLanguage);
  const blank = item("   "); bad.push(blank);
  const first = item("rank one api"); first.ranked_serp_element.serp_item.rank_group = 1;
  const last = item("rank hundred api"); last.ranked_serp_element.serp_item.rank_group = 100; last.ranked_serp_element.serp_item.url = "http://docs.flatkey.ai/hundred";
  const result = normalize(raw([...bad, first, last]));
  assert.deepEqual(result.rows.map(row => row.rank_group), [1, 100]);
  assert.equal(result.rejectedItems.length, bad.length);
  assert.ok(result.rejectedItems.some(row => row.reason === "lost_result"));
});

test("same keyword at distinct URLs remains distinct while exact observations are deduplicated", () => {
  const first = item("Ｆｉｃｔｉｏｎａｌ   MODEL API");
  const otherUrl = clone(first); otherUrl.ranked_serp_element.serp_item.url = "https://flatkey.ai/blog/fictional-model-api";
  const result = normalize(raw([first, otherUrl, clone(first)]));
  assert.equal(result.uniqueKeywords, 1);
  assert.equal(result.rows.length, 2);
  assert.equal(new Set(result.rows.map(row => row.url)).size, 2);
  assert.ok(result.rejectedItems.some(row => row.reason === "duplicate_observation"));
});

test("provider envelope, successful task count, target and market are validated before observations are trusted", () => {
  const invalid = [];
  for (const patch of [{ status_code: 20001 }, { tasks_count: 2 }, { tasks_error: 1 }, { tasks: [] }]) invalid.push({ ...raw(), ...patch });
  const twoTasks = raw(); twoTasks.tasks.push(clone(twoTasks.tasks[0])); invalid.push(twoTasks);
  const failedTask = raw(); failedTask.tasks[0].status_code = 40000; invalid.push(failedTask);
  const noResult = raw(); noResult.tasks[0].result = []; invalid.push(noResult);
  const twoResults = raw(); twoResults.tasks[0].result.push(clone(twoResults.tasks[0].result[0])); invalid.push(twoResults);
  for (const patch of [{ target: "other.example" }, { location_code: 2392 }, { language_code: "es" }, { se_type: "bing" }, { items_count: 2 }, { total_count: 0 }]) {
    const value = raw(); Object.assign(value.tasks[0].result[0], patch); invalid.push(value);
  }
  for (const value of invalid) assert.throws(() => normalize(value));
  const empty = raw([]); empty.tasks[0].result[0].items = null;
  assert.equal(normalize(empty).rows.length, 0);
});

test("truncation and actual charge are reported without pagination or additional paid requests", () => {
  const body = raw(); body.cost = 0.01212; body.tasks[0].cost = 0.5; body.tasks[0].result[0].total_count = 1500;
  const result = normalize(body);
  assert.equal(result.actualCostMicros, 12120);
  assert.equal(Number(result.actualCostUsd), 0.01212);
  assert.equal(result.costWithinEstimate, true);
  assert.equal(result.truncated, true);
  assert.equal(result.totalMatchingCount, 1500);
  assert.equal(result.additionalRequestsPerformed, 0);
  const costly = raw(); costly.tasks[0].cost = 0.2;
  assert.equal(normalize(costly).costWithinEstimate, false);
});

test("execute persists a durable one-request reservation before its sole POST and saves the three result files without credentials", async (t) => {
  const consoleOutput = [];
  t.mock.method(console, "log", (...values) => consoleOutput.push(values));
  t.mock.method(console, "error", (...values) => consoleOutput.push(values));
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    assert.equal(url, "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    const journalPath = path.join(rootDir, ".local/dataforseo-ranked-keywords/journal", `${runId}.json`);
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
    assert.equal(journal.status, "POST_STARTED");
    assert.equal(journal.networkAttempts, 1);
    assert.deepEqual(JSON.parse(init.body), [api.buildRankedKeywordsTask(1000, runId)]);
    assert.equal(new Headers(init.headers).get("authorization"), `Basic ${Buffer.from(`${credentials.DATAFORSEO_API_LOGIN}:${credentials.DATAFORSEO_API_PASSWORD}`).toString("base64")}`);
    const body = raw(); body.cost = 0.01212;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const result = await api.runRankedKeywordsCollector(options(), context(fetchFn));
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.paidRequestsSent, 1);
  assert.equal(result.validObservations, 1);
  assert.equal(calls.length, 1);
  const files = await outputFiles();
  assert.deepEqual(new Set(files.map(file => path.basename(file))), new Set([`${runId}.json`, "request.json", "raw-response.json", "normalized.json"]));
  const fileContents = await Promise.all(files.map(file => fs.readFile(file, "utf8")));
  const text = JSON.stringify([...fileContents, ...consoleOutput, result]);
  for (const secret of [credentials.DATAFORSEO_API_LOGIN, credentials.DATAFORSEO_API_PASSWORD, Buffer.from(`${credentials.DATAFORSEO_API_LOGIN}:${credentials.DATAFORSEO_API_PASSWORD}`).toString("base64")]) assert.equal(text.includes(secret), false);
  const journal = JSON.parse(await fs.readFile(result.journalPath, "utf8"));
  assert.equal(journal.status, "COMPLETED");
  const replayBefore = fileContents;
  await assert.rejects(api.runRankedKeywordsCollector(options({ limit: 250 }), context(fetchFn)), error => error.code === "RUN_ALREADY_RECORDED");
  assert.equal(calls.length, 1);
  assert.deepEqual(await Promise.all(files.map(file => fs.readFile(file, "utf8"))), replayBefore);
});

test("missing or alternate-name credentials cannot send a paid request or reserve a run", async () => {
  let calls = 0;
  const send = async () => { calls++; throw new Error("must not send"); };
  for (const env of [{}, { DATAFORSEO_LOGIN: "fictional", DATAFORSEO_PASSWORD: "fictional" }, { DATAFORSEO_API_LOGIN: "fictional:invalid", DATAFORSEO_API_PASSWORD: "fictional" }]) {
    await assert.rejects(api.runRankedKeywordsCollector(options(), context(send, env)), error => error.code === "MISSING_CREDENTIALS");
  }
  assert.equal(calls, 0);
  assert.deepEqual(await outputFiles(), []);
});

test("a lost POST response is never retried and the same run stays blocked without leaking transport error credentials", async (t) => {
  const logged = [];
  t.mock.method(console, "log", (...values) => logged.push(values));
  t.mock.method(console, "error", (...values) => logged.push(values));
  let calls = 0;
  const send = async () => { calls++; throw new TypeError(`Connection lost after charge: ${credentials.DATAFORSEO_API_LOGIN} ${credentials.DATAFORSEO_API_PASSWORD}`); };
  const dependencies = context(send);
  await assert.rejects(api.runRankedKeywordsCollector(options(), dependencies), error => error.code === "OUTCOME_UNKNOWN" && !error.message.includes(credentials.DATAFORSEO_API_PASSWORD));
  const files = await outputFiles();
  const journalFile = files.find(file => file.endsWith(`${runId}.json`));
  const journalText = await fs.readFile(journalFile, "utf8");
  assert.equal(JSON.parse(journalText).status, "OUTCOME_UNKNOWN");
  for (const secret of Object.values(credentials)) assert.equal(JSON.stringify([journalText, logged]).includes(secret), false);
  await assert.rejects(api.runRankedKeywordsCollector(options(), dependencies), error => error.code === "RUN_ALREADY_RECORDED");
  assert.equal(calls, 1);
  assert.equal(await fs.readFile(journalFile, "utf8"), journalText);
});

test("HTTP, JSON and provider failures each preserve the raw response and block every same-run paid retry", async () => {
  const failures = [
    { suffix: "http", response: () => new Response("fictional provider outage", { status: 503 }), code: "HTTP_STATUS" },
    { suffix: "json", response: () => new Response("not json", { status: 200 }), code: "INVALID_JSON" },
    { suffix: "provider", response: () => new Response(JSON.stringify({ ...raw(), status_code: 40000 }), { status: 200 }), code: "PROVIDER_STATUS" },
  ];
  for (const failure of failures) {
    const failedRun = `${runId}-${failure.suffix}`;
    let calls = 0;
    const send = async () => { calls++; return failure.response(); };
    await assert.rejects(api.runRankedKeywordsCollector(options({ runId: failedRun }), context(send)), error => error.code === failure.code);
    const journal = JSON.parse(await fs.readFile(path.join(rootDir, ".local/dataforseo-ranked-keywords/journal", `${failedRun}.json`), "utf8"));
    assert.equal(journal.status, "FAILED_NO_RETRY");
    assert.equal(journal.networkAttempts, 1);
    await fs.access(path.join(rootDir, ".local/dataforseo-ranked-keywords/runs", failedRun, "raw-response.json"));
    await assert.rejects(api.runRankedKeywordsCollector(options({ runId: failedRun }), context(send)), error => error.code === "RUN_ALREADY_RECORDED");
    assert.equal(calls, 1);
  }
});

test("concurrent attempts for one run can create only one journal and one paid POST", async () => {
  let calls = 0;
  const send = async () => { calls++; return new Response(JSON.stringify(raw()), { status: 200 }); };
  const results = await Promise.allSettled([
    api.runRankedKeywordsCollector(options(), context(send)),
    api.runRankedKeywordsCollector(options(), context(send)),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "RUN_ALREADY_RECORDED");
});
