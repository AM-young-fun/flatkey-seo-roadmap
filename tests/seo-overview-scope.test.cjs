const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { overviewPageModule, overviewModule, overviewKeywordScope } = require("../src/lib/seo-overview-scope.ts");
const rank = value => ({source:"dataforseo_serp",rankStatus:"ranked",rank:value,checkedAt:"2026-11-09T00:00:00Z"});
const keyword = (id, extra={}) => ({id,text:id,siteDomain:"flatkey.ai",siteName:"Flatkey",sourceLanguages:["en"],targetUrls:[],parentIds:[],parentId:null,topicId:null,topicText:null,
 marketVolumes:{US:10,JP:null,BR:null,ES:null},latestRanks:{US:rank(20),JP:null,BR:null,ES:null},...extra});

test("same query across sites is filtered by registered module before rank, demand and site deduplication",()=>{
 const blog=keyword("blog",{text:"gpu api",targetUrls:["https://flatkey.ai/blog/gpu-api"],marketVolumes:{US:500},latestRanks:{US:rank(2)}});
 const gpu=keyword("gpu",{text:"gpu api",siteDomain:"rackrate.org",siteName:"RackRate",targetUrls:["https://rackrate.org/gpus/a100"],marketVolumes:{US:100},latestRanks:{US:rank(30)}});
 const input=[blog,gpu],before=structuredClone(input),result=overviewKeywordScope(input,"US","gpu").keywords;
 assert.equal(result.length,1);assert.equal(result[0].siteName,"RackRate");assert.equal(result[0].latestRanks.US.rank,30);assert.equal(result[0].marketVolumes.US,100);
 assert.deepEqual(result[0].targetUrls,gpu.targetUrls);assert.deepEqual(input,before);
 assert.equal(overviewKeywordScope(input,"US","all").keywords[0].latestRanks.US.rank,2);
});
test("country language filtering remains real and cross-language does not bypass the selected module",()=>{
 const en=keyword("en",{text:"model API",targetUrls:["https://flatkey.ai/models/a"]});
 const ja=keyword("ja",{text:"モデル API",sourceLanguages:["ja"],targetUrls:["https://flatkey.ai/ja/models/a"],latestRanks:{US:rank(2),JP:rank(1)},marketVolumes:{US:50,JP:100}});
 const other=keyword("ja-blog",{text:"モデル チュートリアル",sourceLanguages:["ja"],targetUrls:["https://flatkey.ai/ja/blog/a"],latestRanks:{US:rank(3),JP:rank(2)},marketVolumes:{US:5,JP:10}});
 assert.deepEqual(overviewKeywordScope([en,ja,other],"US","models").keywords.map(row=>row.text),["model API"]);
 assert.deepEqual(overviewKeywordScope([en,ja,other],"JP","models").keywords.map(row=>row.text),["モデル API"]);
 assert.equal(overviewKeywordScope([en,ja,other],"US","models",true).keywords.length,2);
});
test("unregistered or unusable target URLs appear under other without guessing from titles or rank URLs",()=>{
 const rows=[keyword("no-target",{text:"GPU blog model prompt",targetUrls:undefined,latestRanks:{US:{...rank(1),url:"https://flatkey.ai/compute"}}}),
  keyword("invalid",{targetUrls:["/compute","javascript:alert(1)"]}),keyword("foreign",{targetUrls:["https://not-ours.example/compute"]}),
  keyword("staging",{targetUrls:["https://staging-website.flatkey.ai/compute"]}),keyword("registered-other",{targetUrls:["https://flatkey.ai/llm-cost-calculator"]})];
 assert.equal(overviewKeywordScope(rows,"US","other").keywords.length,5);
 assert.equal(overviewKeywordScope(rows,"US","gpu").keywords.length,0);
 assert.equal(overviewModule("unknown"),"other");
 assert.equal(overviewKeywordScope(rows,"US","all").keywords.length,5);
});
test("multi-target keyword can belong to several modules without duplicate nodes or dangling parent relations",()=>{
 const parent=keyword("parent",{text:"API platform",targetUrls:["https://flatkey.ai/"]});
 const child=keyword("child",{text:"GPU API",parentIds:["parent"],parentId:"parent",targetUrls:["https://flatkey.ai/compute","https://flatkey.ai/blog/tutorial","https://flatkey.ai/compute"]});
 const gpu=overviewKeywordScope([parent,child],"US","gpu").keywords;
 assert.equal(gpu.length,1);assert.deepEqual(gpu[0].parentIds,[]);
 assert.equal(overviewKeywordScope([parent,child],"US","blog").keywords.length,1);
 const all=overviewKeywordScope([parent,child],"US","all").keywords;
 assert.equal(all.length,2);assert.deepEqual(all.find(row=>row.text==="GPU API").parentIds,["api platform"]);
});
test("known routes preserve blog precedence, native language paths and cluster tool classifications",()=>{
 for(const [url,module] of [
  ["https://flatkey.ai/ja/blog/gpu-model","blog"],["https://flatkey.ai/es/prompts/image/cat","prompts"],
  ["https://flatkey.ai/models/a/prompts/1","prompts"],["https://flatkey.ai/pt/models/a","models"],
  ["https://flatkey.ai/compute/prices/h100","gpu"],["https://flatkey.ai/compute/prices/unknown","other"],
  ["https://rackrate.org/compare/providers","gpu"],["https://rackrate.org/llm-cost-calculator","other"],
  ["https://modelfit.cc/models/a","models"],["https://modelfit.cc/calculators/kv-cache","gpu"],
  ["https://modelfit.cc/guides/llm-vram-calculator","other"],["https://mochichatbot.com/ja/line","other"],
  ["https://jev-llm.com/models/open-source/","models"],["https://jev-llm.com/models/unverified","other"],
  ["https://console.flatkey.ai/model","other"],["https://flatkey.ai@evil.example/compute",null],
 ]) assert.equal(overviewPageModule(url),module,url);
 assert.equal(overviewModule("made-up"),"all");assert.equal(overviewModule("gpu"),"gpu");
});
