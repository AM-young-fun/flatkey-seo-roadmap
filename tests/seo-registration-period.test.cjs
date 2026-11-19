const assert = require('node:assert/strict'), {test} = require('node:test'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root=path.resolve(__dirname,'..'), resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {registrationPeriodSchema,registrationPeriodComparison}=require('../src/lib/seo-registration-period.ts');
const {registrationCorrection}=require('../src/lib/seo-registration-correction.ts');
const fixture=(extra={})=>({version:1,siteDomain:'flatkey.ai',propertyId:'541304395',streamId:'15056169010',measurementId:'G-30RCEP2CVH',source:'google-api',timezone:'America/Los_Angeles',channelDimension:'firstUserPrimaryChannelGroup',channelName:'Organic Search',event:'sign_up_success',metric:'totalUsers',distinctOverWholePeriod:true,start:'2026-11-06',end:'2026-11-12',observedAt:'2026-11-18T08:00:00Z',users:12,events:15,sources:['https://analytics.google.com/analytics/web/'],...extra});
test('canonical registration evidence rejects event counts, other attribution, streams, ongoing days and invalid counts',()=>{
 assert.equal(registrationPeriodSchema.safeParse(fixture()).success,true);
 for(const extra of [{metric:'eventCount'},{channelDimension:'sessionDefaultChannelGroup'},{event:'sign_up'},{measurementId:'other'},{users:16},{end:'2026-11-18'},{distinctOverWholePeriod:false}])assert.equal(registrationPeriodSchema.safeParse(fixture(extra)).success,false);
});
test('weekly users require an exact independently deduplicated period; zero is retained and newer source revisions win',()=>{
 const daily=fixture({start:'2026-11-12',users:3});
 assert.deepEqual(registrationPeriodComparison([daily],'2026-11-06','2026-11-12','2026-10-30','2026-11-05'),{current:null,previous:null});
 assert.deepEqual(registrationPeriodComparison([fixture(),fixture({users:0,observedAt:'2026-11-18T09:00:00Z'})],'2026-11-06','2026-11-12','2026-10-30','2026-11-05'),{current:0,previous:null});
});
test('archive correction is explicitly dated and does not mutate sent snapshot or its other metrics',()=>{
 const original={id:'sent',date:'2026-11-13',kind:'weekly',text:'GA4 自然搜索去重注册 待更新',detailText:'other content',hash:'sent-hash',organicRegistrations:{current:null,previous:null},weeklyTraffic:[{label:'自然搜索去重注册用户',current:'待更新',previous:'待更新',dates:'original',change:'—'},{label:'自然搜索会话',current:'1038'}]};
 const copy=JSON.stringify(original),result=registrationCorrection(original,[fixture()]);
 assert.equal(JSON.stringify(original),copy);assert.equal(result.organicRegistrations.current,12);assert.equal(result.weeklyTraffic[1].current,'1038');
 assert.match(result.text,/首次自然搜索获客去重注册 待更新 → 12 人/);assert.match(result.detailText,/补采.*2026-11-18T08:00:00Z/);assert.equal(result.registrationCorrection.originalReportId,'sent');
});

test('partial weeks compare an independently deduplicated matching previous interval',()=>{
 const current=fixture({start:'2026-11-06',end:'2026-11-10',users:8});
 const fullPrevious=fixture({start:'2026-10-30',end:'2026-11-05',users:90,events:90});
 const matchedPrevious=fixture({start:'2026-10-30',end:'2026-11-03',users:5});
 assert.deepEqual(registrationPeriodComparison([current,fullPrevious],'2026-11-06','2026-11-12','2026-10-30','2026-11-05'),{current:8,previous:null});
 assert.deepEqual(registrationPeriodComparison([current,fullPrevious,matchedPrevious],'2026-11-06','2026-11-12','2026-10-30','2026-11-05'),{current:8,previous:5});
});

test('latest closed LA day is accepted without artificial 48h holdback; ongoing day stays rejected',()=>{
 assert.equal(registrationPeriodSchema.safeParse(fixture({start:'2026-11-17',end:'2026-11-18',observedAt:'2026-11-19T09:30:00Z'})).success,true);
 assert.equal(registrationPeriodSchema.safeParse(fixture({start:'2026-11-18',end:'2026-11-19',observedAt:'2026-11-19T09:30:00Z'})).success,false);
});
