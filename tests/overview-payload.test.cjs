const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest);};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {overviewPayload,hydrateOverviewPayload}=require('../src/lib/overview-payload.ts');
test('overview strips receipt duplication but preserves each country rank and topic relationships',()=>{
 const ranks={US:{rank:1,rankStatus:'ranked',source:'dataforseo_serp'},JP:{rank:6,rankStatus:'ranked',source:'dataforseo_serp'},ES:{rank:null,rankStatus:'not_found_capture',source:'dataforseo_serp'},BR:null};
 const keyword={id:'a',text:'API example',type:'MAIN',topicId:'topic',topicText:'API',siteDomain:'flatkey.ai',siteName:'Flatkey',parentId:'parent',parentIds:['parent'],active:true,volume:10,marketVolumes:{US:10,JP:2,ES:null,BR:null},monitoringEligible:true,latestRanks:ranks,rankingEvidence:{US:[{raw:'x'.repeat(20000)}]},targetUrls:['https://flatkey.ai/api']};
 const data={keywords:[keyword],topics:[{id:'topic'}],usingDemoData:false,regions:['US','JP','ES','BR'],targetDomain:null,latestRun:null,serpOverview:{summary:{total:1,rankedInAnyRegion:1}}};
 const before=structuredClone(data),compact=overviewPayload(data),roundtrip=hydrateOverviewPayload(JSON.parse(JSON.stringify(compact)));
 assert.deepEqual(data,before);assert.ok(JSON.stringify(compact).length < JSON.stringify(data).length/10);
 for(const region of ['US','JP','ES','BR']) {assert.equal(roundtrip.keywords[0].latestRanks[region]?.rank,ranks[region]?.rank);assert.equal(roundtrip.keywords[0].latestRanks[region]?.rankStatus,ranks[region]?.rankStatus);}
 assert.deepEqual(roundtrip.keywords[0].parentIds,['parent']);assert.deepEqual(roundtrip.serpOverview,data.serpOverview);
 assert.equal(hydrateOverviewPayload(data),data);
});
