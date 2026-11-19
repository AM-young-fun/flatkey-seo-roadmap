const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {overviewRegistration,overviewRegistrationChange}=require('../src/lib/organic-overview-registration.ts');
const range={start:'2026-11-12',end:'2026-11-18'};
const record={...range,siteDomain:'flatkey.ai',propertyId:'541304395',channelDimension:'firstUserPrimaryChannelGroup',channelName:'Organic Search',event:'sign_up_success',metric:'totalUsers',distinctOverWholePeriod:true,timezone:'America/Los_Angeles',users:78,observedAt:'2026-11-19T09:49:00Z'};
const archive=(records)=>({scope:'first-user-organic-search',records});
test('overview matches report whole-period users, never adds daily users or all-channel totals',()=>{
 const rows=[record,{...record,start:'2026-11-18',users:2},{...record,channelName:'Direct',users:415}];
 assert.equal(overviewRegistration(range,archive(rows)).total,78);
 assert.equal(overviewRegistration(range,archive(rows.slice(1))).total,null);
 assert.equal(overviewRegistration(range,{scope:'all-channels',records:[record]}).total,null);
 assert.equal(overviewRegistration(range,archive([record]),'US').total,null);
});
test('missing interval and partial interval stay unknown; source revision and true zero are retained',()=>{
 assert.equal(overviewRegistration(range,null).total,null);
 assert.equal(overviewRegistration(range,archive([{...record,end:'2026-11-16'}])).total,null);
 assert.equal(overviewRegistration(range,archive([record,{...record,users:0,observedAt:'2026-11-19T10:00:00Z'}])).total,0);
});
test('comparison uses exact whole-period users and suppresses unequal periods and zero denominator percentages',()=>{
 const current=overviewRegistration(range,archive([record]));
 assert.equal(overviewRegistrationChange(current,{...current,total:80},true),'比对比期少 2.5%');
 assert.equal(overviewRegistrationChange(current,{...current,total:0},true),'比对比期多 78 人');
 assert.equal(overviewRegistrationChange(current,{...current,days:6},true),'区间长度不同，暂不比较');
 assert.equal(overviewRegistrationChange(current,null,true),'对比期数据未齐');
});
test('overview UI uses canonical period and organic daily APIs without all-channel fallback',()=>{
 const source=fs.readFileSync(require('path').join(__dirname,'../src/components/SessionSeoReport.tsx'),'utf8');
 assert.ok(source.includes('/api/traffic/registrations?'));assert.ok(source.includes('/api/traffic/daily?'));
 assert.ok(!source.includes('/api/seo/registrations?'));assert.ok(!source.includes('全渠道'));
 assert.ok(source.includes('所选区间去重'));assert.ok(source.includes('overviewRegistrationChange'));
});
