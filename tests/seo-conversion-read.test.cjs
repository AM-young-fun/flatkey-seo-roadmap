const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const original=Module._load;let session=false,savedRead=false,configured=true,failure=false,calls=0,lastQuery,rows=[];
Module._load=function(name,parent,...args){
  if(name==='@/lib/seo-analytics-access')return{authorizeAnalyticsRead:async()=>session};
  if(name==='@/lib/services/ranking-coverage-access')return{authorizeSavedRankingCoverage:async request=>savedRead&&!request.headers.has('origin')};
  if(name==='@/lib/env')return{isDatabaseConfigured:()=>configured};
  if(name==='@/lib/prisma')return{prisma:{seoReportVersion:{findMany:async q=>{calls++;lastQuery=q;if(failure)throw Error('injected');return rows;}}}};
  if(name.startsWith('@/'))return original.call(this,path.resolve(__dirname,'../src',name.slice(2))+'.ts',parent,...args);
  return original.call(this,name,parent,...args);
};
const route=require('../src/app/api/seo/growth/conversion/route.ts');Module._load=original;
const url='https://workspace.invalid/api/seo/growth/conversion?start=2026-10-01&end=2026-10-07&country=all&site=flatkey.ai';
test('conversion is authenticated GET only, with no unapproved source write or cross-origin bearer read',async()=>{
  assert.deepEqual(Object.keys(route).sort(),['GET','dynamic','maxDuration','runtime']);
  assert.equal((await route.GET(new Request(url))).status,401);assert.equal(calls,0);
  savedRead=true;assert.equal((await route.GET(new Request(url,{headers:{origin:'https://other.invalid'}}))).status,401);assert.equal(calls,0);
});
test('saved read filters exact window/site and source payload remains private; legacy GA counts are not converted to paid cohort',async()=>{
  rows=[{id:'old-ga4',kind:'GA4_BUSINESS',createdAt:new Date('2026-10-08T12:00:00Z'),payload:{apiCohorts:{firstPaymentUsers:999},userKey:'must-not-leak'}}];
  const response=await route.GET(new Request(url)),body=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(lastQuery.where.siteDomain,'flatkey.ai');assert.equal(lastQuery.where.periodStart.toISOString(),'2026-10-01T00:00:00.000Z');
  assert.deepEqual(lastQuery.where.kind.in,['SEO_CONVERSION_EVIDENCE','GA4_BUSINESS']);
  assert.equal(body.api.firstPayment30d.rate.value,null);assert.equal(body.api.registration.firstRegistrations.value,null);
  assert.match(body.readiness.reasons.join('；'),/全历史收款/);assert.doesNotMatch(JSON.stringify(body),/must-not-leak|999/);
});
test('invalid scopes and unknown params are rejected before reads, and source outage is not reported as zero',async()=>{
  const before=calls;
  for(const query of [url+'&refresh=1',url.replace('country=all','country=XX'),url.replace('2026-10-07','2099-10-07'),url.replace('site=flatkey.ai','site=console.flatkey.ai')])assert.equal((await route.GET(new Request(query))).status,400);
  assert.equal(calls,before);failure=true;assert.equal((await route.GET(new Request(url))).status,503);failure=false;
  configured=false;const absent=await(await route.GET(new Request(url))).json();assert.equal(absent.gpu.deals.value,null);assert.equal(absent.readiness.status,'unavailable');
});
