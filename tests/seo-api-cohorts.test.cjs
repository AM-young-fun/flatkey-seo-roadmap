const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), load = Module._load, resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
Module._load = function(name, ...rest) { return name === "server-only" ? {} : load.call(this, name, ...rest); };
require.extensions[".ts"] = require.extensions[".tsx"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
require.extensions[".css"] = module => { module.exports = new Proxy({}, { get: (_, key) => String(key) }); };
const { planApiCohort, cohortMidnight, cohortObservationEnd, cohortCoverageStart, matureCohortWindows, cohortKinds, apiCohortSchema } = require("../src/lib/seo-api-cohorts.ts");
const { apiCohortRequest, parseApiCohortResponse, fetchGa4ApiCohorts, extractClosedFunnelUsers } = require("../src/lib/services/ga4-api-cohorts.ts");
const { businessAnalyticsSchema, latestBusinessPeriod, recentMatureCohortPeriods } = require("../src/lib/seo-business-analytics.ts");
const query = { start:"2026-10-01", end:"2026-10-07", country:"JP", scope:"session-organic-search" };
const now = new Date("2026-11-10T20:00:00Z"), coverage = "2026-10-01T07:00:00Z";
const plans = () => cohortKinds.map(kind => planApiCohort(query, kind, now, coverage));
const response = (users=[10,4], extra={}) => ({ funnelTable: {dimensionHeaders:[{name:"funnelStepName"}], metricHeaders:[{name:"activeUsers"},{name:"eventCount"}], rows:users.map((value,i)=>({dimensionValues:[{value:`${i+1}. ${i ? "Outcome" : "Registration"}`}],metricValues:[{value:String(value)},{value:"999"}]})), ...extra } });

test("explicit coverage only: no network on missing/invalid coverage, immature periods or timezone gap", async t => {
  t.mock.method(globalThis,"fetch",async()=>{throw Error("unexpected network");});
  for(const coverageStart of ["", "2026-10-01", "invalid"]) {
    const rows=await fetchGa4ApiCohorts(query,{now,coverageStart,verifiedTimezone:"America/Los_Angeles"});
    assert.ok(rows.every(row=>row.status==="unconfigured"&&row.rate===null));
  }
  const immature=await fetchGa4ApiCohorts({...query,start:"2026-11-08",end:"2026-11-09"},{now,coverageStart:coverage,verifiedTimezone:"America/Los_Angeles"});
  assert.ok(immature.every(row=>row.status==="immature"&&row.registeredUsers===null));
  const timezone=await fetchGa4ApiCohorts(query,{now,coverageStart:coverage});
  assert.ok(timezone.every(row=>row.reasons[0]==="property_timezone_not_verified"));
  assert.equal(globalThis.fetch.mock.callCount(),0);
});

test("coverage aligns to complete property days, excluding partial deployment days and old history",()=>{
  assert.equal(cohortCoverageStart("2026-10-01T00:00:00-07:00"),new Date(coverage).toISOString());
  assert.equal(plans()[0].firstEligibleRegistrationDay,"2026-10-01");
  const partial=planApiCohort(query,cohortKinds[0],now,"2026-10-01T07:00:00.001Z");
  assert.equal(partial.firstEligibleRegistrationDay,"2026-10-02");assert.equal(partial.status,"insufficient_coverage");assert.equal(partial.rate,null);
  const old=planApiCohort({...query,start:"2026-09-20"},cohortKinds[0],now,coverage);
  assert.equal(old.status,"insufficient_coverage");
  assert.throws(()=>planApiCohort({...query,end:"2026-09-30"},cohortKinds[0],now,coverage));
});

test("DST property-midnight and elapsed-second horizon never mature one hour early",()=>{
  assert.equal(cohortMidnight("2026-03-09")-cohortMidnight("2026-03-08"),23*3600000);
  assert.equal(cohortMidnight("2026-11-02")-cohortMidnight("2026-11-01"),25*3600000);
  assert.equal(cohortObservationEnd("2026-03-07",cohortKinds[0]),"2026-03-15");
  assert.equal(cohortObservationEnd("2026-10-31",cohortKinds[0]),"2026-11-07");
  const q={...query,start:"2026-03-07",end:"2026-03-07"};
  const before=planApiCohort(q,cohortKinds[0],new Date("2026-03-18T06:59:59.999Z"),"2026-03-01T08:00:00Z");
  const at=planApiCohort(q,cohortKinds[0],new Date("2026-03-18T07:00:00.000Z"),"2026-03-01T08:00:00Z");
  assert.equal(before.status,"immature");assert.equal(at.reasons[0],"awaiting_funnel_query");
  assert.equal(at.matureAt,"2026-03-18T07:00:00.000Z");
});

test("two independent closed funnels constrain canonical registration only, including exact country and organic source",()=>{
  const requests=plans().map(plan=>apiCohortRequest(query,plan));
  for(const [i,request] of requests.entries()) {
    assert.equal(request.funnel.isOpenFunnel,false);assert.equal(request.funnel.steps.length,2);
    const [first,second]=request.funnel.steps;
    assert.deepEqual(first.filterExpression.andGroup.expressions[0],{funnelEventFilter:{eventName:"sign_up"}});
    assert.deepEqual(first.filterExpression.andGroup.expressions[1].funnelFieldFilter.inListFilter.values,["20261001","20261002","20261003","20261004","20261005","20261006","20261007"]);
    assert.match(JSON.stringify(first),/Organic Search/);assert.match(JSON.stringify(first),/countryId/);
    assert.doesNotMatch(JSON.stringify(second),/Organic Search|countryId|date|lifetime_first_known/);
    assert.equal(second.isDirectlyFollowedBy,false);assert.equal(second.withinDurationFromPriorStep,i?"2592000s":"604800s");
    assert.deepEqual(request.dimensionFilter,{filter:{fieldName:"hostName",inListFilter:{values:["flatkey.ai","www.flatkey.ai","console.flatkey.ai","router.flatkey.ai"],caseSensitive:false}}});
  }
  assert.equal(requests[1].funnel.steps[1].filterExpression.funnelEventFilter.eventName,"first_payment_completed");
  assert.doesNotMatch(JSON.stringify(requests[1]),/first_model_success/);
  const q={...query,country:"all",scope:"all-channels"}, plan=planApiCohort(q,cohortKinds[0],now,coverage);
  assert.doesNotMatch(JSON.stringify(apiCohortRequest(q,plan)),/Organic Search|countryId/);
  assert.throws(()=>apiCohortRequest({...query,country:"US"},plan));
});

// Minimal synthetic GA4 contract oracle: event order, same identity, first-step
// date/source/country, closed entry and elapsed bounds. No real GA4 query.
function evaluate(request, events) {
  const first=request.funnel.steps[0].filterExpression.andGroup.expressions;
  const dates=first.find(v=>v.funnelFieldFilter?.fieldName==="date").funnelFieldFilter.inListFilter.values;
  const country=first.find(v=>v.funnelFieldFilter?.fieldName==="countryId")?.funnelFieldFilter.stringFilter.value;
  const channel=first.find(v=>v.funnelFieldFilter?.fieldName==="sessionDefaultChannelGroup")?.funnelFieldFilter.stringFilter.value;
  const last=request.funnel.steps[1], target=last.filterExpression.funnelEventFilter.eventName;
  const hosts=request.dimensionFilter.filter.inListFilter.values;
  const eligible=events.filter(e=>hosts.includes(e.host));
  const starts=new Map();
  for(const e of eligible.filter(e=>e.name==="sign_up"&&dates.includes(e.date)&&(!country||country===e.country)&&(!channel||channel===e.channel)).sort((a,b)=>a.time-b.time)) if(!starts.has(e.user)) starts.set(e.user,e.time);
  const converted=new Set(eligible.filter(e=>e.name===target&&e.business==="api"&&starts.has(e.user)&&e.time>=starts.get(e.user)&&e.time-starts.get(e.user)<=parseInt(last.withinDurationFromPriorStep)*1000).map(e=>e.user));
  return [starts.size,converted.size];
}
test("synthetic independent-funnel contract includes later Direct and payment before use, deduplicating users",()=>{
  const base={date:"20261001",host:"console.flatkey.ai",country:"JP",channel:"Organic Search",business:"api",time:0};
  const events=[{...base,user:"a",name:"sign_up"},{...base,user:"a",name:"sign_up"},
    {...base,user:"a",name:"first_payment_completed",time:3600000,channel:"Direct"},
    {...base,user:"a",name:"first_payment_completed",time:7200000,channel:"Direct"},
    {...base,user:"a",name:"first_model_success",time:604800000,channel:"Direct",host:"router.flatkey.ai"},
    {...base,user:"b",name:"sign_up"},{...base,user:"b",name:"first_model_success",time:604800001},
    {...base,user:"b",name:"first_payment_completed",time:2592000000},
    {...base,user:"c",name:"sign_up",channel:"Paid Search"}, {...base,user:"c",name:"first_payment_completed",time:1},
    {...base,user:"d",name:"sign_up",date:"20261008"}, {...base,user:"d",name:"first_payment_completed",time:1},
    {...base,user:"e",name:"sign_up",host:"staging-console.flatkey.ai"}, {...base,user:"e",name:"first_payment_completed",time:1}];
  const counts=plans().map(plan=>evaluate(apiCohortRequest(query,plan),events));
  assert.deepEqual(counts,[[2,1],[2,2]]);
  const rows=plans().map((plan,i)=>parseApiCohortResponse(plan,response(counts[i])));
  assert.equal(rows[0].rate,0.5);assert.equal(rows[1].rate,1);
  assert.equal(rows[1].registeredUsers,2);assert.equal(rows[1].convertedUsers,2); // not 999 event totals
});

test("sampling, thresholding, missing or malformed rows never become a valid zero-rate result",()=>{
  const plan=plans()[0];
  for(const r of [response([10,4],{metadata:{samplingMetadatas:[{samplesReadCount:"50",samplingSpaceSize:"100"}]}}),response([10,4],{metadata:{subjectToThresholding:true}}),response([10,4],{metadata:{dataLossFromOtherRow:true}}),response([10],{}),response([10,11]),response([10,4],{rowCount:3}),response([],{}),response([10,NaN])]) {
    const row=parseApiCohortResponse(plan,r);assert.ok(["partial","unavailable"].includes(row.status));assert.equal(row.rate,null);assert.equal(row.registeredUsers,null);assert.equal(row.convertedUsers,null);
  }
  const noUsers=parseApiCohortResponse(plan,response([0,0]));assert.equal(noUsers.status,"no_users");assert.equal(noUsers.rate,null);
  const zero=parseApiCohortResponse(plan,response([10,0],{metadata:{samplingMetadatas:[]}}));assert.equal(zero.status,"ready");assert.equal(zero.rate,0);
});

test("actual request adapter binds timezone proof, parses the two provider user counts and isolates failures",async t=>{
  process.env.SEO_GA4_ACCESS_TOKEN="fixture-only";
  const requests=[];
  t.mock.method(globalThis,"fetch",async(url,init)=>{assert.match(url,/v1alpha\/properties\/541304395:runFunnelReport$/);const body=JSON.parse(init.body);requests.push(body);return body.funnel.steps[1].withinDurationFromPriorStep==="604800s"?Response.json(response([12,3])):new Response("Forbidden",{status:403});});
  const rows=await fetchGa4ApiCohorts(query,{now,coverageStart:coverage,verifiedTimezone:"America/Los_Angeles"});
  assert.equal(requests.length,2);assert.equal(rows[0].rate,0.25);assert.equal(rows[1].status,"unavailable");assert.deepEqual(rows[1].reasons,["funnel_http_403"]);
});

test("mature collection windows are bounded, deduplicated, delayed and inactive until explicitly configured",()=>{
  assert.deepEqual(matureCohortWindows(now,""),[]);
  const ranges=matureCohortWindows(now,coverage);assert.equal(ranges.length,2);
  for(const range of ranges) { assert.equal(Date.parse(range.end)-Date.parse(range.start),6*86400000);assert.ok(range.start>="2026-10-01"); }
  const pay=planApiCohort({...ranges[1],country:"all",scope:"all-channels"},cohortKinds[1],now,coverage);
  assert.equal(pay.reasons[0],"awaiting_funnel_query");
  assert.deepEqual(matureCohortWindows(new Date("2026-10-03T20:00:00Z"),coverage),[]);
});

test("archive schema prevents cohort range, country, source, identity and timestamp mismatches",()=>{
  const cohorts=plans().map(plan=>parseApiCohortResponse(plan,response()));
  const record={hostScope:"production-hosts-v1",version:1,siteDomain:"flatkey.ai",propertyId:"541304395",source:"google-api",...query,timezone:"America/Los_Angeles",observedAt:now.toISOString(),distinctOverWholePeriod:true,complete:true,reasons:[],rows:[],apiCohorts:cohorts};
  assert.equal(businessAnalyticsSchema.safeParse(record).success,true);
  for(const change of [{country:"US"},{scope:"all-channels"},{start:"2026-10-02"},{observedAt:"2026-11-10T21:00:00Z"},{apiCohorts:[cohorts[0],cohorts[0]]}]) assert.equal(businessAnalyticsSchema.safeParse({...record,...change}).success,false);
  assert.equal(apiCohortSchema.safeParse({...cohorts[0],rate:0.99}).success,false);
  assert.equal(apiCohortSchema.safeParse({...cohorts[0],observedAt:"2026-10-02T20:00:00Z"}).success,false);
  assert.equal(apiCohortSchema.safeParse({...cohorts[0],coverageStart:null}).success,false);
  assert.equal(latestBusinessPeriod([{...record,hostScope:undefined}],query.start,query.end,query.country,query.scope).apiCohorts,undefined);
});

test("two UI cards show only same-funnel mature rates and explicitly distinguish no users, unavailable and unconfigured",()=>{
  const {renderToStaticMarkup}=require("react-dom/server"), React=require("react");
  const {SeoApiCohorts}=require("../src/components/SeoApiCohorts.tsx");
  const html=rows=>renderToStaticMarkup(React.createElement(SeoApiCohorts,{cohorts:rows,range:query}));
  const ready=html(plans().map(plan=>parseApiCohortResponse(plan,response([10,4]))));
  assert.equal((ready.match(/40.0%/g)||[]).length,2);assert.match(ready,/4 \/ 10 名可观测注册用户/);
  const unknown=html(cohortKinds.map(kind=>planApiCohort(query,kind,now,"")));
  assert.match(unknown,/观察起点待确认/);assert.doesNotMatch(unknown,/0.0%/);
  const noUsers=html(plans().map(plan=>parseApiCohortResponse(plan,response([0,0]))));assert.match(noUsers,/不计算比率/);assert.doesNotMatch(noUsers,/0.0%/);
  assert.match(html(undefined),/待采集/);assert.match(html(undefined),/该注册时段尚无统计结果/);assert.match(html(undefined),/按同一批注册用户统计/);assert.doesNotMatch(html(undefined),/canonical|cohort 回执/);
  const disabled=renderToStaticMarkup(React.createElement(SeoApiCohorts,{range:query,collectionPresent:true}));assert.match(disabled,/未启用/);assert.match(disabled,/生产版本与观察起点待确认/);assert.doesNotMatch(disabled,/0.0%/);
});


test("mature archive shortcuts preserve country/source/window and never substitute an old ready record over a new failed query",()=>{
  const cohorts=plans().map(plan=>parseApiCohortResponse(plan,response()));
  const record={hostScope:"production-hosts-v1",version:1,siteDomain:"flatkey.ai",propertyId:"541304395",source:"google-api",...query,timezone:"America/Los_Angeles",observedAt:now.toISOString(),distinctOverWholePeriod:true,complete:true,reasons:[],rows:[],apiCohorts:cohorts};
  const periods=recentMatureCohortPeriods([record],query.country,query.scope);
  assert.equal(periods.length,2);assert.equal(periods[0].start,query.start);assert.equal(periods[1].observationEnd,"2026-11-06");
  assert.deepEqual(recentMatureCohortPeriods([record],"US",query.scope),[]);
  assert.deepEqual(recentMatureCohortPeriods([record],query.country,"all-channels"),[]);
  assert.deepEqual(recentMatureCohortPeriods([{...record,hostScope:undefined}],query.country,query.scope),[]);
  const failed={...record,observedAt:"2026-11-10T21:00:00Z",apiCohorts:plans()};
  assert.deepEqual(recentMatureCohortPeriods([record,failed],query.country,query.scope),[]);
  const {renderToStaticMarkup}=require("react-dom/server"),React=require("react");const {SeoApiCohorts}=require("../src/components/SeoApiCohorts.tsx");
  const html=renderToStaticMarkup(React.createElement(SeoApiCohorts,{cohorts:undefined,range:{start:"2026-11-01",end:"2026-11-07"},periods,onRangeSelect:()=>{}}));
  assert.match(html,/查看已归档 D30/);assert.match(html,/注册 2026-10-01—2026-10-07/);assert.doesNotMatch(html,/40.0%/);
});


test("actual 2026-11-11 business probe shape: HTTP200 and repeated metric headers without rows stay unavailable, never zero",()=>{
  const evidence=require("./fixtures/ga4-cohort-business-empty-20261111.json");
  assert.equal(evidence.provenance.workflowRunId,"43011867856");
  assert.equal(evidence.provenance.responseSha256,"e8e1aae79c649f4c96eec885b737af5a13c954ad55eab1a5a4ba2ac7de19b152");
  assert.equal(evidence.shape.returnedRows,null);assert.equal(evidence.shape.rows,null);
  const provider={funnelTable:{dimensionHeaders:evidence.shape.dimensionHeaders.map(name=>({name})),metricHeaders:evidence.shape.metricHeaders.map(name=>({name}))}};
  for(const plan of plans()) {
    const result=parseApiCohortResponse(plan,provider);assert.equal(result.status,"unavailable");
    assert.equal(result.registeredUsers,null);assert.equal(result.convertedUsers,null);assert.equal(result.rate,null);
  }
});


const liveShape=require("./fixtures/ga4-page-view-shape-20261111.json");
function replayLiveShape() {
  const table=shape=>({dimensionHeaders:shape.dimensionHeaders.map(name=>({name})),metricHeaders:shape.metricHeaders.map((name,i)=>({name,type:shape.metricTypes[i]})),rows:shape.rows.map(row=>({dimensionValues:[{value:row.step}],metricValues:row.values.map(value=>({value}))}))});
  return {funnelTable:table(liveShape.table),funnelVisualization:table(liveShape.visualization)};
}
test("actual nonempty provider replay validates 7627/1442 page-view users without relabeling them as a registration cohort",()=>{
  assert.equal(liveShape.provenance.workflowRunId,"43012602560");assert.equal(liveShape.provenance.responseSha256,"219af2a3fe66105047737bfd13aa8d0b04bb22948a925fded39e8807e3221691");
  const result=extractClosedFunnelUsers(replayLiveShape(),liveShape.provenance.stepNames);
  assert.deepEqual(result,{status:"ready",users:[7627,1442]});assert.equal("rate" in result,false);
  const business=parseApiCohortResponse(plans()[0],replayLiveShape());assert.equal(business.status,"unavailable");assert.equal(business.rate,null);
});
test("duplicate headers are accepted only for the exact observed single-group width with matching independent visualization",()=>{
  const mutations=[
    raw=>{raw.funnelTable.rows.forEach(row=>row.metricValues.push(...row.metricValues));},
    raw=>{raw.funnelTable.metricHeaders[7].name="differentMetric";},
    raw=>{raw.funnelTable.metricHeaders[4].type="TYPE_FLOAT";},
    raw=>{delete raw.funnelVisualization;},
    raw=>{raw.funnelVisualization.metricHeaders.pop();},
    raw=>{raw.funnelVisualization.rows[0].metricValues[0].value="7628";},
    raw=>{raw.funnelVisualization.rows[1].dimensionValues[0].value="Different outcome";},
    raw=>{raw.funnelVisualization.rows[0].metricValues.push({value:"7627"});},
    raw=>{raw.funnelVisualization.rows.pop();},
    raw=>{raw.funnelTable.rows[1].dimensionValues[0].value=raw.funnelTable.rows[0].dimensionValues[0].value;},
    raw=>{raw.funnelTable.rows[0].metricValues.pop();},
    raw=>{raw.funnelTable.dimensionHeaders.push({name:"countryId"});},
    raw=>{raw.funnelTable.rows[0].metricValues[0].value="7627.5";},
  ];
  for(const mutate of mutations) { const raw=replayLiveShape();mutate(raw);const result=extractClosedFunnelUsers(raw,liveShape.provenance.stepNames);assert.equal(result.status,"unavailable");assert.equal("users" in result,false); }
  const sampled=replayLiveShape();sampled.funnelVisualization.metadata={samplingMetadatas:[{samplesReadCount:"10",samplingSpaceSize:"100"}]};assert.equal(extractClosedFunnelUsers(sampled,liveShape.provenance.stepNames).status,"partial");
});
test("synthetic canonical-label contract uses the verified header normalization inside the unchanged business maturity gate",()=>{
  // Deliberately synthetic labels: the original real page-view labels above are
  // preserved and must be rejected by the business wrapper.
  const raw=replayLiveShape();for(const table of [raw.funnelTable,raw.funnelVisualization]) table.rows.forEach((row,i)=>{row.dimensionValues[0].value=i?"2. Outcome":"1. Registration";});
  const row=parseApiCohortResponse(plans()[0],raw);assert.equal(row.status,"ready");assert.equal(row.registeredUsers,7627);assert.equal(row.convertedUsers,1442);assert.equal(row.rate,1442/7627);
  assert.throws(()=>parseApiCohortResponse(planApiCohort(query,cohortKinds[0],now,""),raw));
});
