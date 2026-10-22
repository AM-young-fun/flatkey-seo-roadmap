const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { keywordMatchesCountry } = require("../src/lib/keyword-market.ts");

const { groupKeywordDetails, scopeKeywordDetails } = require("../src/lib/keyword-details-group.ts");
const keyword = (id, text, extra = {}) => ({ id, text, siteDomain: "flatkey.ai", sourceLanguages: [], businessCategory: "FLATKEY_API",
  marketVolumes: { US: null, JP: null, ES: null, BR: null }, latestRanks: { US: null, JP: null, ES: null, BR: null }, ...extra });
const rank = value => ({ source: "dataforseo_serp", rankStatus: "ranked", rank: value, checkedAt: "2026-10-22T03:00:00Z" });

test("country selection scopes actual rows, retaining unmeasured targets from their source language", () => {
  const en = keyword("en", "model api", { sourceLanguages: ["en-US"] });
  const ja = keyword("ja", "モデル API", { sourceLanguages: ["ja"], latestRanks: { US: rank(3), JP: rank(2) } });
  const unknown = keyword("unknown", "unassigned api");
  const original = structuredClone([en, ja, unknown]);
  assert.deepEqual(scopeKeywordDetails(groupKeywordDetails([en, ja, unknown]), "US").map(group => group.text), [en.text]);
  assert.equal(keywordMatchesCountry(ja, "US", true), true, "cross-language real US data stays accessible");
  assert.equal(keywordMatchesCountry(ja, "JP"), true);
  assert.equal(keywordMatchesCountry(unknown, "US"), false);
  assert.equal(keywordMatchesCountry(unknown, "all"), true);
  assert.deepEqual([en, ja, unknown], original);
});

test("Japanese script is recognized without source metadata and unknown Latin terms require country evidence", () => {
  assert.equal(keywordMatchesCountry(keyword("a", "ｸﾗｳﾄﾞ GPU"), "US"), false);
  assert.equal(keywordMatchesCountry(keyword("a", "クラウド GPU"), "JP"), true);
  assert.equal(keywordMatchesCountry(keyword("b", "GPU", { marketVolumes: { JP: 100 } }), "JP"), true);
  assert.equal(keywordMatchesCountry(keyword("c", "model api", { sourceLanguages: ["Portuguese"] }), "BR"), true);
  assert.equal(keywordMatchesCountry(keyword("d", "API precios", { sourceLanguages: ["es"] }), "US"), false);
});



const { keywordGraphKeywords, keywordGraphVolume, keywordGraphSize } = require("../src/lib/keyword-graph-data.ts");
test("circular graph preserves country filtering, deduplicates market demand and keeps regional ranks separate", () => {
  const en = keyword("en", "model api", {sourceLanguages:["en"],parentIds:[],parentId:null,marketVolumes:{US:200,JP:null,ES:null,BR:null},latestRanks:{US:rank(20),JP:rank(1),ES:null,BR:null}});
  const copy = {...en,id:"copy",siteDomain:"rackrate.org"};
  const ja = keyword("ja","モデル API",{sourceLanguages:["ja"],parentIds:[],parentId:null,marketVolumes:{US:500,JP:800,ES:null,BR:null}});
  const us = keywordGraphKeywords([en,copy,ja],"US");
  assert.equal(us.length,1);assert.equal(us[0].marketVolumes.US,200);assert.equal(us[0].latestRanks.US.rank,20);
  assert.deepEqual(keywordGraphVolume(us[0],"US"),{value:200,known:1,total:1});
  assert.equal(keywordGraphKeywords([en,ja],"US",true).length,2);
  const all=keywordGraphKeywords([en,copy,ja],"all");
  assert.equal(all.length,2);assert.deepEqual(keywordGraphVolume(all.find(row=>row.id==="モデル api"),"all"),{value:1300,known:2,total:4});
});
test("dot size grows with demand while missing volume stays distinct from an explicit zero", () => {
  const missing=keyword("a","unknown"),zero=keyword("b","zero",{marketVolumes:{US:0}});
  assert.equal(keywordGraphVolume(missing,"US").value,null);assert.equal(keywordGraphVolume(zero,"US").value,0);
  const sizes=[0,10,1000,2000000].map(value=>keywordGraphSize(value,2000000,1622));
  assert.ok(sizes.every((value,index)=>index===0 || value>=sizes[index-1]));
  assert.ok(sizes.at(-1)<36);
  const small=keywordGraphSize(1000,10000,1622),large=keywordGraphSize(4000,10000,1622);
  assert.ok(Math.abs(large*large/(small*small)-4)<1e-9,"four times demand produces four times circle area above the visibility floor");assert.ok(Number.isFinite(keywordGraphSize(null,0,0)));
});
