const test=require('node:test'),assert=require('node:assert/strict');
const {bootstrap}=require('../scripts/seo-daily-dashboard-preview.cjs');bootstrap();
const {buildSeoDigest,digestWindow,comparableMetric}=require('../src/lib/seo-digest.ts');
const {digestReportExecutionWeek,summarizeDigestWorkPlan}=require('../src/lib/seo-digest-work-plan.ts');
const {digestSnapshotId}=require('../src/lib/seo-digest-message.cjs');
const crypto=require('node:crypto');
const now=new Date('2026-11-24T12:00:00Z');
const input=(patch={})=>({date:'2026-11-24',kind:'daily',now,observations:[],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:'verified',optimizationCoverage:'verified',...patch});
const pub=(id,at)=>({id,url:'https://flatkey.ai/blog/'+id,title:id,kind:'source',publishedAt:at,verifiedAt:at,recordedAt:at});
const opt=(id,patch={})=>({id,url:'https://flatkey.ai/blog/'+id,keyword:id,changes:'补实测与内容更新',verifiedAt:'2026-11-24T02:00:00Z',recordedAt:'2026-11-24T02:01:00Z',baselineId:'baseline-'+id,...patch});
test('new daily business date counts Beijing actual-day delivery separately from its closed LA source day',()=>{
 const report=buildSeoDigest(input({publications:[pub('prior','2026-11-23T15:59:59Z'),pub('today','2026-11-23T16:00:00Z'),pub('tomorrow','2026-11-24T16:00:00Z')]}));
 assert.equal(report.counts.originals,1);assert.equal(report.businessDate,'2026-11-24');assert.equal(report.sourceDay,'2026-11-23');assert.equal(report.title,'Flatkey SEO 日报｜2026-11-24');
 assert.deepEqual(report.executionWindow,{start:'2026-11-24T00:00:00+08:00',end:'2026-11-25T00:00:00+08:00',timezone:'Asia/Shanghai'});
 assert.deepEqual(report.reportPeriod,{start:'2026-11-23',end:'2026-11-23',timezone:'America/Los_Angeles'});
 assert.equal(digestWindow('2026-11-23','daily').executionStart,'2026-11-22T00:00:00+08:00');assert.equal(digestReportExecutionWeek('2026-11-27','daily'),'2026-11-30');assert.equal(digestReportExecutionWeek('2026-11-26','daily'),'2026-11-23');
});
test('refresh and ordinary optimization are separate original-position counts; translations, duplicates and unproven producers do not inflate refresh',()=>{
 const proof={workClass:'content_refresh',primaryDelivery:true,taskId:'original-task',publicationId:'original-publication'};
 const report=buildSeoDigest(input({notificationCompact:true,optimizations:[opt('ordinary'),opt('refresh',proof),opt('duplicate',{...proof,url:'https://flatkey.ai/blog/refresh'}),opt('translated',{...proof,primaryDelivery:false}),opt('unmapped',{workClass:'content_refresh'}),opt('same',{verifiedAt:'2026-11-24T01:00:00Z'}),opt('latest',{...proof,url:'https://flatkey.ai/blog/same'})]}));
 assert.equal(report.counts.optimizedPages,1);assert.equal(report.counts.refreshedPages,2);assert.match(report.text,/内容刷新 \*\*2 个页面\*\*/);assert.match(report.detailText,/内容刷新 2 个页面/);assert.match(report.detailText,/https:\/\/flatkey.ai\/blog\/refresh/);
 const legacy=buildSeoDigest(input({date:'2026-11-23',optimizations:[]}));assert.equal(legacy.counts.refreshedPages,undefined);assert.equal(legacy.businessDate,undefined);assert.equal(legacy.sourceDay,undefined);assert.doesNotMatch(legacy.text,/内容刷新/);
});
test('work plan carries optional refresh quota and classification without retyping original optimization task',()=>{
 const task={id:'refresh',weekStart:'2026-11-23',siteDomain:'modelfit.cc',kind:'optimization',workClass:'content_refresh',title:'旧文翻新',pageUrl:'https://modelfit.cc/blog/gguf',keyword:'gguf',country:'US',language:'en',owner:'AI',dueAt:'2026-11-24T14:00:00+08:00',status:'ready',nextAction:'原任务继续'};
 const plan=summarizeDigestWorkPlan([{weekStart:'2026-11-23',tasks:[task],approvals:[],plan:{status:'scheduled',taskIds:[task.id],targets:{apiBlogs:10,gpuBlogs:15,landing:0,clusterLanding:7,optimizedPages:10,contentRefreshPages:10}}}],'2026-11-23');
 assert.equal(plan.tasks[0].kind,'optimization');assert.equal(plan.tasks[0].workClass,'content_refresh');assert.equal(plan.targets.contentRefreshPages,10);
});
test('new LA daily table rejects partial GSC and native Shanghai days rather than showing a false zero or LA count',()=>{
 const common={site:'modelfit.cc',observedAt:'2026-11-24T09:00:00Z',source:'GA4',scope:'session-organic-search',timezone:'Asia/Shanghai',complete:true};
 const result=comparableMetric([{...common,date:'2026-11-22',sessions:2},{...common,date:'2026-11-23',sessions:3}],'modelfit.cc','sessions','2026-11-24');assert.equal(result.current,null);assert.equal(result.previous,null);assert.equal(result.canCompare,false);
 const gsc=comparableMetric([{...common,site:'flatkey.ai',source:'GSC',scope:'google-web',timezone:'America/Los_Angeles',date:'2026-11-23',complete:false,clicks:0}],'flatkey.ai','clicks','2026-11-24');assert.equal(gsc.current,null);
});
test('legacy snapshot identity is byte-compatible; new business/source identity is frozen and JSONB-order stable',()=>{
 const legacy={date:'2026-11-23',text:'old',detailText:'old detail',rankingNotes:[]};const old='seo-digest:'+legacy.date+':'+crypto.createHash('sha256').update(JSON.stringify({text:legacy.text,detailText:legacy.detailText,rankingNotes:[]})).digest('hex').slice(0,16);assert.equal(digestSnapshotId(legacy),old);
 const current={...legacy,businessDate:'2026-11-24',sourceDay:'2026-11-23',executionWindow:{start:'s',end:'e',timezone:'Asia/Shanghai'}};const id=digestSnapshotId(current);assert.notEqual(id,old);assert.equal(digestSnapshotId({...current,executionWindow:{timezone:'Asia/Shanghai',end:'e',start:'s'}}),id);assert.notEqual(digestSnapshotId({...current,sourceDay:'2026-11-22'}),id);
});
