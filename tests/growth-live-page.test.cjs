const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { growthLivePageReadiness: live, GROWTH_LIVE_PAGE_POLICY } = require("../src/lib/growth-live-page.ts");
const now = new Date("2026-11-25T02:00:00Z"), url = "https://flatkey.ai/blog/gpu-memory";
const target = { site: "flatkey.ai", keywordId: "kid", publishedUrls: [url] };
const check = (patch = {}) => ({ site: "flatkey.ai", keywordId: "kid", url, checkedAt: "2026-11-25T01:00:00Z", httpStatus: 200, canonicalUrl: url, verified: true, source: "page_audit:keyword:kid", ...patch });
const pass = checks => assert.deepEqual(live(target, checks, now), { urls: [url], reason: null });
const held = (checks, t = target) => { const value = live(t, checks, now); assert.deepEqual(value.urls, []); assert.ok(value.reason); };

test("new paid page policy needs an existing fresh complete proof and does not mutate input", () => {
 assert.equal(GROWTH_LIVE_PAGE_POLICY, "published-page-evidence-v1"); held([]);
 const checks = [check()], before = structuredClone({ target, checks }); pass(checks);
 assert.deepEqual({ target, checks }, before);
 held([check({ canonicalUrl: null })]); held([check({ source: " " })]); held([check({ verified: false })]); held([check({ httpStatus: null })]);
});
test("a fresh new success supersedes an older failure, never the other way around", () => {
 const old = check({ checkedAt: "2026-11-25T00:00:00Z", httpStatus: 404, verified: false });
 pass([old, check()]); pass([check(), old]);
 for (const httpStatus of [307, 404, 410, 403, 500]) held([check({ checkedAt: "2026-11-25T00:00:00Z" }), check({ httpStatus, verified: false })]);
 held([check({ checkedAt: "2026-11-25T00:00:00Z" }), check({ verified: false })]);
 held([check({ checkedAt: "2026-11-25T00:00:00Z" }), check({ canonicalUrl: null })]);
});
test("conflicting evidence at the same instant fails closed independently of array order", () => {
 const good = check(), bad = check({ httpStatus: 307, verified: false }); held([good, bad]); held([bad, good]);
 pass([good, check({ canonicalUrl: "https://www.flatkey.ai/blog/gpu-memory/#section" })]);
});
test("24h is inclusive, but one millisecond older, any future receipt, malformed dates and missing offsets hold", () => {
 pass([check({ checkedAt: "2026-11-24T02:00:00Z" })]); pass([check({ checkedAt: now.toISOString() })]);
 for (const checkedAt of ["2026-11-24T01:59:59.999Z", "2026-11-25T02:00:00.001Z", "invalid", "2026-11-25", "2026-02-30T01:00:00Z"]) held([check({ checkedAt })]);
 held([check(), check({ checkedAt: "invalid" })]);
 assert.ok(live(target, [check()], new Date("invalid")).reason);
});
test("www, trailing slashes and hashes are equivalent while query-dependent pages and canonical changes stay distinct", () => {
 const t = { ...target, publishedUrls: ["https://www.flatkey.ai/blog/gpu-memory/#heading", url] };
 assert.deepEqual(live(t, [check({ url: "https://www.flatkey.ai/blog/gpu-memory/", canonicalUrl: url + "#top" })], now), { urls: [url], reason: null });
 held([check({ canonicalUrl: "https://flatkey.ai/blog/other" })]);
 held([check({ canonicalUrl: url + "?variant=2" })]);
});
test("only exact public website hosts are eligible; no credentials, explicit ports, IPs or data-only sites", () => {
 for (const bad of ["http://flatkey.ai/blog/gpu-memory", "https://console.flatkey.ai/blog/gpu-memory", "https://test.flatkey.ai/blog/gpu-memory", "https://flatkey.ai.evil.test/blog/gpu-memory", "https://user@flatkey.ai/blog/gpu-memory", "https://flatkey.ai:443/blog/gpu-memory", "https://flatkey.ai:444/blog/gpu-memory", "https://127.0.0.1/blog/gpu-memory", "https://%66latkey.ai/blog/gpu-memory", "https://flatkey.ai\\@evil.test/blog/gpu-memory"]) {
  held([check({ url: bad, canonicalUrl: bad })], { ...target, publishedUrls: [bad] });
 }
 for (const site of ["rougecue.org", "jev-llm.com", "mochichatbot.com"]) held([], { site, keywordId: "kid", publishedUrls: [`https://${site}/`] });
 for (const site of ["rackrate.org", "modelfit.cc"]) {
  const page = `https://${site}/models/model`;
  assert.deepEqual(live({ site, keywordId: "kid", publishedUrls: [page] }, [check({ site, url: page, canonicalUrl: page })], now), { urls: [page], reason: null });
 }
});
test("technical/product routes are excluded even when their path is case-folded, escaped or nested", () => {
 for (const path of ["api", "console", "router", "admin", "sign-in", "sign-up", "login", "auth", "billing", "account", "ja/api/docs", "%61pi", "%2561pi", "%2fconsole", "%5cadmin", "ＡＰＩ"]) {
  const page = "https://flatkey.ai/" + path;
  held([check({ url: page, canonicalUrl: page })], { ...target, publishedUrls: [page] });
 }
 const page = "https://flatkey.ai/blog/api-costs";
 assert.deepEqual(live({ ...target, publishedUrls: [page] }, [check({ url: page, canonicalUrl: page })], now).urls, [page]);
});
test("RackRate's exact public API overview is eligible while API endpoints remain excluded", () => {
 const site = "rackrate.org", page = "https://rackrate.org/api";
 for (const candidate of [page, page + "/", "https://www.rackrate.org/api/#usage"]) {
  assert.deepEqual(live({ site, keywordId: "kid", publishedUrls: [candidate] }, [check({ site, url: candidate, canonicalUrl: page })], now), { urls: [page], reason: null });
 }
 for (const path of ["/api/search", "/api/v1/prices/realtime", "/API", "/%61pi", "/ja/api", "/api//"]) {
  const candidate = `https://${site}${path}`;
  held([check({ site, url: candidate, canonicalUrl: candidate })], { site, keywordId: "kid", publishedUrls: [candidate] });
 }
 for (const otherSite of ["flatkey.ai", "modelfit.cc"]) {
  const candidate = `https://${otherSite}/api`;
  held([check({ site: otherSite, url: candidate, canonicalUrl: candidate })], { site: otherSite, keywordId: "kid", publishedUrls: [candidate] });
 }
 held([check({ site, url: page, canonicalUrl: "https://rackrate.org/" })], { site, keywordId: "kid", publishedUrls: [page] });
 held([check({ site, url: page, canonicalUrl: page, httpStatus: 307, verified: false })], { site, keywordId: "kid", publishedUrls: [page] });
});
test("other keywords cannot lend positive proof or intent-only REVIEW, but actual HTTP/canonical failures are shared", () => {
 held([check({ keywordId: "other" })]);
 pass([check(), check({ keywordId: "other", verified: false, checkedAt: "2026-11-25T01:30:00Z" })]);
 pass([check(), check({ keywordId: "other", verified: false, httpStatus: null, canonicalUrl: null, checkedAt: "2026-11-25T01:30:00Z" })]);
 held([check(), check({ keywordId: "other", verified: false, httpStatus: 307, checkedAt: "2026-11-25T01:30:00Z" })]);
 held([check(), check({ keywordId: "other", canonicalUrl: "https://flatkey.ai/blog/other", checkedAt: "2026-11-25T01:30:00Z" })]);
 held([check(), check({ keywordId: "other", canonicalUrl: "https://external.test/", checkedAt: "2026-11-25T01:30:00Z" })]);
 pass([check(), check({ site: "modelfit.cc", verified: false, httpStatus: 404, checkedAt: "2026-11-25T01:30:00Z" })]);
 pass([check({ keywordId: null, source: "publication:original-liveCheck" })]);
});
test("an own-keyword latest no-match blocks old URLs and a later exact success can recover one", () => {
 const review = check({ url: null, canonicalUrl: null, verified: false, httpStatus: null, checkedAt: "2026-11-25T01:30:00Z" });
 held([check(), review]);
 pass([review, check({ checkedAt: "2026-11-25T01:45:00Z" })]);
 held([check({ checkedAt: review.checkedAt }), review]);
 pass([check(), { ...review, keywordId: "other" }]);
});
test("multiple published URLs return only independently verified fresh URLs", () => {
 const second = "https://flatkey.ai/blog/other", t = { ...target, publishedUrls: [url, second] };
 assert.deepEqual(live(t, [check(), check({ url: second, canonicalUrl: second, verified: false })], now), { urls: [url], reason: null });
});
