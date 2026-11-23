const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),ts=require("typescript");
require.extensions[".ts"]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {validRange,previousRange,shiftDay,listDateRange,dateInListRange,workWeekDateRange,seoToday}=require("../src/lib/seo-date-range.ts");
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

test("task business week spans Friday through Thursday without changing calendar list weeks",()=>{
  const empty={start:"",end:""};
  for(const today of ["2026-11-20","2026-11-21","2026-11-22","2026-11-23","2026-11-24","2026-11-25","2026-11-26"]) {
    assert.deepEqual(workWeekDateRange(today),{start:"2026-11-20",end:"2026-11-26"});
    assert.deepEqual(listDateRange("week",today,empty,"work"),{start:"2026-11-20",end:"2026-11-26"});
  }
  assert.deepEqual(workWeekDateRange("2026-11-27"),{start:"2026-11-27",end:"2026-12-03"});
  assert.deepEqual(workWeekDateRange("2027-01-01"),{start:"2027-01-01",end:"2027-01-07"});
  assert.deepEqual(listDateRange("week","2026-11-23",empty),{start:"2026-11-23",end:"2026-11-29"});
  const range=workWeekDateRange("2026-11-23");
  assert.equal(dateInListRange("2026-11-19T16:00:00Z",range),true,"Friday starts at Beijing midnight");
  assert.equal(dateInListRange("2026-11-26T15:59:59Z",range),true,"Thursday remains included");
  assert.equal(dateInListRange("2026-11-26T16:00:00Z",range),false,"next Friday belongs to the next work week");
  assert.equal(seoToday(new Date("2026-11-26T16:00:00Z")),"2026-11-27");
});
