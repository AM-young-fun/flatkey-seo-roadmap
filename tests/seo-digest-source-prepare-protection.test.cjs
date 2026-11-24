const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const {bootstrap}=require('../scripts/seo-daily-dashboard-preview.cjs');bootstrap();
const {buildSeoDigest}=require('../src/lib/seo-digest.ts');
let existing=null,writes=0;const rows=new Map(),originalLoad=Module._load;
Module._load=function(name,parent,...args){
 if(name==='@/lib/prisma')return{prisma:{seoReportVersion:{findFirst:async()=>existing,createMany:async({data})=>{writes++;rows.set(data.id,data);},findUniqueOrThrow:async({where})=>rows.get(where.id)}}};
 if(parent?.filename.endsWith('/src/lib/services/seo-digest.ts')&&name.startsWith('./'))return{};
 return originalLoad.call(this,name,parent,...args);
};
const {saveSeoDigest}=require('../src/lib/services/seo-digest.ts');
const build=(date,kind)=>buildSeoDigest({date,kind,now:new Date('2026-11-27T12:00:00Z'),observations:[],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:'missing',optimizationCoverage:'missing'});
test('first daily base is allowed, while generic reprepare cannot replace an existing source dashboard',async()=>{
 existing=null;writes=0;const first=build('2026-11-24','daily');assert.equal((await saveSeoDigest(first)).id,first.id);assert.equal(writes,1);
 existing={id:'seo-digest:2026-11-24:aaaaaaaaaaaaaaaa'};await assert.rejects(saveSeoDigest(first),error=>error.status===409&&/save_daily_dashboard/.test(error.message));assert.equal(writes,1);
});
test('weekly preparation stays on its reviewed source protocol and never uses the daily guard',async()=>{
 writes=0;existing={id:'existing-daily-source'};const weekly=build('2026-11-26','weekly');assert.equal((await saveSeoDigest(weekly)).id,weekly.id);assert.equal(writes,1);
});
