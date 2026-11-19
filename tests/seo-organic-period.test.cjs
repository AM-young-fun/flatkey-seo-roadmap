const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const { organicPeriodSchema, organicReportWindows, compareOrganicPeriods } = require("../src/lib/seo-organic-period.ts");
const period=(start,end,extra={})=>({hostScope:"production-hosts-v1",siteDomain:"flatkey.ai",propertyId:"541304395",start,end,timezone:"America/Los_Angeles",country:"all",source:"google-api",scope:"session-organic-search",channelDimension:"sessionDefaultChannelGroup",users:20,registrations:2,registrationEvent:"sign_up_success",distinctOverWholePeriod:true,observedAt:"2026-11-10T02:00:00Z",complete:true,reasons:[],...extra});
test("Friday's not-yet-closed source day yields equal shorter weekly windows",()=>{
 assert.deepEqual(organicReportWindows("2026-11-13","2026-11-11"),[{start:"2026-11-06",end:"2026-11-11"},{start:"2026-10-30",end:"2026-11-04"}]);
 assert.deepEqual(organicReportWindows("2026-11-14","2026-11-12"),[]);
});
test("Thursday preparation and Friday revisions collect the same Los Angeles Thu–Wed intervals",()=>{
 const expected=[{start:"2026-11-12",end:"2026-11-18"},{start:"2026-11-05",end:"2026-11-11"}];
 assert.deepEqual(organicReportWindows("2026-11-19","2026-11-18"),expected);
 assert.deepEqual(organicReportWindows("2026-11-20","2026-11-19"),expected);
 assert.deepEqual(organicReportWindows("2026-11-19","2026-11-17"),[
  {start:"2026-11-12",end:"2026-11-17"},{start:"2026-11-05",end:"2026-11-10"},
 ]);
 assert.deepEqual(organicReportWindows("2026-11-26","2026-11-25"),[
  {start:"2026-11-19",end:"2026-11-25"},{start:"2026-11-12",end:"2026-11-18"},
 ]);
});
test("new weekly comparison does not mix historical Friday starts into the Thursday week",()=>{
 const current=period("2026-11-12","2026-11-18"),previous=period("2026-11-05","2026-11-11");
 const old=period("2026-11-06","2026-11-12");
 assert.equal(compareOrganicPeriods([current,old],"2026-11-20"),null);
 assert.equal(compareOrganicPeriods([current,previous],"2026-11-19").previous,previous);
 assert.equal(compareOrganicPeriods([current,previous],"2026-11-20").current,current);
});
test("weekly distinct registrations require a full-range query with matching weekdays",()=>{
 const current=period("2026-11-06","2026-11-08"), wrong=period("2026-10-30","2026-11-02");
 assert.equal(compareOrganicPeriods([current,wrong],"2026-11-13"),null);
 const previous=period("2026-10-30","2026-11-01");
 assert.equal(compareOrganicPeriods([current,previous],"2026-11-13").previous,previous);
 assert.equal(compareOrganicPeriods([current,{...previous,country:"US"}],"2026-11-13"),null);
});
test("provisional values, missing users and summed daily approximations cannot claim complete periods",()=>{
 const good=period("2026-11-06","2026-11-08"); assert.equal(organicPeriodSchema.safeParse(good).success,true);
 assert.equal(organicPeriodSchema.safeParse({...good,distinctOverWholePeriod:false}).success,false);
 assert.equal(organicPeriodSchema.safeParse({...good,users:null}).success,false);
 assert.equal(organicPeriodSchema.safeParse({...good,reasons:["provisional"]}).success,false);
 assert.equal(organicPeriodSchema.safeParse({...good,end:"2026-11-09"}).success,false);
 assert.equal(organicPeriodSchema.safeParse({...good,complete:false,users:null,registrations:null,reasons:["missing"]}).success,true);
});
