const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {buildSeoDigest}=require('../src/lib/seo-digest.ts'),{unavailableGrowthReportSnapshot}=require('../src/lib/growth-strategy.ts'),{buildDailyDashboardSeoDigest}=require('../src/lib/seo-daily-dashboard.ts');
const {registrationPeriodSchema}=require('../src/lib/seo-registration-period.ts');
const now=new Date('2026-11-24T10:00:00Z'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const input={date:'2026-11-24',kind:'daily',now,notificationCompact:false,observations:[],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:'missing',optimizationCoverage:'missing'};
const metric=(site,date,value,country)=>({site,date,source:'GA4',timezone:'America/Los_Angeles',observedAt:'2026-11-24T09:00:00Z',scope:'session-organic-search',complete:true,sessions:value,...(country?{country}:{})});
test('new daily keeps complete sites/countries/modules/work/plan sections without status tail or old unfrozen denominator and weekly causes',()=>{
 const growth=unavailableGrowthReportSnapshot({start:'2026-11-12',end:'2026-11-18'},now);
 growth.goals.cohorts=[{kind:'platform',label:'全平台正式目标',targetCount:1409,rankedCount:2}];growth.directions=[{title:'上周涨跌旧原因',recommendation:'上周长篇方向',drivers:[],taskIds:[]}];
 const base=buildSeoDigest({...input,growthSnapshot:growth,observations:[metric('flatkey.ai','2026-11-23',270),metric('flatkey.ai','2026-11-22',202),metric('flatkey.ai','2026-11-23',100,'US'),metric('flatkey.ai','2026-11-22',60,'US')]});
 assert.equal(base.reportTemplateVersion,9);assert.equal(base.detailText,base.text);
 for(const text of ['1. 全站自然搜索','各站与四国流量','模块流量','流量涨跌原因','2. 当日优化效果','3. 关键词实测排名','技术异常','4. 今日完成','本周完成进度','明日与下周安排'])assert.ok(base.text.includes(text),text);
 assert.doesNotMatch(base.text,/数据状态|全平台正式目标|1409|1600词清单|上周涨跌旧原因|上周长篇方向/);
 assert.match(base.text,/本日暂无新增实测回执；已有排名保留原采样日期/);
 assert.match(base.text,/GSC 2026-11-23尚无有效结果/);
 assert.match(base.text,/\| flatkey\.ai \| 202 → 270 \| — → — \| — → — \|/);
 for(const name of ['flatkey.ai','rackrate.org','modelfit.cc','rougecue.org','mochichatbot.com','jev-llm.com','US','JP','BR','ES','首页','博客','模型页','GPU','提示词'])assert.ok(base.text.includes(name),name);
 assert.match(base.text,/2026\/11\/24 18:00（北京时间）/);assert.match(base.text,/270/);assert.equal(growth.goals.cohorts.length,1,'input source retained');
 assert.equal(base.conversionSnapshot.api.registration.rate.value,null,'188 new users is not a qualified-visitor denominator');
});
test('canonical registration does not disappear when the independent acquisition new-user source is absent',()=>{
 const period=(date,users)=>registrationPeriodSchema.parse({version:1,siteDomain:'flatkey.ai',propertyId:'541304395',streamId:'15056169010',measurementId:'G-30RCEP2CVH',source:'google-api',timezone:'America/Los_Angeles',channelDimension:'firstUserPrimaryChannelGroup',channelName:'Organic Search',event:'sign_up_success',metric:'totalUsers',distinctOverWholePeriod:true,start:date,end:date,observedAt:'2026-11-24T09:00:00Z',users,events:users,sources:['https://analytics.google.com/']});
 const base=buildSeoDigest({...input,registrationPeriods:[period('2026-11-23',16),period('2026-11-22',15)]});
 assert.match(base.text,/首次自然搜索获客去重注册 15 → \*\*16\*\*/);assert.doesNotMatch(base.text,/去重注册[^。\n]*待更新/);
 assert.equal(base.organicRegistrations.current,16);assert.equal(base.conversionSnapshot.api.registration.rate.value,null);

});
test('source-bound daily assembly puts exact module and country numbers into text with the same hash as projection',()=>{
 const base=buildSeoDigest(input),pair=(previous,current)=>({previous,current}),t=()=>({sessions:pair(null,null),clicks:pair(null,null),impressions:pair(null,null)});
 const values={previous:{all:163,modelDetail:5,prompts:2},current:{all:223,modelDetail:3,prompts:2},observedAt:now.toISOString()};
 const evidence={scope:'website-console',timezone:'America/Los_Angeles',observedAt:now.toISOString(),gscComparable:false,sites:['flatkey.ai','rackrate.org','modelfit.cc','rougecue.org','mochichatbot.com','jev-llm.com'].map(name=>({name,...t(),sessions:name==='flatkey.ai'?pair(202,270):pair(null,null)})),countries:['US','JP','BR','ES'].map(name=>({name,...t(),sessions:name==='US'?pair(60,100):pair(null,null)})),modules:['home','blog','models','gpu','prompts'].map(id=>({id,...t(),sessions:id==='blog'?pair(111,169):pair(null,null)})),moduleShares:values};
 const next=buildDailyDashboardSeoDigest(base,{action:'save_daily_dashboard',kind:'daily',date:base.date,baseReportId:base.id,baseReportHash:base.hash,sourceEvidenceSha256:hash('actual raw sources'),moduleShares:values,dashboardEvidence:evidence},now);
 assert.match(next.text,/\| flatkey.ai \| 202 → 270 \|/);assert.match(next.text,/\| US \| 60 → 100 \|/);assert.match(next.text,/\| 博客 \| 111 → 169 \|/);assert.match(next.text,/博客 111 → 169（\+58）/);
 assert.match(next.text,/模型详情 3\.1% → 1\.3%/);assert.equal(next.hash,hash(next.text));assert.doesNotMatch(next.text,/数据状态|1409/);
 assert.equal(next.dashboard.traffic.modules.find(row=>row.id==='blog').sessions.current,169);assert.equal(base.moduleShareSnapshot,undefined);
});

test('daily attribution uses full matching raw pages: separate positive/negative Top3 and old verified titles never imply a new action',()=>{
 const rows=(side)=>[...Array.from({length:12},(_,i)=>({hostname:'flatkey.ai',path:'/blog/gain-'+i,sessions:side==='current'?30+i:1,registrations:null})),{hostname:'flatkey.ai',path:'/blog/loss',sessions:side==='current'?1:8,registrations:null},{hostname:'flatkey.ai',path:'/blog/zero',sessions:side==='current'?0:5,registrations:null}];
 const page=(date,side)=>({kind:'ga4-pages',property:'541304395',scope:'session-organic-search',hostScope:'production-hosts-v1',date,observedAt:'2026-11-24T09:00:00Z',source:'google-api',complete:false,sessionsComplete:true,hostnameDimension:'hostName',rows:rows(side)});
 const publications=[{id:'old-publication',url:'https://flatkey.ai/blog/loss',title:'真实旧文章标题',kind:'source',publishedAt:'2026-11-20T12:00:00Z',verifiedAt:'2026-11-20T13:00:00Z',recordedAt:'2026-11-20T13:00:00Z'}];
 const report=buildSeoDigest({...input,pageObservations:[page('2026-11-23','current'),page('2026-11-22','previous')],publications});
 const attribution=report.text.split('**流量涨跌原因**')[1].split('**2. 当日优化效果**')[0];
 assert.equal((attribution.match(/• 上涨/g)||[]).length,3);assert.equal((attribution.match(/• 下跌/g)||[]).length,2,'only two real decline rows, never pad');
 assert.match(attribution,/下跌 \[真实旧文章标题\]\(https:\/\/flatkey.ai\/blog\/loss\)：GA4自然会话 8 → \*\*1\*\*[^\n]+自然变化/);
 assert.match(attribution,/blog\/zero[^\n]+5 → \*\*0\*\*/);assert.doesNotMatch(attribution,/内容发布|上线2026-11-20/,'a historical title is only a label');
 assert.match(attribution,/gain-11/);assert.doesNotMatch(attribution,/gain-0\)/,'positive list is limited independently');
 const partial=page('2026-11-23','current');partial.observedAt='2026-11-24T09:30:00Z';partial.sessionsComplete=false;partial.rows[0].sessions=null;
 const unknown=buildSeoDigest({...input,pageObservations:[page('2026-11-23','current'),page('2026-11-22','previous'),partial]});
 assert.doesNotMatch(unknown.text,/• 上涨|• 下跌/,'a newer partial source cannot hide behind an older complete revision');
});
