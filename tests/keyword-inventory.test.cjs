const assert = require("node:assert/strict"), {test} = require("node:test"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {candidateKeywordCount} = require("../src/lib/keyword-inventory.ts");
test("candidate inventory is deduplicated and formal membership wins after promotion", () => {
  const candidates = ["ＡＩ API", "ai api", " GPU   cloud ", "gpu cloud", "pricing", "", "  "];
  assert.equal(candidateKeywordCount(["AI API"],candidates),2);
  assert.equal(candidateKeywordCount(["AI API","GPU cloud"],candidates),1);
  assert.equal(candidateKeywordCount(["AI API","GPU cloud","pricing"],candidates),0);
});
test("empty candidate inventory leaves the formal total unchanged", () => {
  assert.equal(candidateKeywordCount(["AI API"],[]),0);
  assert.equal(candidateKeywordCount([], ["new term", "NEW TERM"]),1);
});
