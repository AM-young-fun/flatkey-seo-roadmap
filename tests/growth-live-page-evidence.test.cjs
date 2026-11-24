const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),ts=require('typescript'),path=require('node:path'),Module=require('node:module');
const resolve=Module._resolveFilename;Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(__dirname,'../src',name.slice(2)):name,parent,...rest);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,resolveJsonModule:true,esModuleInterop:true}}).outputText,f);
const {growthPageAuditChecks,growthPublicationPageChecks}=require('../src/lib/growth-live-page-evidence.ts');
const target={site:'flatkey.ai',keywordId:'k',keyword:'gpu pricing'},url='https://flatkey.ai/blog/pricing';
const audit=(patch={})=>({siteDomain:'flatkey.ai',sourceId:'page_audit',rowKey:'keyword:k',snapshotHash:'a'.repeat(64),snapshot:{version:1,keywordId:'k',keyword:'GPU pricing',verdict:'VERIFIED',pageUrl:url,canonicalUrl:url,httpStatus:200,checkedAt:'2026-11-25T00:00:00Z',...patch}});
test('normal page-audit identity and REVIEW are retained independently from old READY/URL mappings',()=>{
 const verified=growthPageAuditChecks([audit()],[target]);assert.equal(verified.length,1);assert.equal(verified[0].verified,true);
 const review=growthPageAuditChecks([audit({verdict:'REVIEW',httpStatus:307,canonicalUrl:undefined})],[target]);assert.equal(review[0].verified,false);assert.equal(review[0].httpStatus,307);assert.equal(review[0].canonicalUrl,null);
 const mismatch=growthPageAuditChecks([audit({keywordId:'other'})],[target]);assert.equal(mismatch[0].verified,false);assert.equal(mismatch[0].url,null);
 assert.deepEqual(growthPageAuditChecks([{...audit(),sourceId:'not-page-audit'}],[target]),[]);
 assert.deepEqual(growthPageAuditChecks([{...audit(),rowKey:'keyword:other'}],[target]),[]);
});
test('additionalPages retain their own check times and cannot inherit a parent VERIFIED row time',()=>{
 const rows=growthPageAuditChecks([audit({additionalPages:[{pageUrl:url+'2',canonicalUrl:url+'2',httpStatus:200,checkedAt:'2026-11-24T01:00:00Z'}]})],[target]);
 assert.equal(rows[1].checkedAt,'2026-11-24T01:00:00Z');assert.notEqual(rows[1].checkedAt,rows[0].checkedAt);
});
test('publication live proof requires actual original KID, live timestamp and matching published content/language',()=>{
 const publication={id:'pub',taskId:'task',siteDomain:'flatkey.ai',pageUrl:url,status:'verified',contentVersion:'v1',language:'en',publishedAt:'2026-11-24T22:00:00Z',liveCheck:{checkedAt:'2026-11-25T00:00:00Z',httpStatus:200,canonicalUrl:url,contentVersion:'v1',language:'en',contentMatched:true,linksChecked:true,sourceReceipt:'original-actual-http-receipt',evidence:[{label:'actual'}]}};
 const workflow={tasks:[{id:'task',siteDomain:'flatkey.ai',keywordId:'k',keyword:'gpu pricing'}],publications:[publication]};
 const before=JSON.stringify(workflow);assert.equal(growthPublicationPageChecks(workflow,[target])[0].verified,true);assert.equal(JSON.stringify(workflow),before);
 publication.liveCheck.contentVersion='v0';assert.equal(growthPublicationPageChecks(workflow,[target])[0].verified,false);
 publication.liveCheck=null;assert.deepEqual(growthPublicationPageChecks(workflow,[target]),[],'publishedAt cannot stand in for HTTP checkedAt');
 workflow.tasks[0].keywordId='other';assert.deepEqual(growthPublicationPageChecks(workflow,[target]),[]);
});
