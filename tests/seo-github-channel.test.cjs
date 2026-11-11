const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),load=Module._load,resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest);};
let githubStoreQuery;
Module._load=function(name,...rest){if(name==='@/lib/prisma')return {prisma:{seoReportVersion:{findMany:async query=>{githubStoreQuery=query;return [];}}}};return name==='server-only'?{}:load.call(this,name,...rest);};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {githubChannelSchema,githubComparable,githubDigestLines}=require('../src/lib/seo-github-channel.ts');
const {parseTraffic,auditLinks,referralWindows}=require('../scripts/collect-github-channel.cjs');
const {fetchGithubReferrals}=require('../src/lib/services/ga4-github-referrals.ts');
const days=Array.from({length:14},(_,i)=>({date:new Date(Date.UTC(2026,9,28+i)).toISOString().slice(0,10),count:3,uniques:2}));
const traffic=()=>({status:'ok',count:42,uniques:9,days:structuredClone(days),reason:null});
const fixture=extra=>({version:1,kind:'github-prompt-channel',repository:'flatkey-ai/awesome-images',observedAt:'2026-11-11T08:00:00Z',timezone:'UTC',stars:828,forks:0,metadataStatus:'ok',metadataReason:null,views:traffic(),clones:traffic(),referrals:[],linkAudit:{status:'ok',flatkeyLinks:3,attributedLinks:0,reason:null},...extra});
test('GitHub schema retains real zero but rejects invented zero after missing permissions and duplicate buckets',()=>{
 assert.equal(githubChannelSchema.safeParse(fixture()).success,true);
 assert.equal(githubChannelSchema.safeParse(fixture({views:{status:'unavailable',count:0,uniques:0,days:[],reason:'403'}})).success,false);
 assert.equal(githubChannelSchema.safeParse(fixture({views:{...traffic(),days:[...days,days[0]]}})).success,false);
 const missing=parseTraffic({status:'rejected',reason:Error('github_http_403')},'views');assert.equal(missing.count,null);assert.deepEqual(missing.days,[]);
});
test('rolling snapshots merge by UTC date rather than summing overlapping 14-day totals',()=>{
 const old=fixture(),latest=fixture({observedAt:'2026-11-11T09:00:00Z'});
 const result=githubComparable([old,latest],'views','2026-11-04','2026-11-10',true);
 assert.equal(result.current,21);assert.equal(result.previous,21);assert.equal(result.dates.length,7);
 const text=githubDigestLines([latest],'2026-11-04','2026-11-10',true,new Date('2026-11-11T10:00:00Z')).join('\n');
 assert.match(text,/未把每日unique相加/);assert.match(text,/首次快照/);assert.match(text,/UTM覆盖 0\/3/);assert.doesNotMatch(text,/去重访客 14/);
});
test('provisional current UTC buckets and missing dates never become a complete comparison',()=>{
 const row=fixture({observedAt:'2026-11-10T08:00:00Z'}),result=githubComparable([row],'views','2026-11-04','2026-11-10',true);
 assert.equal(result.dates.length,6);assert.equal(result.current,18);
 const missing=githubDigestLines([],'2026-11-10','2026-11-10',false,new Date('2026-11-11')).join('\n');assert.match(missing,/待更新/);assert.doesNotMatch(missing,/浏览 0/);
});
test('README attribution audit excludes image assets and accepts only repo-specific GitHub UTM',()=>{
 const content='![asset](https://flatkey.ai/assets/image.png) [one](https://flatkey.ai?utm_source=github&utm_medium=referral&utm_campaign=awesome-images) [two](https://console.flatkey.ai/keys)';
 const result=auditLinks({status:'fulfilled',value:{encoding:'base64',content:Buffer.from(content).toString('base64')}},'flatkey-ai/awesome-images');assert.equal(result.flatkeyLinks,2);assert.equal(result.attributedLinks,1);
});
test('GA4 referral query binds source, medium, repository, hosts and an exact closed interval',async t=>{
 process.env.SEO_GA4_ACCESS_TOKEN='fixture-only';let query;
 t.mock.method(globalThis,'fetch',async(_url,options)=>{query=JSON.parse(options.body);return Response.json({metricHeaders:[{name:'sessions'},{name:'totalUsers'}],metadata:{timeZone:'America/Los_Angeles'},rows:[{metricValues:[{value:'8'},{value:'5'}]}]});});
 const value=await fetchGithubReferrals('flatkey-ai/awesome-images','2026-11-06','2026-11-12',new Date('2026-11-13T01:30:00Z'));
 assert.equal(value.end,'2026-11-11');assert.equal(value.sessions,8);assert.equal(value.users,5);assert.match(JSON.stringify(query),/sessionCampaignName/);assert.match(JSON.stringify(query),/awesome-images/);assert.match(JSON.stringify(query),/console.flatkey.ai/);assert.equal(query.dateRanges[0].endDate,'2026-11-11');
});
test('GA4 forbidden or thresholded referral data stays unavailable or partial, never zero',async t=>{
 process.env.SEO_GA4_ACCESS_TOKEN='fixture-only';let response=new Response('Forbidden',{status:403});t.mock.method(globalThis,'fetch',async()=>response);
 let v=await fetchGithubReferrals('flatkey-ai/awesome-images','2026-11-01','2026-11-07',new Date('2026-11-11'));assert.equal(v.status,'unavailable');assert.equal(v.sessions,null);
 response=Response.json({metricHeaders:[{name:'sessions'},{name:'totalUsers'}],metadata:{timeZone:'America/Los_Angeles',subjectToThresholding:true},rows:[]});v=await fetchGithubReferrals('flatkey-ai/awesome-images','2026-11-01','2026-11-07',new Date('2026-11-11'));assert.equal(v.status,'partial');assert.equal(v.users,null);
});

test('09:00 Beijing collection requests the last closed LA day rather than a still-open Beijing yesterday',()=>{
 const windows=referralWindows('2026-11-13',new Date('2026-11-13T01:00:00Z'));
 assert.deepEqual(windows,[{start:'2026-11-11',end:'2026-11-11'},{start:'2026-11-06',end:'2026-11-12'}]);
});
test('daily attribution reports the latest closed source day with its real date, weekly does not borrow another period',()=>{
 const row=fixture({referrals:[{start:'2026-11-09',end:'2026-11-09',timezone:'America/Los_Angeles',status:'ok',sessions:8,users:5,observedAt:'2026-11-11T01:00:00Z',reason:null}]});
 const text=githubDigestLines([row],'2026-11-10','2026-11-10',false,new Date('2026-11-11T08:00:00Z')).join('\n');
 assert.match(text,/到站会话 8/);assert.match(text,/2026-11-09～2026-11-09/);assert.match(text,/最新完整日滞后/);
 const weekly=githubDigestLines([row],'2026-11-06','2026-11-12',true,new Date('2026-11-13')).join('\n');assert.doesNotMatch(weekly,/到站会话 8/);
});

test('archive read includes next-day failed receipts even without historical traffic buckets',async()=>{
 const {loadGithubChannels}=require('../src/lib/services/seo-github-channel.ts');
 await loadGithubChannels('2026-11-01','2026-11-10');
 assert.equal(githubStoreQuery.where.kind,'GITHUB_CHANNEL');
 const [traffic,receipts]=githubStoreQuery.where.OR;
 assert.equal(traffic.periodStart.lte.toISOString(),'2026-11-10T00:00:00.000Z');
 assert.equal(receipts.createdAt.gte.toISOString(),'2026-11-01T00:00:00.000Z');
 assert.equal(receipts.createdAt.lt.toISOString(),'2026-11-12T00:00:00.000Z');
 const missing={status:'unavailable',count:null,uniques:null,days:[],reason:'403'};
 const latest=fixture({observedAt:'2026-11-11T09:00:00Z',views:missing,clones:missing});
 const text=githubDigestLines([fixture(),latest],'2026-11-10','2026-11-10',false,new Date('2026-11-11T10:00:00Z')).join('\n');
 assert.match(text,/Traffic来源缺失或无权限/);assert.match(text,/2026-11-11T09:00:00Z/);
});
