const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {bootstrap,savePreparedDailyDashboard}=require('../scripts/seo-daily-dashboard-preview.cjs');bootstrap();
const {jobsFor}=require('../scripts/lib/seo-report-ga4-scalars.cjs');
const {hash,readDailyScalarEvidence,assembleDailyDashboardPackage,saveDailyDashboardPackage}=require('../scripts/lib/seo-daily-dashboard-package.cjs');
const {buildSeoDigest}=require('../src/lib/seo-digest.ts'),{buildDailyDashboardSeoDigest,sameDailyDashboardDigest}=require('../src/lib/seo-daily-dashboard.ts');
const {analyticsObservationSchema,scopedAnalytics}=require('../src/lib/seo-analytics.ts');
const {PILLAR_PAGE_GROUPS}=require('../src/lib/weekly-page-visitors.ts'),{DAILY_SEO_PAGE_GROUPS}=require('../src/lib/daily-seo-page-groups.ts'),{FLATKEY_ENTRY_HOSTS}=require('../src/lib/ga4-host-scope.ts'),{CLUSTER_SITES}=require('../src/lib/seo-cluster-sites.ts');
const definitions={pillars:PILLAR_PAGE_GROUPS,pageGroups:DAILY_SEO_PAGE_GROUPS,entryHosts:FLATKEY_ENTRY_HOSTS};
const siteDefinitions=[{domain:'flatkey.ai',ga4:'541304395',gsc:'sc-domain:flatkey.ai',ga4TimeZone:'America/Los_Angeles'},...CLUSTER_SITES];
const now=new Date('2026-11-24T12:00:00Z'),stamp='2026-11-24T09:00:00.000Z',day='2026-11-23';
const sha=t=>crypto.createHash('sha256').update(t).digest('hex');
const parseAnalytics=raw=>{const v={...raw};if(v.country==='all')delete v.country;const p=analyticsObservationSchema.safeParse(v);return p.success?scopedAnalytics([p.data])[0]:null;};
function base(){const r=buildSeoDigest({date:'2026-11-24',kind:'daily',now,observations:[],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:'missing',optimizationCoverage:'missing',rankingNotes:['本日未有新回执'],workPlan:{weekStart:'2026-11-23',status:'scheduled',tasks:[]}});r.dashboard={detailText:r.detailText,attributionText:'博客贡献202→222 [原文章](https://flatkey.ai/blog/original)',technicalText:'暂无问题'};r.pageGroups={source:'immutable-original'};r.growthSnapshot={source:'immutable-quarter'};return r;}
function analytics(){return [day,'2026-11-22'].flatMap((date,i)=>[
 {kind:'ga4-site',property:'541304395',scope:'session-organic-search',hostScope:'production-hosts-v1',country:'all',date,observedAt:stamp,source:'google-api',complete:false,sessions:i?145:202,registrations:null},
 {kind:'gsc-site',property:'sc-domain:flatkey.ai',date,observedAt:stamp,source:'google-api',complete:false,clicks:0,impressions:0,position:null},
 {kind:'ga4-site',property:'558978062',scope:'session-organic-search',date,observedAt:stamp,source:'google-api',complete:true,sessions:2,registrations:0},
 {kind:'ga4-site',property:'558899190',scope:'session-organic-search',date,observedAt:stamp,source:'google-api',complete:true,sessions:0,registrations:0},
]);}
const raw=(job,value)=>({propertyId:'541304395',request:job.request,status:200,observedAt:stamp,data:{metadata:{timeZone:'America/Los_Angeles'},metricHeaders:[{name:job.metric}],rowCount:1,rows:[{metricValues:[{value:String(value)}]}]}});
async function withFixture(fn){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'daily-package-'));try{const jobs=jobsFor(day,definitions,now),records=[];for(const [i,job]of jobs.entries()){const sourceFile=path.join(directory,job.queryHash+'.json'),text=JSON.stringify(raw(job,job.kind==='share'&&job.key==='all'?160:i));await fs.writeFile(sourceFile,text);records.push({sourceFile,sourceSha256:sha(text)});}const filename=path.join(directory,'scalars.json');await fs.writeFile(filename,JSON.stringify({propertyId:'541304395',records,complete:true,moduleShares:{current:{all:999999}}}));const scalarEvidence=await readDailyScalarEvidence(filename,definitions,day,now);await fn({directory,filename,jobs,records,scalarEvidence});}finally{await fs.rm(directory,{recursive:true,force:true});}}
const assemble=(scalarEvidence,b=base(),rows=analytics())=>assembleDailyDashboardPackage({baseReport:b,analyticsRows:rows,scalarEvidence,siteDefinitions,parseAnalytics,now});

test('offline assembler recomputes independent scalars from source bytes and keeps field quality/timezones separate',async()=>withFixture(async({scalarEvidence})=>{
 const pkg=assemble(scalarEvidence),r=buildDailyDashboardSeoDigest(pkg.baseReport,pkg.command,now);
 assert.equal(scalarEvidence.complete,true);assert.equal(pkg.command.moduleShares.current.all,160);assert.notEqual(pkg.command.moduleShares.current.all,999999);
 const fk=pkg.command.dashboardEvidence.sites.find(r=>r.name==='flatkey.ai');assert.deepEqual(fk.sessions,{previous:145,current:202});assert.deepEqual(fk.clicks,{previous:null,current:null});
 for(const site of ['rackrate.org','modelfit.cc','rougecue.org'])assert.equal(pkg.command.dashboardEvidence.sites.find(r=>r.name===site).sessions.current,null);
 assert.equal(pkg.provenance.nativeReference.find(r=>r.site==='modelfit.cc').value,2);assert.equal(pkg.provenance.nativeReference.find(r=>r.site==='rackrate.org').value,0);assert.equal(pkg.complete,false);
 assert.equal(r.businessDate,'2026-11-24');assert.equal(r.sourceDay,'2026-11-23');assert.match(r.executionWindow.start,/2026-11-24/);
 for(const field of ['title','workPlan','pageGroups','rankingNotes','growthSnapshot','conversionSnapshot','reportTemplateVersion','executionWindow'])assert.deepEqual(r[field],pkg.baseReport[field]);
 for(const field of ['attributionText','technicalText'])assert.equal(r.dashboard[field],pkg.baseReport.dashboard[field]);
 assert.match(r.text,/模块占比/);assert.doesNotMatch(r.text,/整段去重访客来源未齐/);assert.equal(r.hash,sha(r.text));assert.equal(r.moduleShareSnapshot.values.current.all,160);
 assert.equal(pkg.provenance.bodyRevision.allowed,'whole-period-module-share-lines-only');assert.equal(pkg.preservedFields.some(row=>row.field==='text'),false);
 assert.equal(pkg.provenance.googleRequests,0);assert.equal(pkg.provenance.paidRequests,0);assert.equal(pkg.provenance.notifications,0);
}));
test('altered bytes, wrong dimensions/metadata and thresholded sources cannot become complete zero scalars',async()=>withFixture(async({filename,records,jobs})=>{
 const mutations=[r=>{r.data.metadata.timeZone='Asia/Shanghai';},r=>{r.data.metadata.subjectToThresholding=true;},r=>{r.request.dimensionFilter.andGroup.expressions[0].filter.fieldName='firstUserPrimaryChannelGroup';},r=>{r.data.rows=[];r.data.rowCount=0;}];
 for(const [i,mutate]of mutations.entries()){const row=raw(jobs[i],0);mutate(row);const bytes=JSON.stringify(row);await fs.writeFile(records[i].sourceFile,bytes);records[i].sourceSha256=sha(bytes);}
 await fs.writeFile(records[4].sourceFile,'{}'); // manifest SHA intentionally remains original
 await fs.writeFile(filename,JSON.stringify({propertyId:'541304395',records,complete:true}));
 const evidence=await readDailyScalarEvidence(filename,definitions,day,now);assert.equal(evidence.complete,false);assert.equal(evidence.missing.length,5);assert.ok(evidence.records.slice(0,5).every(r=>r.value===null));
}));
test('a partial later revision retains proven same-day metrics and attribution without carrying native-day values into LA',async()=>withFixture(async({scalarEvidence})=>{
 const first=assemble(scalarEvidence),saved=buildDailyDashboardSeoDigest(first.baseReport,first.command,now),partial=structuredClone(scalarEvidence);
 for(const side of ['previous','current'])for(const key of ['all','modelDetail','prompts'])partial.moduleShares[side][key]=null;
 partial.moduleShares.observedAt=null;partial.complete=false;for(const m of partial.moduleSessions)m.sessions={previous:null,current:null};
 const pkg=assemble(partial,saved,[]),next=buildDailyDashboardSeoDigest(saved,pkg.command,now);
 assert.equal(pkg.command.dashboardEvidence.sites[0].sessions.current,202);assert.equal(pkg.command.moduleShares.current.all,160);assert.equal(pkg.complete,false);assert.ok(pkg.provenance.retained.length);
 assert.equal(next.dashboard.attributionText,saved.dashboard.attributionText);assert.equal(next.dashboard.technicalText,saved.dashboard.technicalText);assert.equal(pkg.command.dashboardEvidence.sites.find(r=>r.name==='modelfit.cc').sessions.current,null);
}));
test('missing actual source time cannot overwrite a good archive or turn missing evidence into zero',async()=>withFixture(async({scalarEvidence})=>{
 scalarEvidence.moduleShares.observedAt=null;assert.throws(()=>assemble(scalarEvidence),/actual_scalar_source_time/);
 scalarEvidence.sourceDay='2026-11-21';assert.throws(()=>assemble(scalarEvidence),/window_mismatch/);
}));
test('a malformed v9 structured body cannot bypass exact module source binding',async()=>withFixture(async({scalarEvidence})=>{
 const broken=base();broken.dashboard.detailText='unrelated legacy six-block body without the frozen v9 module statement';
 const pkg=assemble(scalarEvidence,broken);assert.throws(()=>buildDailyDashboardSeoDigest(pkg.baseReport,pkg.command,now),/模块正文与原来源快照不一致/);
}));
test('injected normal protocol reads immutable base, saves once, then verifies the exact created snapshot without approval',async()=>withFixture(async({scalarEvidence})=>{
 const pkg=assemble(scalarEvidence),rows=new Map([[pkg.baseReport.id,pkg.baseReport]]),calls=[];const api=async cmd=>{calls.push(cmd.action);if(cmd.action==='read_saved')return{report:rows.get(cmd.reportId)};const report=buildDailyDashboardSeoDigest(rows.get(cmd.baseReportId),cmd,now);rows.set(report.id,report);throw Error('ambiguous transport after actual save');};
 const {report,receipt}=await savePreparedDailyDashboard(pkg,{api,now});assert.deepEqual(calls,['read_saved','save_daily_dashboard','read_saved']);assert.equal(receipt.readbackExact,true);assert.equal(receipt.saveResponseAmbiguous,true);assert.equal(receipt.approved,false);assert.equal(report.reviewedBody,undefined);assert.equal(rows.size,2);
 const altered=structuredClone(pkg);altered.command.dashboardEvidence.sites[0].sessions.current++;await assert.rejects(saveDailyDashboardPackage(altered,{api,build:buildDailyDashboardSeoDigest,compare:sameDailyDashboardDigest,now}),/provenance/);assert.equal(calls.length,3);
}));
test('base conflict and corrupted save readback fail without a blind retry',async()=>withFixture(async({scalarEvidence})=>{
 const pkg=assemble(scalarEvidence);let saves=0;
 await assert.rejects(saveDailyDashboardPackage(pkg,{api:async()=>({report:{...pkg.baseReport,hash:'bad'}}),build:buildDailyDashboardSeoDigest,compare:sameDailyDashboardDigest,now}),/immutable_base/);
 const expected=buildDailyDashboardSeoDigest(pkg.baseReport,pkg.command,now),bad=structuredClone(expected);bad.dashboard.attributionText='lost';
 await assert.rejects(saveDailyDashboardPackage(pkg,{api:async cmd=>{if(cmd.action==='save_daily_dashboard'){saves++;return{report:expected};}return{report:cmd.reportId===pkg.baseReport.id?pkg.baseReport:bad};},build:buildDailyDashboardSeoDigest,compare:sameDailyDashboardDigest,now}),/exact_readback/);assert.equal(saves,1);
}));
test('default CLI stays offline, preserves provenance byte hash and rejects an apply flag',async()=>withFixture(async({directory,filename})=>{
 const baseFile=path.join(directory,'base.json'),analyticsFile=path.join(directory,'analytics.json'),out=path.join(directory,'out'),guard=path.join(directory,'guard.cjs');await fs.writeFile(baseFile,JSON.stringify(base()));await fs.writeFile(analyticsFile,JSON.stringify({rows:analytics()}));await fs.writeFile(guard,'global.fetch=()=>{throw Error("network forbidden")};Date.now=()=>Date.parse("2026-11-24T12:00:00Z");');
 const args=['--require',guard,'scripts/seo-daily-dashboard-preview.cjs','--base='+baseFile,'--analytics='+analyticsFile,'--scalars='+filename,'--out='+out,'--as-of='+now.toISOString()];
 const child=spawnSync(process.execPath,args,{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.mode,'offline_prepared_not_saved');assert.equal(result.requests,0);const pkg=JSON.parse(await fs.readFile(result.packageFile,'utf8')),provenanceFile=result.packageFile.replace('.package.json','.provenance.json');assert.equal(sha(await fs.readFile(provenanceFile,'utf8')),pkg.sourceEvidenceSha256);assert.equal(pkg.sourceEvidenceSha256,hash(pkg.provenance));
 const again=spawnSync(process.execPath,args,{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});assert.equal(again.status,0,again.stderr);
 const rejected=spawnSync(process.execPath,[...args,'--apply=true'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/offline_only/);
}));
