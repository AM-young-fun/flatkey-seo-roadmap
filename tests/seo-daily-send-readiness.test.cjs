const {test}=require('node:test'),assert=require('node:assert/strict');
const {verifyDailySendReadiness}=require('../src/lib/seo-daily-send-readiness.cjs');
const report={text:'获客/注册截至 2026-11-15 · 最近已核实页面组 4/4',accountRegistrations:{users:0,missing:[]}};
const daily={points:[{date:'2026-11-15',newUsers:0,newRegistrations:0}]};
const pages={groups:['gpu_compute','model_list','model_detail','prompts'].map(key=>({key,points:[{date:'2026-11-15',totalUsers:0,pageViews:0,funnel:{entrants:0,registrations:0}}]}))};
test('verified zero values are sendable with dated archived sources',()=>assert.equal(verifyDailySendReadiness(report,daily,pages,'2026-11-15').pageGroups,4));
test('missing sources and stale snapshots fail before claim or provider send',()=>{
 assert.throws(()=>verifyDailySendReadiness(report,{points:[]},pages,'2026-11-15'),/acquisition/);
 assert.throws(()=>verifyDailySendReadiness({...report,accountRegistrations:{users:null}},daily,pages,'2026-11-15'),/account_registrations/);
 assert.throws(()=>verifyDailySendReadiness(report,daily,{groups:pages.groups.slice(1)},'2026-11-15'),/gpu_compute/);
 assert.throws(()=>verifyDailySendReadiness({...report,text:'all pending'},daily,pages,'2026-11-15'),/snapshot_sources/);
 assert.throws(()=>verifyDailySendReadiness(report,daily,pages,'2026-11-23'),/acquisition/);
});
