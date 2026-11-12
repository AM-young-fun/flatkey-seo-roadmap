#!/usr/bin/env node
// Local, read-only preview from archived source data. No delivery or platform writes.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {buildSeoDigest,digestWindow,digestOptimizationEffect}=require('../src/lib/seo-digest.ts');
const {analyticsObservationSchema,scopedAnalytics}=require('../src/lib/seo-analytics.ts');
const {githubChannelSchema}=require('../src/lib/seo-github-channel.ts');
const {clusterDomainForProperty,CLUSTER_SITES}=require('../src/lib/seo-cluster-sites.ts');
async function run(){
 const args=Object.fromEntries(process.argv.slice(2).map(arg=>arg.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));const kind=args.kind??'daily';const window=digestWindow(args.date,kind),now=new Date();
 if(!args['analytics-dir']||!args.workflow||!args.out)throw Error('source_paths_required');
 const workflow=JSON.parse(fs.readFileSync(args.workflow,'utf8'));if(!Array.isArray(workflow.tasks)||!Array.isArray(workflow.approvals)||!workflow.generatedAt)throw Error('workflow_snapshot_required');
 const observations=[],pageObservations=[];let excluded=0;
 for(const name of fs.readdirSync(args['analytics-dir'])){if(!name.endsWith('.json'))continue;const parsed=analyticsObservationSchema.safeParse(JSON.parse(fs.readFileSync(path.join(args['analytics-dir'],name),'utf8')));if(!parsed.success){excluded++;continue;}const row=scopedAnalytics([parsed.data])[0];if(!row)continue;if(row.date>window.trafficEnd||Date.parse(row.observedAt)>now.getTime())continue;
  const site=clusterDomainForProperty(row.property)??'flatkey.ai';
  if(row.kind==='ga4-pages'||row.kind==='gsc-pages')pageObservations.push(row);
  if(row.kind==='ga4-site')observations.push({site,country:row.country,date:row.date,source:'GA4',timezone:CLUSTER_SITES.find(s=>s.domain===site)?.ga4TimeZone??'America/Los_Angeles',observedAt:row.observedAt,complete:row.sessions!==null,scope:'session-organic-search',sessions:row.sessions,registrations:row.complete?row.registrations:null});
  if(row.kind==='gsc-site')observations.push({site,country:row.country,date:row.date,source:'GSC',timezone:'America/Los_Angeles',observedAt:row.observedAt,complete:row.complete,scope:'google-web',clicks:row.clicks,impressions:row.impressions});
 }
 const githubObservations=[];
 if(args['github-dir'])for(const name of fs.readdirSync(args['github-dir'])){if(!name.endsWith('.json'))continue;const parsed=githubChannelSchema.safeParse(JSON.parse(fs.readFileSync(path.join(args['github-dir'],name),'utf8')));if(parsed.success&&Date.parse(parsed.data.observedAt)<=now.getTime())githubObservations.push(parsed.data);}
 const verified=workflow.publications.filter(row=>row.status==='verified'&&row.verifiedAt&&row.verificationRecordedAt);
 const input={date:args.date,kind,now,observations,pageObservations,githubObservations,businessObservations:[],publications:verified.filter(row=>row.kind!=='optimization').map(row=>({id:row.id,url:row.pageUrl,title:row.title,kind:row.kind==='source_blog'?'source':row.kind,verifiedAt:row.verifiedAt,recordedAt:row.verificationRecordedAt,publishedAt:row.publishedAt})),optimizations:[],
  effects:workflow.optimizations.flatMap(row=>row.observations.filter(observation=>Date.parse(observation.checkedAt)>=Date.parse(window.workStart)&&Date.parse(observation.checkedAt)<Math.min(now.getTime(),Date.parse(window.workEnd))).map(observation=>digestOptimizationEffect(row,observation))),priorities:[],
  issues:['只读归档预览，未发送。执行台账截至 '+workflow.generatedAt+'；当前运行、业务漏斗及下周计划未重新采集，保留待更新。GitHub渠道只采用传入归档，未接入的来源显示待更新。',...workflow.issues.filter(row=>row.status!=='resolved').map(row=>row.id==='amplitude-organic-cohorts-pending'?'flatkey.ai · 历史 Amplitude 待办已被统一 GA4 方案替代，不再执行；生产待办状态尚待同步。':row.siteDomain+' · '+row.title+' · '+row.nextAction)],runNotes:['当前执行回执未接入本地预览；不能把采集配置等同执行成功。'],reviewWorkflow:workflow,publicationCoverage:'missing',optimizationCoverage:'missing',rankingNotes:['本地预览未读最新 DataForSEO 批次。']};
 const report=buildSeoDigest(input);fs.mkdirSync(args.out,{recursive:true});const prefix=path.join(args.out,args.date+'.'+kind);fs.writeFileSync(prefix+'.md',report.text);fs.writeFileSync(prefix+'.json',JSON.stringify({mode:'read_only_archived_preview_not_sent',source:{analyticsDirectory:path.resolve(args['analytics-dir']),workflow:path.resolve(args.workflow),workflowObservedAt:workflow.generatedAt,githubDirectory:args['github-dir']?path.resolve(args['github-dir']):null},excluded,report},null,2));console.log(JSON.stringify({preview:prefix+'.md',kind,preliminary:report.preliminary,generatedAt:report.generatedAt,sourceDate:workflow.generatedAt}));
}
if(require.main===module)run().catch(error=>{console.error(JSON.stringify({error:error.message}));process.exitCode=1;});
