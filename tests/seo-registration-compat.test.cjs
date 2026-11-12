const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
const load = Module._load;
Module._load = function(name, ...rest) { return name === 'server-only' ? {} : load.call(this, name, ...rest); };
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { fetchGa4Business, fetchGa4RegistrationDays } = require('../src/lib/services/ga4-business.ts');
const { funnelRequest } = require('../src/lib/services/ga4-journeys.ts');
const { apiCohortRequest } = require('../src/lib/services/ga4-api-cohorts.ts');
const { planApiCohort } = require('../src/lib/seo-api-cohorts.ts');
const { businessAnalyticsSchema } = require('../src/lib/seo-business-analytics.ts');
const { registrationDaySeries } = require('../src/lib/seo-registration-days.ts');
const { resolveRegistrationCollectionGate } = require('../scripts/seo-registration-capability.cjs');
const query = { start: '2026-10-01', end: '2026-10-07', country: 'JP', scope: 'session-organic-search' };
const now = new Date('2026-11-11T12:00:00Z');
const base = () => ({dimensionHeaders:[{name:'eventName'}],metricHeaders:[{name:'eventCount'},{name:'totalUsers'}],metadata:{timeZone:'America/Los_Angeles'},rows:[{dimensionValues:[{value:'gpu_rental_success'}],metricValues:[{value:'8'},{value:'4'}]}],rowCount:1});
const registration = (events='5',users='2') => ({dimensionHeaders:[],metricHeaders:[{name:'eventCount'},{name:'totalUsers'}],metadata:{timeZone:'America/Los_Angeles'},rows:[{metricValues:[{value:events},{value:users}]}],rowCount:1});

test('registration aliases use a single dimensionless user query, retaining exact host/country/source scope', async t => {
 process.env.SEO_GA4_ACCESS_TOKEN='fixture-only'; const bodies=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{bodies.push(JSON.parse(init.body));return Response.json(bodies.length===1?base():registration());});
 const row=await fetchGa4Business(query,now,{registrationCompatibility:true});
 assert.equal(bodies.length,2);assert.equal(bodies[1].dimensions,undefined);
 assert.deepEqual(bodies[1].metrics,[{name:'eventCount'},{name:'totalUsers'}]);
 const expressions=bodies[1].dimensionFilter.andGroup.expressions;
 assert.deepEqual(expressions[1].filter.inListFilter.values,['sign_up','sign_up_success']);
 assert.match(JSON.stringify(expressions),/router.flatkey.ai/);assert.match(JSON.stringify(expressions),/Organic Search/);assert.match(JSON.stringify(expressions),/JP/);
 assert.ok(!bodies[0].dimensionFilter.andGroup.expressions[1].filter.inListFilter.values.includes('sign_up'));
 assert.deepEqual(row.rows.find(x=>x.event==='sign_up'),{event:'sign_up',events:5,users:2});
 assert.equal(row.registrationMetric,'sign_up_or_legacy_distinct_users'); assert.equal(row.complete,true);
});

test('Flatkey total includes legacy registrations with a missing hostname only on the verified stream', async t => {
 process.env.SEO_GA4_ACCESS_TOKEN='fixture-only';
 const bodies=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{bodies.push(JSON.parse(init.body));return Response.json(bodies.length===1?base():registration());});
 const row=await fetchGa4Business({...query,country:'all',scope:'all-channels'},now,{registrationCompatibility:true});
 const [hosts, aliases] = bodies[1].dimensionFilter.andGroup.expressions;
 assert.equal(bodies[1].dimensions,undefined);
 assert.deepEqual(aliases.filter.inListFilter.values,['sign_up','sign_up_success']);
 assert.deepEqual(hosts.orGroup.expressions[1].andGroup.expressions.map(({filter})=>[filter.fieldName,filter.stringFilter?.value ?? filter.emptyFilter]),
   [['eventName','sign_up_success'],['streamId','15056169010'],['hostName',{}]]);
 assert.equal(row.rows.find(value=>value.event==='sign_up').users,2);
});

test('failed, empty or restricted registration replies never become false zero registrations', async t => {
 process.env.SEO_GA4_ACCESS_TOKEN='fixture-only'; let registrationResponse, n=0;
 t.mock.method(globalThis,'fetch',async()=>++n%2===1?Response.json(base()):registrationResponse);
 for(const reply of [new Response('Forbidden',{status:403}),Response.json({...registration(),rows:[],rowCount:0}),Response.json({...registration(),metadata:{timeZone:'America/Los_Angeles',subjectToThresholding:true}}),Response.json({...registration(),metadata:{}})]) {
  registrationResponse=reply;
  const row=await fetchGa4Business(query,now,{registrationCompatibility:true});
  assert.equal(row.rows.some(x=>x.event==='sign_up'),false); assert.equal(row.rows[0].users,4);
 }
 registrationResponse=Response.json(registration('0','0'));
 const zero=await fetchGa4Business(query,now,{registrationCompatibility:true});
 assert.deepEqual(zero.rows.find(x=>x.event==='sign_up'),{event:'sign_up',events:0,users:0});
});

test('old importer mode retains its one-request schema without falsely relabeling historical records', async t => {
 process.env.SEO_GA4_ACCESS_TOKEN='fixture-only';let n=0;
 t.mock.method(globalThis,'fetch',async()=>{n++;return Response.json(base());});
 const row=await fetchGa4Business(query,now,{registrationCompatibility:false});
 assert.equal(n,1);assert.equal(Object.hasOwn(row,'registrationMetric'),false);
 assert.equal(businessAnalyticsSchema.safeParse({...row,registrationMetric:'sum_of_two_events'}).success,false);
});

test('both closed funnel kinds OR the old/new names at registration; cohort date and acquisition remain first-step only', () => {
 const standard=funnelRequest({...query,scope:'all-channels'},'api');
 assert.deepEqual(standard.funnel.steps[0].filterExpression.orGroup.expressions.map(x=>x.funnelEventFilter.eventName),['sign_up','sign_up_success']);
 for(const kind of ['api-first-success-d7','api-first-payment-d30']) {
  const plan=planApiCohort(query,kind,now,'2026-09-01T00:00:00Z');
  const req=apiCohortRequest(query,plan),first=req.funnel.steps[0].filterExpression.andGroup.expressions;
  assert.deepEqual(first[0].orGroup.expressions.map(x=>x.funnelEventFilter.eventName),['sign_up','sign_up_success']);
  assert.match(JSON.stringify(first),/Organic Search/);assert.match(JSON.stringify(first),/JP/);assert.match(JSON.stringify(first),/20261001/);
  assert.doesNotMatch(JSON.stringify(req.funnel.steps[1]),/Organic Search|countryId|20261001/);
  assert.equal(req.funnel.isOpenFunnel,false);assert.equal(req.funnel.steps[1].withinDurationFromPriorStep,kind==='api-first-success-d7'?'604800s':'2592000s');
 }
});

test('capability gates the new provenance payload before import, without changing coverage or sending data', async () => {
 const options={importing:true,token:'fixture-only',range:query};
 for(const response of [Response.json({capabilities:{apiCohorts:1}}),Response.json({capabilities:{registrationCompatibility:2}}),new Response('Forbidden',{status:403})]) {
  const gate=await resolveRegistrationCollectionGate({...options,fetchImpl:async(url,init)=>{assert.equal(new URL(url).origin,'https://flatkey-seo-roadmap.vercel.app');assert.equal(init.method,'GET');assert.equal(init.body,undefined);return response;}});
  assert.equal(gate.enabled,false);
 }
 assert.equal((await resolveRegistrationCollectionGate({...options,fetchImpl:async()=>Response.json({capabilities:{registrationCompatibility:1}})})).enabled,true);
 assert.deepEqual(await resolveRegistrationCollectionGate({...options,importing:false,fetchImpl:()=>{throw Error('unexpected network')}}),{enabled:true,reason:'read_only_no_import'});
});


test('overview registrations use one all-channel, day-level distinct query per country', async t => {
 process.env.SEO_GA4_ACCESS_TOKEN='fixture-only';
 let request;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  request=JSON.parse(init.body);
  return Response.json({dimensionHeaders:[{name:'date'}],metricHeaders:[{name:'totalUsers'}],
   metadata:{timeZone:'America/Los_Angeles'},rowCount:2,
   rows:[{dimensionValues:[{value:'20261001'}],metricValues:[{value:'9'}]},
    {dimensionValues:[{value:'20261003'}],metricValues:[{value:'0'}]}]});
 });
 const range={start:'2026-10-01',end:'2026-10-03'};
 const record=await fetchGa4RegistrationDays({...range,country:'JP'},now);
 assert.deepEqual(request.dimensions,[{name:'date'}]);
 assert.deepEqual(request.metrics,[{name:'totalUsers'}]);
 assert.match(JSON.stringify(request.dimensionFilter),/15056169010/);
 assert.match(JSON.stringify(request.dimensionFilter),/countryId.*JP/);
 assert.doesNotMatch(JSON.stringify(request.dimensionFilter),/sessionDefaultChannelGroup/);
 assert.deepEqual(registrationDaySeries(range,[record]),[
  {date:'2026-10-01',users:9},{date:'2026-10-02',users:null},{date:'2026-10-03',users:0},
 ]);
 const refreshed={...record, observedAt:'2026-11-12T12:00:00Z', days:[{date:'2026-10-01',users:11}]};
 assert.deepEqual(registrationDaySeries(range,[record,refreshed]).map(day=>day.users),[11,null,0]);
});
