const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const collector=fs.readFileSync(path.join(__dirname,"../scripts/server-seo-daily.cjs"),"utf8");
const {collectionReceipt}=require("../scripts/server-seo-receipt.cjs");
const shift=(day,n)=>new Date(Date.parse(day+"T00:00:00Z")+n*86400000).toISOString().slice(0,10);
const dates=range=>Array.from({length:(Date.parse(range.end)-Date.parse(range.start))/86400000+1},(_,i)=>shift(range.start,i));
const cluster={domain:"rackrate.org",ga4:"558899190",gsc:"https://rackrate.org/",ga4TimeZone:"Asia/Shanghai"};
const stamp="2026-11-11T02:30:00.000Z";
async function exercise(options={}){
 const requests=[],google=[],logs=[],snapshots=[],store=new Map(),readbacks=[],posted=[],receipts=[];
 let active=0,maximum=0,failedPost=false,failedRead=false,failedQuery=false;
 const kindFor=r=>[r.kind,r.country,r.property===cluster.ga4||r.property===cluster.gsc?cluster.domain:null].filter(Boolean).join(":");
 const key=r=>kindFor(r)+":"+r.date;
 const old={kind:"ga4-site",property:"541304395",source:"google-api",scope:"session-organic-search",date:"2025-01-01",observedAt:stamp,complete:true,sessions:99,registrations:3};
 store.set(key(old),old);
 function main(range,country){google.push({source:"GA4",site:"flatkey.ai",country:country??"all",range:{...range}});
  const quality={complete:true,reasons:[]},bad={complete:false,reasons:["unknown_hostname","sensitive-fixture-not-to-log"]};
  return {fetchedAt:stamp,quality:{siteSessions:quality,siteRegistrations:quality,pageSessions:options.qualityGap?bad:quality,pageRegistrations:{complete:false,reasons:["landing_host_attribution_unverified"]}},
   daily:dates(range).map(date=>({date,sessions:1,registrations:1})),pages:dates(range).map(date=>({date,hostname:"flatkey.ai",path:"/page",sessions:options.qualityGap?null:1,registrations:null}))};
 }
 const context=vm.createContext({
  process:{env:{SEO_IMPORT_TOKEN:"test",SEO_GOOGLE_SERVICE_ACCOUNT_JSON:"test",SEO_COLLECTION_RESULT:"ignored",...(options.window!==undefined?{SEO_COLLECTION_LOOKBACK_DAYS:options.window}:{})}},
  fs:{writeFileSync:(_file,value)=>snapshots.push(JSON.parse(value))},CLUSTER_SITES:[cluster],
  collectionStartedAt:stamp,receiptAttempted:false,
  saveCollectionReceipt:async input=>receipts.push(collectionReceipt({...input,runId:"123",attempt:"1",sha:"a".repeat(40)})),
  seoToday:()=>"2026-11-11",collectionDateRange:(days,_now,timezone)=>{const end=timezone==="Asia/Shanghai"?"2026-11-10":"2026-11-09";return {start:shift(end,1-days),end}},shiftDay:shift,
  analyticsObservationSchema:{parse:x=>x},analyticsStorageKind:(kind,country,site)=>[kind,country,site].filter(Boolean).join(":"),
  clusterDomainForProperty:p=>p===cluster.ga4||p===cluster.gsc?cluster.domain:undefined,
  fetchGa4Organic:async(range,country)=>main(range,country),
  fetchGa4SiteSessions:async(range,_property,_timezone,country)=>{google.push({source:"GA4",site:cluster.domain,country:country??"all",range:{...range}});return{fetchedAt:stamp,quality:{complete:true,reasons:[]},daily:options.clusterEmpty?[]:dates(range).map(date=>({date,sessions:1}))}},
  fetchGa4SitePages:async range=>({fetchedAt:stamp,quality:{complete:true,reasons:[]},pages:dates(range).map(date=>({date,hostname:cluster.domain,path:"/gpu",sessions:1,registrations:null}))}),
  fetchGscDateCoverage:async(start,end,o)=>{google.push({source:"GSC",site:o.property,country:o.country??"all",range:{start,end}});return options.gscDays?Object.fromEntries(dates({start,end}).slice(-options.gscDays).map(date=>[date,{clicks:1,impressions:2,position:3}])):{}},
  fetchGscDailyPages:async(date,o)=>{if(!options.gscDays)throw Error("unexpected GSC page query");return{state:"final",fetchedAt:stamp,pages:[{url:(o.property===cluster.gsc?"https://rackrate.org":"https://flatkey.ai")+"/page",clicks:1,impressions:2,position:3}]}},
  fetchGscDailyPageQueries:async(_date,o)=>{if(!options.gscDays)throw Error("unexpected GSC keyword query");if(options.failQuery&&!failedQuery){failedQuery=true;throw Object.assign(new Error("query transport failure"),{code:"unavailable"})}return{property:o.property,observedAt:stamp,complete:true,rows:[]}},
  fetch:async(address,init)=>{
   const url=new URL(address),kind=url.searchParams.get("kind"),start=url.searchParams.get("start"),end=url.searchParams.get("end");
   requests.push({method:init.method,start,end,kind});
   if(init.method==="POST"){
    const row=JSON.parse(init.body);active++;maximum=Math.max(maximum,active);posted.push(row);store.set(key(row),row);
    await new Promise(resolve=>setTimeout(resolve,1));
    if(options.failPost&&!failedPost){failedPost=true;return{ok:false,status:503,json:async()=>({})}}
    return{ok:true,json:async()=>({stored:true})};
   }
   if(kind&&start===end){
    const row=store.get(kind+":"+start);readbacks.push(kind+":"+start);
    await new Promise(resolve=>setTimeout(resolve,2));active--;
    const payload=JSON.parse(JSON.stringify(row));
    if(options.failRead&&!failedRead){failedRead=true;payload.sessions=999}
    return{ok:true,json:async()=>({rows:row?[{kind,date:row.date,observedAt:row.observedAt,complete:row.complete,payload}]:[]})};
   }
   assert.equal(active,0,"all started readbacks must settle before final coverage");
   return{ok:true,json:async()=>({rows:[...store].filter(([,r])=>r.date>=start&&r.date<=end).map(([k,r])=>({kind:k.slice(0,-11),date:r.date,observedAt:r.observedAt,complete:r.complete,hostnameDimension:r.hostnameDimension}))})};
  },
  URL,URLSearchParams,AbortSignal,console:{log:x=>logs.push(JSON.parse(x)),error:x=>logs.push(JSON.parse(x))},
 });
 let error;
 const source=collector.slice(collector.indexOf("const endpoint ="));
 vm.runInContext(source.slice(0,source.lastIndexOf("run().catch"))+"globalThis.done=run();",context);
 try{await context.done}catch(e){error=e}
 return{requests,google,logs,snapshots,store,posted,readbacks,maximum,active,error,exitCode:context.process.exitCode,old,receipts};
}
test("default fourteen ended days respect each property timezone and preserve historical rows",async()=>{
 const r=await exercise();assert.equal(r.error,undefined);assert.equal(r.exitCode,undefined);assert.equal(r.snapshots[0].lookbackDays,14);
 assert.equal(r.receipts.length,1);assert.equal(r.receipts[0].record.status,"partial");assert.match(r.receipts[0].record.failureReason,/指标覆盖限制/);
 const main=r.google.find(x=>x.source==="GA4"&&x.site==="flatkey.ai"),rack=r.google.find(x=>x.source==="GA4"&&x.site===cluster.domain);
 assert.deepEqual(main.range,{start:"2026-10-27",end:"2026-11-09"});assert.deepEqual(rack.range,{start:"2026-10-28",end:"2026-11-10"});
 assert.ok(r.posted.every(x=>x.date>=main.range.start&&x.date<"2026-11-11"));assert.equal(r.store.get("ga4-site:2025-01-01"),r.old);
 const scopes=r.google.filter(x=>x.source==="GA4").map(x=>[x.site,x.country]);assert.deepEqual(scopes.slice(0,3),[["flatkey.ai","all"],[cluster.domain,"all"],["flatkey.ai","US"]]);
 const mainGlobal=r.posted.filter(x=>x.property==="541304395"&&!x.country&&x.kind==="ga4-site");assert.deepEqual(mainGlobal.slice(0,3).map(x=>x.date),["2026-11-09","2026-11-08","2026-11-07"]);
 assert.equal(r.maximum,3);assert.equal(r.active,0);assert.equal(r.readbacks.length,r.posted.length);
 assert.ok(r.posted.filter(x=>x.kind==="ga4-pages").every(x=>x.complete===false&&x.rows[0].registrations===null));
});
test("manual ninety-day backfill is bounded to exactly ninety ended days per timezone",async()=>{
 const r=await exercise({window:"90"});assert.equal(r.error,undefined);assert.equal(r.snapshots[0].lookbackDays,90);
 for(const scope of r.google.filter(x=>x.source==="GA4"))assert.equal(dates(scope.range).length,90);
 assert.equal(r.posted.filter(x=>x.property==="541304395"&&!x.country&&x.kind==="ga4-pages").length,90);
 assert.equal(r.posted.filter(x=>x.property===cluster.ga4&&!x.country&&x.kind==="ga4-pages").length,90);
 assert.ok(r.store.has("ga4-site:2025-01-01"));assert.equal(r.active,0);
});
test("invalid windows fail before any provider or production request",async()=>{
 for(const window of ["","0","13","15","91","14.0","14x"," 14","-14"]){
 const r=await exercise({window});assert.equal(r.error?.message,"invalid_lookback_days");assert.equal(r.requests.length,0);assert.equal(r.google.length,0);
 }
});
test("failed POST is read once without reposting and other in-flight readbacks finish before next scope",async()=>{
 const r=await exercise({failPost:true});assert.equal(r.error,undefined);assert.equal(r.exitCode,1);assert.equal(r.active,0);assert.ok(r.maximum<=3);
 assert.equal(r.readbacks.length,r.posted.length);assert.equal(new Set(r.posted.map(x=>[x.kind,x.country,x.property,x.date].join(":"))).size,r.posted.length);
 assert.ok(r.logs.some(x=>x.site==="flatkey.ai"&&x.country==="all"&&x.source==="GA4"&&x.status==="failed"&&x.reason==="production_503"));
 assert.ok(r.logs.some(x=>x.site===cluster.domain&&x.source==="GA4"&&x.status==="checked"));assert.equal(r.snapshots.length,1);
});
test("a mismatched readback fails the scope without abandoning other started readbacks",async()=>{
 const r=await exercise({failRead:true});assert.equal(r.exitCode,1);assert.equal(r.active,0);assert.equal(r.readbacks.length,r.posted.length);
 assert.ok(r.logs.some(x=>x.reason==="production_values_differ"));assert.ok(r.logs.some(x=>x.site===cluster.domain&&x.status==="checked"));
});
test("quality diagnostics use only safe reasons and do not turn unverified sessions or sparse source gaps into zero",async()=>{
 const r=await exercise({qualityGap:true,clusterEmpty:true});const logged=JSON.stringify(r.logs);
 assert.match(logged,/unknown_hostname/);assert.match(logged,/unrecognized_quality_reason/);assert.doesNotMatch(logged,/sensitive-fixture-not-to-log/);
 const pages=r.posted.filter(x=>x.kind==="ga4-pages");assert.ok(pages.length);assert.ok(pages.every(x=>x.complete===false&&x.sessionsComplete===false&&x.rows[0].sessions===null));
 assert.equal(r.posted.filter(x=>x.property===cluster.ga4).length,0);assert.ok(r.logs.some(x=>x.site===cluster.domain&&x.status==="no_source_data"));
});
test("nonempty GSC dates retain complete page and query readbacks under the concurrency bound",async()=>{
 const r=await exercise({gscDays:3});assert.equal(r.error,undefined);assert.equal(r.exitCode,undefined);assert.equal(r.active,0);assert.ok(r.maximum<=3);
 const main=r.posted.filter(x=>x.property==="sc-domain:flatkey.ai"&&!x.country);
 for(const kind of ["gsc-site","gsc-pages","gsc-page-queries"])assert.deepEqual(main.filter(x=>x.kind===kind).map(x=>x.date),["2026-11-09","2026-11-08","2026-11-07"]);
 assert.equal(r.readbacks.length,r.posted.length);assert.equal(r.snapshots[0].missing,0);
});
test("a GSC query failure drains all started site/page/query readbacks and continues independent scopes",async()=>{
 const r=await exercise({gscDays:6,failQuery:true});assert.equal(r.error,undefined);assert.equal(r.exitCode,1);assert.equal(r.active,0);assert.ok(r.maximum<=3);
 assert.equal(r.readbacks.length,r.posted.length);assert.ok(r.logs.some(x=>x.site==="flatkey.ai"&&x.country==="all"&&x.source==="GSC"&&x.status==="failed"));
 assert.ok(r.logs.some(x=>x.site===cluster.domain&&x.source==="GSC"&&x.status==="checked"));
 assert.ok(r.posted.some(x=>x.kind==="gsc-pages"&&x.property==="sc-domain:flatkey.ai"&&!x.country));
 assert.ok(r.posted.some(x=>x.kind==="gsc-page-queries"&&x.property==="sc-domain:flatkey.ai"&&!x.country));
});

