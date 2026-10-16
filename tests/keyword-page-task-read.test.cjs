const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);

let state;
function matches(value, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some(condition => matches(value, condition));
    const actual = value[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (Object.hasOwn(expected, "in")) return expected.in.includes(actual);
      if (Object.hasOwn(expected, "notIn")) return !expected.notIn.includes(actual);
      if (Object.hasOwn(expected, "not")) return actual !== expected.not;
      return matches(actual, expected);
    }
    return actual === expected;
  });
}
const db = {
  seoSite: { findMany: async ({ where }) => state.sites.filter(row => matches(row, where)) },
  siteKeyword: { findMany: async ({ where }) => state.members.filter(row => matches(row, where)) },
  keywordContentTask: { findMany: async ({ where }) => state.tasks.filter(row => matches(row, where)) },
  keywordSourceRow: { findMany: async ({ where }) => state.audits.filter(row => matches(row, where)) },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const { loadKeywordPageTasks } = require("../src/lib/services/keyword-page-task-read.ts");
const { GET } = require("../src/app/api/keywords/page-tasks/route.ts");

function addSite(siteDomain) {
  state.sites.push({ domain: siteDomain, active: true });
  state.members.push({ siteDomain, keywordId: "shared", active: true, pool: siteDomain === "flatkey.ai" ? "FORMAL" : "RESEARCH", topicId: "topic",
    keyword: { text: "shared model api", active: true } });
  const workPlan = { originalVerdict: "CONTENT_GAP", action: "EXPAND", pageUrls: [`https://${siteDomain}/guide`], previousPageUrl: null,
    proposedTitle: "Model API pricing guide", requirements: ["Explain this model API setup.", "Include a runnable request example.", "Provide dated primary price sources."],
    acceptance: ["The request example returns a valid result.", "The required model has an exact price row."] };
  state.audits.push({ siteDomain, sourceId: "page_audit", rowKey: "keyword:shared", snapshot: { keywordId: "shared", keyword: "shared model api", verdict: "CONTENT_GAP", workPlan } });
  state.tasks.push({ id: `${siteDomain}:page`, siteDomain, plannedUrl: `https://${siteDomain}/guide`, type: "EXPAND", status: "IN_PROGRESS", title: `${siteDomain} model guide`,
    reason: "This existing page needs the exact model pricing details.", keywords: ["shared model api"], targetUrls: [`https://${siteDomain}/guide`], owner: "Alice", dueAt: new Date("2026-11-01T00:00:00Z") });
}
beforeEach(() => { process.env.DATABASE_URL = "postgresql://test.invalid/page-tasks"; state = { sites: [], members: [], tasks: [], audits: [] }; });

test("three sites share a task view while keeping their own per-word proof, owners and progress", async () => {
  for (const site of ["flatkey.ai", "rackrate.org", "modelfit.cc"]) addSite(site);
  const before = structuredClone(state);
  const result = await loadKeywordPageTasks();
  assert.equal(result.tasks.length, 3);
  assert.deepEqual(result.summary, { taskCount: 3, pendingKeywords: 3, assignedKeywords: 3 });
  assert.equal(result.sites.length, 3);
  for (const task of result.tasks) {
    assert.equal(task.owner, "Alice");
    assert.equal(task.status, "IN_PROGRESS");
    assert.equal(task.dueAt, "2026-11-01T00:00:00.000Z");
    assert.deepEqual(task.workPlans[0].pageUrls, [`https://${task.siteDomain}/guide`]);
  }
  assert.deepEqual(state, before, "the shared view must not curate keywords or merge task data");
});

test("wrong-site, stale identity and contradictory work plans do not become task requirements", async () => {
  addSite("rackrate.org"); addSite("modelfit.cc");
  state.audits[0].snapshot.workPlan.pageUrls = ["https://flatkey.ai/unrelated"];
  state.audits[1].snapshot.keywordId = "wrong";
  let result = await loadKeywordPageTasks();
  assert.equal(result.summary.pendingKeywords, 0);
  assert.ok(result.tasks.every(task => !task.workPlans.length));
  state.audits[1].snapshot.keywordId = "shared";
  state.audits[1].snapshot.verdict = "NO_MATCH";
  result = await loadKeywordPageTasks();
  assert.equal(result.summary.pendingKeywords, 0);
});

test("inactive sites, archived members, retired tasks and future foreign domains are excluded", async () => {
  addSite("flatkey.ai"); addSite("rackrate.org"); addSite("modelfit.cc"); addSite("foreign.example");
  state.sites.find(row => row.domain === "modelfit.cc").active = false;
  state.members.find(row => row.siteDomain === "flatkey.ai").pool = "ARCHIVED";
  state.tasks.push({ ...state.tasks[0], id: "merged", status: "MERGED" }, { ...state.tasks[0], id: "restored", status: "RESTORED" });
  const result = await loadKeywordPageTasks();
  assert.deepEqual(result.sites.map(row => row.siteDomain), ["flatkey.ai", "rackrate.org"]);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.summary.pendingKeywords, 1);
  assert.equal(result.tasks.find(row => row.siteDomain === "flatkey.ai").workPlans.length, 0);
});

test("an empty stored database has no fabricated tasks; GET stays private and requires a configured database", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /private, no-store/);
  assert.deepEqual(await response.json(), { kind: "keyword-page-tasks", tasks: [], sites: [], summary: { taskCount: 0, pendingKeywords: 0, assignedKeywords: 0 } });
  delete process.env.DATABASE_URL;
  assert.equal((await GET()).status, 503);
});
