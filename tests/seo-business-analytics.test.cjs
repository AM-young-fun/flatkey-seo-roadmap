const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), load = Module._load, resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
Module._load = function(name, ...rest) { return name === "server-only" ? {} : load.call(this, name, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { businessAnalyticsSchema, latestBusinessPeriod, businessDigestLines } = require("../src/lib/seo-business-analytics.ts");
const { fetchGa4Business } = require("../src/lib/services/ga4-business.ts");
const fixture = (extra={}) => ({ version:1,siteDomain:"flatkey.ai",propertyId:"541304395",source:"google-api",start:"2026-11-01",end:"2026-11-07",timezone:"America/Los_Angeles",country:"all",scope:"session-organic-search",observedAt:"2026-11-09T12:00:00Z",distinctOverWholePeriod:true,complete:true,reasons:[],rows:[{event:"gpu_rental_success",events:12,users:7}],...extra });
const provider = (extra={}) => ({ dimensionHeaders:[{name:"eventName"}],metricHeaders:[{name:"eventCount"},{name:"totalUsers"}],rows:[{dimensionValues:[{value:"gpu_rental_success"}],metricValues:[{value:"12"},{value:"7"}]}],rowCount:1,metadata:{timeZone:"America/Los_Angeles"},...extra });

test("business intervals reject duplicate events, unclosed days, future, unknown and mislabeled complete data",()=>{
 assert.equal(businessAnalyticsSchema.safeParse(fixture()).success,true);
 for(const row of [fixture({rows:[...fixture().rows,...fixture().rows]}),fixture({observedAt:"2026-11-07T12:00:00Z"}),fixture({scope:"organic"}),fixture({reasons:["thresholding"]}),fixture({rows:[{event:"sign_up_success",events:1,users:1}]}),fixture({rows:[{event:"gpu_rental_success",events:-1,users:1}]})]) assert.equal(businessAnalyticsSchema.safeParse(row).success,false);
});
test("event totals never cross country, channel or period and missing events are not zero or activation rates",()=>{
 const row=fixture();
 assert.equal(latestBusinessPeriod([row],row.start,row.end,"US",row.scope),null);
 assert.equal(latestBusinessPeriod([row],row.start,row.end,"all","all-channels"),null);
 assert.equal(latestBusinessPeriod([row],"2026-11-02",row.end,"all",row.scope),null);
 const text=businessDigestLines([row],row.start,row.end).join("\n");
 assert.match(text,/GPU 租赁成功事件：12 次 \/ 区间去重 7 人/);
 assert.match(text,/API 首次成功使用：未观测到/);
 assert.match(text,/全渠道业务：.*待更新/);
 assert.doesNotMatch(text,/激活率|API 首次成功使用：0|58\./);
});
test("GA4 business collector queries a full interval and distinct users with exact organic/country filters",async t=>{
 process.env.SEO_GA4_ACCESS_TOKEN="fixture-only";
 let query;
 t.mock.method(globalThis,"fetch",async(url,init)=>{assert.equal(url,"https://analyticsdata.googleapis.com/v1beta/properties/541304395:runReport");query=JSON.parse(init.body);return Response.json(provider());});
 const result=await fetchGa4Business({start:"2026-11-01",end:"2026-11-07",country:"JP",scope:"session-organic-search"},new Date("2026-11-09T12:00:00Z"));
 assert.deepEqual(query.dimensions,[{name:"eventName"}]);
 assert.deepEqual(query.metrics,[{name:"eventCount"},{name:"totalUsers"}]);
 assert.match(JSON.stringify(query.dimensionFilter),/Organic Search/);assert.match(JSON.stringify(query.dimensionFilter),/"JP"/);
 assert.equal(result.rows[0].users,7);assert.equal(result.distinctOverWholePeriod,true);
});
test("thresholding stays partial; all-channel query does not pretend organic and empty response stays unobserved",async t=>{
 process.env.SEO_GA4_ACCESS_TOKEN="fixture-only";let query;
 t.mock.method(globalThis,"fetch",async(url,init)=>{query=JSON.parse(init.body);return Response.json(provider({rows:[],rowCount:0,metadata:{timeZone:"America/Los_Angeles",subjectToThresholding:true}}));});
 const result=await fetchGa4Business({start:"2026-11-01",end:"2026-11-07",country:"all",scope:"all-channels"},new Date("2026-11-09T12:00:00Z"));
 assert.doesNotMatch(JSON.stringify(query),/Organic Search|countryId/);assert.equal(result.complete,false);assert.deepEqual(result.rows,[]);
 assert.deepEqual(result.reasons,["thresholding"]);
});
test("provider pagination or malformed metrics cannot become a complete business report",async t=>{
 process.env.SEO_GA4_ACCESS_TOKEN="fixture-only";
 const replies=[provider({rowCount:2}),provider({metricHeaders:[{name:"eventCount"}]}),provider({rows:[{dimensionValues:[{value:"gpu_rental_success"}],metricValues:[{value:"NaN"},{value:"7"}]}]}),provider({metadata:{}}),provider({metadata:{timeZone:"Asia/Shanghai"}})];
 t.mock.method(globalThis,"fetch",async()=>Response.json(replies.shift()));
 for(let i=0;i<5;i++) await assert.rejects(fetchGa4Business({start:"2026-11-01",end:"2026-11-07",country:"all",scope:"all-channels"},new Date("2026-11-09T12:00:00Z")));
});

const { funnelRequest, fetchGa4Journey, fetchGa4Engagement } = require("../src/lib/services/ga4-journeys.ts");
const { journeyLabels } = require("../src/lib/seo-business-journeys.ts");
const journeyQuery = {start:"2026-11-01",end:"2026-11-07",country:"JP",scope:"all-channels"};
test("closed GA4 funnels bind ordered same-user GPU parameters and bounded API steps",()=>{
 const gpu=funnelRequest(journeyQuery,"gpu"),api=funnelRequest(journeyQuery,"api");
 assert.equal(gpu.funnel.isOpenFunnel,false);assert.equal(gpu.funnel.steps[1].withinDurationFromPriorStep,"86400s");
 assert.match(JSON.stringify(gpu),/"eventParameterName":"business"/);assert.match(JSON.stringify(gpu),/"eventParameterName":"flow"/);assert.match(JSON.stringify(gpu),/gpu_rental/);assert.match(JSON.stringify(gpu),/"value":"start"/);
 assert.equal(api.funnel.steps[1].withinDurationFromPriorStep,"604800s");assert.equal(api.funnel.steps[2].withinDurationFromPriorStep,"2592000s");
 assert.throws(()=>funnelRequest({...journeyQuery,scope:"session-organic-search"},"gpu"));
});
test("funnel response counts and abandonments come from provider, permissions fail visibly without zeros",async t=>{
 process.env.SEO_GA4_ACCESS_TOKEN="fixture-only";
 const report={funnelTable:{dimensionHeaders:[{name:"funnelStepName"}],metricHeaders:[{name:"activeUsers"},{name:"funnelStepAbandonments"},{name:"funnelStepCompletionRate"}],rows:journeyLabels.gpu.map((name,i)=>({dimensionValues:[{value:`${i+1}. ${name}`}],metricValues:[{value:String([10,4,2][i])},{value:String([6,2,0][i])},{value:String([0.4,0.5,0][i])}]}))}};
 let next=Response.json(report);t.mock.method(globalThis,"fetch",async url=>{assert.match(url,/:runFunnelReport$/);return next;});
 const value=await fetchGa4Journey(journeyQuery,"gpu");assert.equal(value.status,"ready");assert.equal(value.steps[0].abandonments,6);assert.equal(value.steps[0].completionRate,0.4);
 next=new Response("Forbidden",{status:403});const denied=await fetchGa4Journey(journeyQuery,"gpu");assert.equal(denied.status,"unavailable");assert.deepEqual(denied.steps,[]);assert.match(denied.reason,/403/);
 next=Response.json({...report,funnelTable:{...report.funnelTable,rows:[]}});assert.equal((await fetchGa4Journey(journeyQuery,"gpu")).reason,"no_matching_steps_in_selected_period");
 next=Response.json({...report,funnelTable:{...report.funnelTable,rows:report.funnelTable.rows.map(row=>({...row,metricValues:row.metricValues.map(()=>({value:"0"}))}))}});assert.equal((await fetchGa4Journey(journeyQuery,"gpu")).reason,"no_matching_steps_in_selected_period");
});
test("engagement verifies standard duration independently of missing custom active-time metric",async t=>{
 process.env.SEO_GA4_ACCESS_TOKEN="fixture-only";
 t.mock.method(globalThis,"fetch",async url=>url.endsWith("/metadata")?Response.json({metrics:[]}):Response.json({metricHeaders:[{name:"userEngagementDuration"},{name:"activeUsers"}],rows:[{metricValues:[{value:"150.5"},{value:"3"}]}]}));
 const value=await fetchGa4Engagement(journeyQuery);assert.equal(value.status,"ready");assert.equal(value.engagementSeconds,150.5);assert.equal(value.activeTimeCustomMetric,"missing");
});
