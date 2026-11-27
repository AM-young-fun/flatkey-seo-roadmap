const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./register-ui-modules.cjs");

const { quarterContentDailyMix, assertQuarterContentCapacity, quarterContentBindingProblem } = require("../src/lib/seo-quarter-content-capacity.ts");
const { workflowPlanSchema } = require("../src/lib/seo-workflow.ts");
const { isSeoWorkday } = require("../src/lib/seo-workday.ts");
const { shiftDay } = require("../src/lib/seo-date-range.ts");
const { GROWTH_LANGUAGES } = require("../src/lib/seo-growth-markets.ts");
const start = "2026-11-27";
const end = "2027-02-05";
const quarterHash = "a".repeat(64);
const satelliteHash = "b".repeat(64);
const now = new Date("2026-11-27T07:00:00Z");
const cutoff = "2026-11-27T07:00:00Z";
const quarterPolicy = { quarterStart: start, quarterEnd: end, quarterPlanHash: quarterHash, satelliteQuarterHash: satelliteHash, historicalBefore: cutoff };

function workdays(start, count = 7) {
  return Array.from({ length: count }, (_, index) => shiftDay(start, index))
    .filter(day => isSeoWorkday(new Date(`${day}T00:00:00+08:00`)));
}

function sample(weekStart = start) {
  const days = workdays(weekStart);
  const api = [...quarterContentDailyMix(start, days).values()].reduce((sum, mix) => sum + mix.api, 0);
  const gap = (date, category, siteDomain, count) => ({ date, category, siteDomain, count, reason: "原词及当地意图证据尚未完成，本名额有实际缺口" });
  const gaps = days.flatMap(date => {
    const types = quarterContentDailyMix(start, days).get(date);
    return [gap(date, "apiBlogs", "flatkey.ai", types.api), gap(date, "gpuBlogs", "flatkey.ai", types.gpu),
      gap(date, "modelFitBlogs", "modelfit.cc", 5), gap(date, "contentRefreshPages", "flatkey.ai", 5)];
  });
  const landings = days.length + Math.min(2, days.length);
  gaps.push(gap(days[0], "landing", "flatkey.ai", 2), gap(days[0], "clusterLanding", "rackrate.org", landings));
  const targets = {
    cadence: "growth", executionRange: { start: weekStart, end: shiftDay(weekStart, 6) },
    landing: 2, clusterLanding: landings, apiBlogs: api, gpuBlogs: days.length * 5 - api,
    optimizedPages: 0, maintenanceVersion: "seo-maintenance-v2", contentRefreshPages: days.length * 5,
    blogLanguages: Object.fromEntries(GROWTH_LANGUAGES.map(language => [language, ["en", "ja", "zh-CN", "es-ES", "pt-BR"].includes(language) ? days.length : 0])),
  };
  const plan = { id: "next-week-plan-" + weekStart, weekStart: shiftDay(weekStart, 3), status: "scheduled", title: "季度内容原计划",
    quarterlyContent: quarterPolicy, taskIds: [], owner: "Codex SEO", preparedAt: cutoff, reviewedAt: null, reviewedBy: null, targets, gaps,
    evidence: [{ label: "真实排期准备回执", artifact: "/tmp/source.json", observedAt: cutoff }], notes: "" };
  return { plan, days };
}

const task = (id, date, values) => ({ kind: "task", record: {
  id, siteDomain: "flatkey.ai", kind: "blog", business: "API", country: "US", language: "en",
  keyword: "keyword " + id, dueAt: `${date}T17:45:00+08:00`, pageUrl: "https://flatkey.ai/blog/" + id, status: "ready", ...values,
} });
function fill(plan, date, category, rows) {
  plan.taskIds.push(...rows.map(row => row.record.id));
  const gap = plan.gaps.find(item => item.date === date && item.category === category);
  gap.count -= rows.length;
  plan.gaps = plan.gaps.filter(item => item.count > 0);
}

test("calendar yields 125/125 sources across fifty workdays, including the four- and six-day weeks", () => {
  const dates = workdays(start, 71);
  const mix = [...quarterContentDailyMix(start, dates).values()];
  assert.equal(dates.length, 50);
  assert.equal(mix.reduce((sum, item) => sum + item.api, 0), 125);
  assert.equal(mix.reduce((sum, item) => sum + item.gpu, 0), 125);
  for (const [week, count, total] of [[start, 5, 84], ["2027-01-01", 4, 68], ["2027-01-29", 6, 100]]) {
    const { plan, days } = sample(week);
    assert.equal(days.length, count);
    assert.equal(plan.gaps.reduce((sum, gap) => sum + gap.count, 0), total);
    assert.ok(workflowPlanSchema.safeParse(plan).success);
    assert.doesNotThrow(() => assertQuarterContentCapacity(plan, undefined, [], days, now));
  }
});

test("five US ModelFit blogs and five historical Flatkey rewrites use separate capacity from new API blogs and extras", () => {
  const { plan, days } = sample();
  const date = days[0];
  const blogs = Array.from({ length: 5 }, (_, i) => task("model-" + i, date, { siteDomain: "modelfit.cc" }));
  const originals = Array.from({ length: 5 }, (_, i) => task("old-" + i, date, { kind: "optimization", workClass: "content_refresh",
    maintenance: { refresh: { originalPublishedAt: "2026-09-01T06:00:00Z" } } }));
  const extra = task("real-extra", date, { capacityClass: "authorized_weekly_growth_extra" });
  const api = task("new-api", date, {});
  fill(plan, date, "apiBlogs", [api]);
  fill(plan, date, "modelFitBlogs", blogs);
  fill(plan, date, "contentRefreshPages", originals);
  plan.taskIds.push(extra.record.id);
  const all = [...blogs, ...originals, api, extra];
  assert.doesNotThrow(() => assertQuarterContentCapacity(plan, undefined, all, days, now));
  originals[0].record.maintenance.refresh.originalPublishedAt = cutoff;
  assert.throws(() => assertQuarterContentCapacity(plan, undefined, all, days, now), { code: "quarter_content_refresh_history" });
  originals[0].record.maintenance.refresh.originalPublishedAt = "2026-09-01T06:00:00Z";
  originals[1].record.pageUrl = originals[0].record.pageUrl + "/";
  assert.throws(() => assertQuarterContentCapacity(plan, undefined, all, days, now), { code: "quarter_content_duplicate_refresh" });
});

test("a plan uses exact frozen hashes, preserves legacy commitments, and does not create new routine optimizations", () => {
  const { plan, days } = sample();
  const date = days[0];
  const opt = task("legacy-opt", date, { kind: "optimization" });
  const previous = { ...plan, quarterlyContent: undefined, taskIds: [opt.record.id] };
  plan.taskIds.push(opt.record.id);
  assert.doesNotThrow(() => assertQuarterContentCapacity(plan, previous, [opt, { kind: "plan", record: previous }], days, now));
  assert.throws(() => assertQuarterContentCapacity(plan, undefined, [opt], days, now), { code: "quarter_content_scope" });
  const strategy = { baseline: { planHash: quarterHash }, quarterPlanning: { hash: quarterHash,
    approval: { hash: quarterHash }, plan: { executionStart: start, executionEnd: end } },
  satelliteQuarter: { baselinePlanHash: quarterHash, selectionHash: satelliteHash } };
  assert.equal(quarterContentBindingProblem(plan, strategy, now), null);
  assert.match(quarterContentBindingProblem(plan, { ...strategy, baseline: { planHash: "c".repeat(64) } }, now), /已审批冻结/);
});
