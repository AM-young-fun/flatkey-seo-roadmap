"use strict";
const fs=require("node:fs/promises"),path=require("node:path"),crypto=require("node:crypto");
const scalars=require("./seo-report-ga4-scalars.cjs");
const canonical=scalars.canonical,hash=scalars.hash;
const sha=text=>crypto.createHash("sha256").update(text).digest("hex");
const shift=(day,n)=>new Date(Date.parse(day+"T00:00:00Z")+n*86400000).toISOString().slice(0,10);
const number=value=>Number.isSafeInteger(value)&&value>=0;
const modules=["home","blog","models","gpu","prompts"],shareKeys=["all","modelDetail","prompts"];

/** Raw source bytes, exact requests and metadata are rechecked offline. A
 * summary's complete flag or scalar values are never their own evidence. */
async function readDailyScalarEvidence(filename,definitions,sourceDay,now=new Date()){
 const summaryBytes=await fs.readFile(filename,"utf8"),summary=JSON.parse(summaryBytes),directory=path.dirname(filename),sources=[];
 const declared=Array.isArray(summary.records)?summary.records.map(row=>({file:row.sourceFile,expected:row.sourceSha256})):Array.isArray(summary.sourceFiles)?summary.sourceFiles.map(file=>({file,expected:summary.sourceHashes?.[file]})):[];
 for(const item of declared){
  if(typeof item.file!=="string"||!/^[a-f0-9]{64}$/.test(item.expected??""))continue;
  const candidates=[path.resolve(directory,item.file),path.join(directory,path.basename(item.file))];
  for(const file of [...new Set(candidates)])try{
   const bytes=await fs.readFile(file,"utf8");if(sha(bytes)!==item.expected)continue;
   const raw=JSON.parse(bytes),record={...raw,propertyId:raw.propertyId??summary.propertyId};
   sources.push({file,sha256:item.expected,record});break;
  }catch{/* Missing or altered files remain missing; no source request occurs. */}
 }
 const jobs=scalars.jobsFor(sourceDay,definitions,now),records=jobs.map(job=>{
  const matches=sources.map(source=>({source,checked:scalars.validate(job,source.record,now)})).filter(row=>row.checked.value!==null).sort((a,b)=>b.checked.observedAt.localeCompare(a.checked.observedAt));
  const best=matches[0];return{kind:job.kind,key:job.key,side:job.side,date:job.date,queryHash:job.queryHash,value:best?.checked.value??null,observedAt:best?.checked.observedAt??null,reasons:best?[]:["verified_source_missing_or_quality_limited"],sourceFile:best?.source.file??null,sourceSha256:best?.source.sha256??null};
 });
 const observedAt=records.map(row=>row.observedAt).filter(Boolean).sort().at(-1)??null;
 const users=side=>Object.fromEntries(shareKeys.map(key=>[key,records.find(row=>row.kind==="share"&&row.key===key&&row.side===side).value]));
 const moduleShares={current:users("current"),previous:users("previous"),observedAt};
 const moduleSessions=modules.map(id=>({id,sessions:Object.fromEntries(["previous","current"].map(side=>[side,records.find(row=>row.kind==="module"&&row.key===id&&row.side===side).value]))}));
 return{version:1,sourceDay,previousDay:shift(sourceDay,-1),propertyId:scalars.PROPERTY,timezone:scalars.TIMEZONE,moduleShares,moduleSessions,records,complete:records.every(row=>row.value!==null),missing:records.filter(row=>row.value===null),sourceEvidenceSha256:hash(records),summaryFile:path.resolve(filename),summarySha256:sha(summaryBytes)};
}

function assembleDailyDashboardPackage({baseReport,analyticsRows,scalarEvidence,siteDefinitions,parseAnalytics,now=new Date()}){
 const base=structuredClone(baseReport),period=base.reportPeriod;
 if(base.kind!=="daily"||!/^seo-digest:\d{4}-\d{2}-\d{2}:[a-f0-9]{16}$/.test(base.id??"")||base.hash!==sha(base.text??"")||base.reviewedBody||base.draftBody||period?.timezone!=="America/Los_Angeles"||period.start!==period.end)throw Error("exact_daily_base_required");
 const sourceDay=period.start,previousDay=shift(sourceDay,-1),gaps=[],retained=[],nativeReference=[],facts=[];
 if(scalarEvidence.sourceDay!==sourceDay||scalarEvidence.previousDay!==previousDay||scalarEvidence.propertyId!==scalars.PROPERTY||scalarEvidence.timezone!==scalars.TIMEZONE)throw Error("scalar_source_window_mismatch");
 const definitions=[...siteDefinitions];if(new Set(definitions.map(row=>row.domain)).size!==definitions.length)throw Error("duplicate_site_definition");
 const parsed=[];
 for(const raw of analyticsRows??[]){
  const payload=raw.payload??raw;let row;try{row=parseAnalytics(payload);}catch{row=null;}
  if(!row||![sourceDay,previousDay].includes(row.date)||Date.parse(row.observedAt)>now.getTime())continue;
  const site=definitions.find(site=>row.property===site.ga4||row.property===site.gsc);if(!site)continue;
  if(row.kind==="ga4-site"&&site.domain==="flatkey.ai"&&row.hostScope!=="production-hosts-v1"){gaps.push({site:site.domain,source:"GA4",date:row.date,reason:"production_host_scope_unverified"});continue;}
  parsed.push({...row,site:site.domain,timezone:row.kind==="gsc-site"?"America/Los_Angeles":site.ga4TimeZone??null});
 }
 const oldValue=(group,name,label,side)=>base.dashboard?.traffic?.[group]?.find(row=>row.name===name)?.metrics.find(row=>row.label===label)?.[side];
 function metric(site,kind,key,day,country="all",side){
  const definition=definitions.find(row=>row.domain===site),label={sessions:"自然会话",clicks:"Google 点击",impressions:"曝光"}[key];
  const rows=parsed.filter(row=>row.site===site&&row.kind===kind&&(row.country??"all")===country&&row.date===day).sort((a,b)=>b.observedAt.localeCompare(a.observedAt)),row=rows[0];
  if(kind==="ga4-site"&&definition?.ga4TimeZone!=="America/Los_Angeles"){
   if(row&&number(row[key]))nativeReference.push({site,country,date:day,timezone:row.timezone,metric:key,value:row[key],observedAt:row.observedAt});
   gaps.push({site,country,date:day,metric:key,reason:"native_day_is_not_LA_day"});return null;
  }
  // A GA4 site row may have verified sessions while its independent registration
  // field is missing. GSC partial/unpublished rows cannot prove a final zero.
  const usable=row&&number(row[key])&&(kind==="ga4-site"||row.complete===true);
  if(usable){facts.push({site,country,date:day,metric:key,value:row[key],observedAt:row.observedAt,sourceSha256:hash(row)});return row[key];}
  const previous=oldValue(country==="all"?"sites":"countries",country==="all"?site:country,label,side);
  if(base.dailyDashboardBody&&number(previous)){retained.push({site,country,date:day,metric:key,value:previous,fromReportId:base.id,sourceEvidenceSha256:base.dashboard.sourceEvidenceSha256});return previous;}
  gaps.push({site,country,date:day,metric:key,reason:row?"partial_or_unknown_source":"source_missing"});return null;
 }
 function traffic(site,country){return Object.fromEntries([["sessions","ga4-site"],["clicks","gsc-site"],["impressions","gsc-site"]].map(([key,kind])=>[key,Object.fromEntries([["previous",previousDay],["current",sourceDay]].map(([side,day])=>[side,metric(site,kind,key,day,country,side)]))]));}
 const sites=definitions.map(site=>({name:site.domain,...traffic(site.domain)})),countries=["US","JP","BR","ES"].map(name=>({name,...traffic("flatkey.ai",name)}));
 const oldShares=base.dashboard?.moduleShares,moduleShares=structuredClone(scalarEvidence.moduleShares);
 for(const side of ["previous","current"])for(const key of shareKeys)if(moduleShares[side][key]===null&&base.dailyDashboardBody&&number(oldShares?.[side]?.[key])){moduleShares[side][key]=oldShares[side][key];retained.push({side,key,metric:"totalUsers",value:oldShares[side][key],fromReportId:base.id,observedAt:oldShares.observedAt});}
 moduleShares.observedAt=[moduleShares.observedAt,retained.some(row=>row.metric==="totalUsers")?oldShares?.observedAt:null].filter(Boolean).sort().at(-1)??null;
 if(!moduleShares.observedAt)throw Error("no_actual_scalar_source_time_keep_existing_report");
 const gsc=base.pagePerformance?.find(row=>row.source==="GSC")?.flatkey;
 const moduleValues=modules.map(id=>{
  const input=scalarEvidence.moduleSessions.find(row=>row.id===id),old=base.dashboard?.traffic?.modules?.find(row=>row.id===id),search=gsc?.modules?.find(row=>row.id===id);
  const sessions=structuredClone(input?.sessions??{previous:null,current:null});
  for(const side of ["previous","current"])if(sessions[side]===null&&base.dailyDashboardBody&&number(old?.sessions?.[side])){sessions[side]=old.sessions[side];retained.push({side,id,metric:"sessions",value:old.sessions[side],fromReportId:base.id});}
  const searchPair=key=>Object.fromEntries([["previous",previousDay],["current",sourceDay]].map(([side,day])=>{
   const date=side==="previous"?gsc?.previousDate:gsc?.date,value=key==="clicks"?search?.[side]:search?.impressions?.[side];
   return[side,date===day&&number(value)?value:base.dailyDashboardBody&&number(old?.[key]?.[side])?old[key][side]:null];
  }));
  return{id,sessions,clicks:searchPair("clicks"),impressions:searchPair("impressions")};
 });
 const observedAt=[moduleShares.observedAt,...facts.map(row=>row.observedAt)].sort().at(-1);
 const dashboardEvidence={scope:"website-console",timezone:"America/Los_Angeles",observedAt,gscComparable:sites.some(row=>row.clicks.previous!==null&&row.clicks.current!==null),sites,countries,modules:moduleValues,moduleShares};
 const currentTemplate=Number.isInteger(base.reportTemplateVersion)&&base.reportTemplateVersion>=9;
 const revisedFields=currentTemplate?["text","detailText","hash"]:[];
 const preservedFields=["text","detailText","hash","title","reportPeriod","workWindow","executionWindow","businessDate","sourceDay","workPlan","currentWorkPlan","pageGroups","rankingNotes","growthSnapshot","conversionSnapshot","reportTemplateVersion"].filter(field=>!revisedFields.includes(field)).map(field=>({field,sha256:hash(base[field]??null)}));
 for(const field of ["detailText","attributionText","technicalText"].filter(field=>!currentTemplate||field!=="detailText"))preservedFields.push({field:"dashboard."+field,sha256:hash(base.dashboard?.[field]??null)});
 const bodyRevision=currentTemplate?{allowed:"whole-period-module-share-lines-only",sourceReportId:base.id,beforeTextSha256:sha(base.text),beforeDetailTextSha256:sha(base.detailText??base.text),beforeModuleShares:base.moduleShareSnapshot?.values??null,afterModuleShares:moduleShares}:null;
 const provenance={version:1,baseReportId:base.id,baseReportHash:base.hash,businessDate:base.businessDate??null,sourceDay,previousSourceDay:previousDay,executionWindow:base.executionWindow??null,legacyExecutionDate:!base.businessDate,scalarSource:scalarEvidence.sourceEvidenceSha256,scalarRecords:scalarEvidence.records,facts,retained,nativeReference,gaps,preservedFields,...(bodyRevision?{bodyRevision}:{}),dashboardEvidence,complete:gaps.length===0&&scalarEvidence.complete,googleRequests:0,paidRequests:0,notifications:0};
 const command={action:"save_daily_dashboard",kind:"daily",date:base.date,baseReportId:base.id,baseReportHash:base.hash,sourceEvidenceSha256:hash(provenance),moduleShares,dashboardEvidence};
 return{version:1,mode:"offline_prepared_not_saved",baseReport:base,command,provenance,sourceEvidenceSha256:command.sourceEvidenceSha256,complete:provenance.complete,missing:[...gaps,...scalarEvidence.missing],preservedFields};
}

/** No implicit prepare, retries, approval or delivery. The transport is injected
 * by the authorized original entry point; offline tests inject an in-memory API. */
async function saveDailyDashboardPackage(pkg,{api,build,compare,now=new Date()}){
 if(pkg.command.action!=="save_daily_dashboard"||pkg.command.sourceEvidenceSha256!==hash(pkg.provenance)||pkg.sourceEvidenceSha256!==pkg.command.sourceEvidenceSha256||canonical(pkg.command.dashboardEvidence)!==canonical(pkg.provenance.dashboardEvidence)||canonical(pkg.command.moduleShares)!==canonical(pkg.provenance.dashboardEvidence.moduleShares))throw Error("dashboard_package_provenance_mismatch");
 const initial=await api({action:"read_saved",reportId:pkg.command.baseReportId});
 if(canonical(initial.report)!==canonical(pkg.baseReport))throw Error("immutable_base_readback_mismatch");
 const expected=build(initial.report,pkg.command,now);let saveError=null;
 try{const result=await api(pkg.command);if(result.report?.id!==expected.id)throw Error("save_response_identity_mismatch");}catch(error){saveError=error;}
 const readback=await api({action:"read_saved",reportId:expected.id});
 if(!compare(readback.report,expected)||readback.report.reviewedBody||readback.report.draftBody)throw Error("daily_dashboard_exact_readback_failed");
 return{report:readback.report,receipt:{reportId:expected.id,baseReportId:initial.report.id,sourceEvidenceSha256:pkg.sourceEvidenceSha256,readbackExact:true,saveResponseAmbiguous:Boolean(saveError),saved:true,approved:false,notifications:0,paidRequests:0}};
}
module.exports={canonical,hash,readDailyScalarEvidence,assembleDailyDashboardPackage,saveDailyDashboardPackage};
