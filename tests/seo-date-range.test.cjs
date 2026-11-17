const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),ts=require("typescript");
require.extensions[".ts"]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {validRange,previousRange,shiftDay,listDateRange,dateInListRange}=require("../src/lib/seo-date-range.ts");
test("comparison preserves inclusive duration across year and leap boundaries",()=>{assert.deepEqual(previousRange({start:"2026-01-01",end:"2026-01-07"}),{start:"2025-12-25",end:"2025-12-31"});assert.deepEqual(previousRange({start:"2024-03-01",end:"2024-03-01"}),{start:"2024-02-29",end:"2024-02-29"})});
test("invalid or reversed dates are rejected without accepting normalized dates",()=>{for(const range of [{start:"2026-02-30",end:"2026-03-01"},{start:"",end:"2026-01-01"},{start:"2026-02-01",end:"2026-01-01"}])assert.equal(validRange(range),false);assert.equal(shiftDay("2026-11-01",1),"2026-11-02")});
test("list date filters include both calendar boundaries in Beijing time",()=>{
  const empty={start:"",end:""};
  assert.equal(listDateRange("all","2026-11-16",empty),null);
  assert.deepEqual(listDateRange("week","2026-11-16",empty),{start:"2026-11-16",end:"2026-11-22"});
  assert.deepEqual(listDateRange("week","2026-11-22",empty),{start:"2026-11-16",end:"2026-11-22"});
  assert.deepEqual(listDateRange("month","2028-02-11",empty),{start:"2028-02-01",end:"2028-02-29"});
  assert.equal(listDateRange("custom","2026-11-16",{start:"2026-11-18",end:"2026-11-16"}),null);
  const range=listDateRange("custom","2026-11-16",{start:"2026-11-16",end:"2026-11-16"});
  assert.equal(dateInListRange("2026-11-15T16:00:00Z",range),true);
  assert.equal(dateInListRange("2026-11-16T16:00:00Z",range),false);
  assert.equal(dateInListRange("2026-11-16",range),true);
  assert.equal(dateInListRange(null,range),false);
});
