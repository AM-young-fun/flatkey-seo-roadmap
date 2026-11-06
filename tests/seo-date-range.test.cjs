const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),ts=require("typescript");
require.extensions[".ts"]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {validRange,previousRange,shiftDay}=require("../src/lib/seo-date-range.ts");
test("comparison preserves inclusive duration across year and leap boundaries",()=>{assert.deepEqual(previousRange({start:"2026-01-01",end:"2026-01-07"}),{start:"2025-12-25",end:"2025-12-31"});assert.deepEqual(previousRange({start:"2024-03-01",end:"2024-03-01"}),{start:"2024-02-29",end:"2024-02-29"})});
test("invalid or reversed dates are rejected without accepting normalized dates",()=>{for(const range of [{start:"2026-02-30",end:"2026-03-01"},{start:"",end:"2026-01-01"},{start:"2026-02-01",end:"2026-01-01"}])assert.equal(validRange(range),false);assert.equal(shiftDay("2026-11-01",1),"2026-11-02")});
