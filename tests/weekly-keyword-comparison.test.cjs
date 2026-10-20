const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { weeklyKeywordComparison } = require("../src/lib/weekly-keyword-comparison.ts");
const start = "2026-10-05", end = "2026-10-12";
const report = (day, words, region = "US", siteDomain = "flatkey.ai", source = "gsc") => ({ siteDomain, region, source, date: new Date(day), rankings: words.map(([keyword, rank]) => ({ keyword, rank })) });
const page = (date, keyword, url, rank, overrides = {}) => ({ date, keyword, url, rank, region: "US", siteDomain: "flatkey.ai", source: "gsc", ...overrides });
const eligible = (...words) => new Set(words.map(word => `flatkey.ai:US:${word}`));

test("four-country comparison deduplicates words, takes each period's best rank and retains new/lost set changes", () => {
  const reports = [report(start, [["Model Price", 8], ["lost api", 20], ["noise", 1]]), report(end, [["model price", 40], ["new api", 10.5]]),
    report(start, [["model price", 35]], "JP", "rackrate.org"), report(end, [["ＭＯＤＥＬ  ＰＲＩＣＥ", 3]], "JP", "rackrate.org")];
  const result = weeklyKeywordComparison(reports, new Set([...eligible("model price", "lost api", "new api"), "rackrate.org:JP:model price"]), start, end);
  assert.deepEqual([result.previous, result.current, result.entered, result.removed, result.net], [2, 2, 1, 1, 0]);
  assert.deepEqual(result.buckets.map(row => [row.previous, row.current, row.delta]), [[1, 1, 0], [1, 1, 0], [0, 0, 0], [0, 0, 0]]);
  assert.equal(result.comparedMarkets, 2);
  assert.equal(result.unattributed, 1);
});

test("exact endpoint dates and reported pages identify decline, explicit outside and missing-report evidence separately", () => {
  const reports = [report(start, [["decline api", 2], ["lost api", 9], ["missing api", 10]]), report(end, [["decline api", 25], ["lost api", 110]])];
  const pages = [page(start, "decline api", "https://flatkey.ai/decline", 2), page(end, "decline api", "https://flatkey.ai/decline", 25),
    page(start, "lost api", "https://flatkey.ai/lost", 9), page(start, "missing api", "https://flatkey.ai/missing", 10),
    page("2026-10-06", "missing api", "https://flatkey.ai/wrong-day", 1)];
  const result = weeklyKeywordComparison(reports, eligible("decline api", "lost api", "missing api"), start, end, pages);
  assert.deepEqual(result.pageLosses.map(row => [row.url, row.reasons]), [
    ["https://flatkey.ai/lost", ["跌出前100"]], ["https://flatkey.ai/missing", ["本期报告未检出"]], ["https://flatkey.ai/decline", ["名次下降"]]]);
  assert.equal(result.unattributed, 0);
});

test("page loss never uses an unpaired source, a different country, an unrelated domain or a javascript URL", () => {
  const reports = [report(start, [["model api", 5]]), report(end, [])];
  const pages = [page(start, "model api", "https://flatkey.ai/old", 5, { source: "ahrefs" }), page(start, "model api", "https://flatkey.ai/jp", 5, { region: "JP" }),
    page(start, "model api", "https://other.example/page", 5), page(start, "model api", "javascript:alert(1)", 5)];
  const result = weeklyKeywordComparison(reports, eligible("model api"), start, end, pages);
  assert.deepEqual(result.pageLosses, []); assert.equal(result.unattributed, 1);
});

test("missing page breakdown does not fabricate page loss when the keyword is still ranked", () => {
  const reports = [report(start, [["model api", 5]]), report(end, [["model api", 20]])];
  const pages = [page(start, "model api", "https://flatkey.ai/old", 5)];
  const result = weeklyKeywordComparison(reports, eligible("model api"), start, end, pages);
  assert.deepEqual(result.pageLosses, []); assert.equal(result.removed, 0);
  const replaced = weeklyKeywordComparison(reports, eligible("model api"), start, end, [...pages, page(end, "model api", "https://flatkey.ai/new", 20)]);
  assert.equal(replaced.removed, 0); assert.deepEqual(replaced.pageLosses[0].reasons, ["排名页面更换"]);
});

test("one page combines several words and countries and several pages for one word stay independently attributable", () => {
  const reports = [report(start, [["one api", 1], ["two api", 3]]), report(end, []), report(start, [["one api", 2]], "JP"), report(end, [], "JP")];
  const pages = [page(start, "one api", "https://flatkey.ai/shared/#section", 1), page(start, "two api", "https://flatkey.ai/shared", 3),
    page(start, "one api", "https://flatkey.ai/shared", 2, { region: "JP" }), page(start, "one api", "https://flatkey.ai/second", 6)];
  const result = weeklyKeywordComparison(reports, new Set([...eligible("one api", "two api"), "flatkey.ai:JP:one api"]), start, end, pages);
  assert.equal(result.removed, 2); assert.equal(result.pageLosses[0].lost, 2); assert.equal(result.pageLosses.length, 2);
  assert.deepEqual(result.pageLosses[0].regions, ["JP", "US"]);
});

test("latest page receipt wins and identical input does not mutate stored snapshots", () => {
  const reports = [report(start, [["model api", 5]]), report(end, [["model api", 2]])];
  const pages = [page(start, "model api", "https://flatkey.ai/a", 5), page(end, "model api", "https://flatkey.ai/a", 2), page(end, "model api", "https://flatkey.ai/a", 20)];
  const original = structuredClone({ reports, pages });
  assert.equal(weeklyKeywordComparison(reports, eligible("model api"), start, end, pages).pageLosses.length, 0);
  assert.deepEqual({ reports, pages }, original);
});

test("an explicit page outside result cannot be revived by an older positive receipt", () => {
  const reports = [report(start, [["model api", 5]]), report(end, [["model api", 6]])];
  const pages = [page(start, "model api", "https://flatkey.ai/old", 5), page(end, "model api", "https://flatkey.ai/old", 110),
    page(end, "model api", "https://flatkey.ai/old", 2), page(end, "model api", "https://flatkey.ai/new", 6)];
  const result = weeklyKeywordComparison(reports, eligible("model api"), start, end, pages);
  assert.deepEqual(result.pageLosses[0].reasons, ["跌出前100"]);
  assert.equal(result.pageLosses[0].lost, 1);
  assert.equal(result.removed, 0, "losing one page does not mean losing the keyword on the entire site");
});

test("decline detail shows exact same-country ranks and page changes, while missing receipts and replacement-only rows stay out",()=>{
  const reports=[report(start,[["declining api",3],["outside api",9],["missing api",5],["brand",1],["improving api",8]]),
    report(end,[["declining api",18],["outside api",101],["brand",1],["improving api",2]]),
    report(start,[["declining api",20]],"JP"),report(end,[["declining api",4]],"JP")];
  const pages=[page(start,"declining api","https://flatkey.ai/old",3),page(end,"declining api","https://flatkey.ai/new",18),
    page(start,"outside api","https://flatkey.ai/outside",9),page(start,"brand","https://flatkey.ai/docs",1),page(end,"brand","https://flatkey.ai/",1),
    page(start,"improving api","https://flatkey.ai/before",8),page(end,"improving api","https://flatkey.ai/after",2)];
  const result=weeklyKeywordComparison(reports,new Set([...eligible("declining api","outside api","missing api","brand","improving api"),"flatkey.ai:JP:declining api"]),start,end,pages);
  assert.deepEqual(result.rankDeclines,[
    {keyword:"outside api",siteDomain:"flatkey.ai",region:"US",previousRank:9,currentRank:101,previousUrl:"https://flatkey.ai/outside",currentUrl:null,outsideTop100:true},
    {keyword:"declining api",siteDomain:"flatkey.ai",region:"US",previousRank:3,currentRank:18,previousUrl:"https://flatkey.ai/old",currentUrl:"https://flatkey.ai/new",outsideTop100:false}]);
});

test("decline detail requires a paired source and never invents a URL from a different rank, market or source",()=>{
  const reports=[report(start,[["wrong source",2]],"US","flatkey.ai","ahrefs"),report(end,[["wrong source",80]]),
    report(start,[["actual decline",5]]),report(end,[["actual decline",20]])];
  const pages=[page(start,"actual decline","https://flatkey.ai/wrong-rank",8),
    page(end,"actual decline","https://flatkey.ai/wrong-source",20,{source:"ahrefs"}),
    page(end,"actual decline","https://flatkey.ai/jp",20,{region:"JP"}),page(end,"actual decline","https://outside.example/",20)];
  const result=weeklyKeywordComparison(reports,eligible("wrong source","actual decline"),start,end,pages);
  assert.deepEqual(result.rankDeclines,[{keyword:"actual decline",siteDomain:"flatkey.ai",region:"US",previousRank:5,currentRank:20,
    previousUrl:null,currentUrl:null,outsideTop100:false}]);
});
