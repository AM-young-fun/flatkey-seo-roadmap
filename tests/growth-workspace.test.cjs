const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText,f);
const {buildGrowthWorkspace,growthTargetId,reviewGrowthLanguage,reviewGrowthHistoricalPeriods,planGrowthDiscoveryPagination}=require('../src/lib/growth-workspace.ts');
const time='2026-11-23T10:00:00Z',url='https://flatkey.ai/blog/pricing';
const member=(patch={})=>({site:'flatkey.ai',keywordId:'k1',keyword:'gpu pricing',active:true,keywordActive:true,topicId:'t1',pool:'FORMAL',origin:'PLANNED',targetUrls:[url],marketAssignment:{primaryCountry:'US',language:'en',evidence:'original researched US English market'},...patch});
const evidence=(patch={})=>({site:'flatkey.ai',keyword:'gpu pricing',country:'US',language:'en',rank:18,url,source:'serp',checkedAt:time,exact:true,complete:true,...patch});
const input=(patch={})=>({generatedAt:time,topics:[{id:'t1',text:'GPU pricing',active:true,sites:['flatkey.ai','modelfit.cc']}],memberships:[member()],tasks:[],publications:[],inventory:[{url,lastSeen:time}],ranks:[evidence()],...patch});
test('formal membership requires a real active site TopicMap and the formal pool, not a nonempty topic id',()=>{
 const data=input({memberships:[member(),member({keywordId:'k2',keyword:'gpu rental',pool:'RESEARCH'}),member({keywordId:'k3',keyword:'best gpu',topicId:'placeholder'}),member({keywordId:'k4',keyword:'gpu guide',topicId:'missing'})],topics:[...input().topics,{id:'placeholder',text:'自然搜索发现词',active:true,sites:['flatkey.ai']}]});
 const result=buildGrowthWorkspace(data);assert.equal(result.reconciliation.formalCount,1);assert.equal(result.reconciliation.opportunityCount,1);assert.equal(result.reconciliation.reviewCount,2);assert.equal(result.topics.length,2);assert.equal(result.topics.filter(t=>t.site==='flatkey.ai')[0].formalCount,1);
});
test('original country targets stay distinct; foreign observations do not move a formal keyword or relabel CN to SG',()=>{
 const result=buildGrowthWorkspace(input({ranks:[evidence(),evidence({country:'JP',language:'ja',rank:2}),evidence({keyword:'模型价格',country:'CN',language:'zh-CN',rank:5})]}));
 assert.equal(result.targets.length,3);assert.equal(result.targets.find(t=>t.country==='US').membership,'formal');assert.equal(result.targets.find(t=>t.country==='JP').membership,'review');assert.equal(result.targets.find(t=>t.country==='JP').languageStatus,'mismatch');assert.equal(result.targets.some(t=>t.country==='SG'),false);assert.equal(result.reconciliation.rankedCount,1);
});
test('a planned URL or a draft is not published proof and cannot create a paid query; closed real publications remain eligible',()=>{
 const data=input({inventory:[],tasks:[{id:'original',siteDomain:'flatkey.ai',keyword:'gpu pricing',keywordId:'k1',country:'US',language:'en',pageUrl:url,status:'verified'}],publications:[{taskId:'original',pageUrl:url,status:'draft',publishedAt:time}],ranks:[]});
 let result=buildGrowthWorkspace(data);assert.equal(result.targets[0].pageState,'planned');assert.equal(result.monitoringQuote.queryCount,0);
 data.publications[0].status='verified';result=buildGrowthWorkspace(data);assert.equal(result.targets[0].pageState,'published');assert.equal(result.targets[0].workState,'completed');assert.deepEqual(result.targets[0].taskIds,['original']);assert.equal(result.monitoringQuote.queryCount,1);assert.equal(result.monitoringQuote.approved,false);assert.equal(result.monitoringQuote.paidRequests,0);
});
test('newer checked misses supersede saved database hits; an incomplete miss cannot manufacture outside100',()=>{
 let result=buildGrowthWorkspace(input({ranks:[evidence({source:'database',checkedAt:'2026-11-01T00:00:00Z',rank:3}),evidence({rank:null,url:null})]}));
 assert.equal(result.targets[0].rank,null);assert.equal(result.targets[0].captureState,'outside100');assert.equal(result.monitoringQuote.reusedCount,1);
 result=buildGrowthWorkspace(input({ranks:[evidence({checkedAt:'2026-11-20T00:00:00Z'}),evidence({rank:null,url:null,complete:false,captureState:'incomplete'})]}));assert.equal(result.targets[0].rank,null);assert.equal(result.targets[0].captureState,'incomplete');assert.equal(result.monitoringQuote.queryCount,1);
});
test('asOf projection ignores future captures before selecting a receipt and preserves the actual pre-deadline sample',()=>{
 const result=buildGrowthWorkspace(input({generatedAt:'2027-02-05T10:00:00Z',ranks:[evidence({rank:3,checkedAt:'2027-02-07T10:00:00Z'}),evidence({rank:17,checkedAt:'2027-02-04T10:00:00Z'})]}));
 assert.equal(result.targets[0].rank,17);assert.equal(result.targets[0].checkedAt,'2027-02-04T10:00:00Z');assert.equal(result.targets[0].rankEligible,true);
});
test('database-only, stale SERP, neutral model ids and wrong languages never become current quarter rank evidence',()=>{
 assert.equal(buildGrowthWorkspace(input({ranks:[evidence({source:'database'})]})).targets[0].rankEligible,false);
 assert.equal(buildGrowthWorkspace(input({ranks:[evidence({checkedAt:'2026-10-20T00:00:00Z'})]})).targets[0].rankEligible,false);
 assert.equal(reviewGrowthLanguage('NVIDIA B300','US','en').status,'unknown');assert.equal(reviewGrowthLanguage('gpu pricing','JP','ja').status,'mismatch');assert.equal(reviewGrowthLanguage('API料金 比較','JP','ja').status,'match');
 assert.equal(reviewGrowthLanguage('GPUの価格','JP','ja').status,'match');assert.equal(reviewGrowthLanguage('模型价格','SG','zh-CN').status,'match');
});
test('independent country counts retain approved separate targets; no best-country allocation or input mutation',()=>{
 const data=input({memberships:[member({keyword:'API',marketAssignment:{primaryCountry:'US',language:'en',evidence:'explicit reviewed original market',secondaryMarkets:[{country:'JP',reason:'explicit approved separate original target'}]}})],ranks:[evidence({keyword:'API'}),evidence({keyword:'API',country:'JP',language:'ja',rank:8})],languageReviews:[{keyword:'API',country:'US',classification:'CLEAR_MATCH'},{keyword:'API',country:'JP',classification:'CLEAR_MATCH'}]});
 const before=JSON.stringify(data),result=buildGrowthWorkspace(data);assert.equal(result.reconciliation.formalCount,2);assert.equal(result.reconciliation.rankedCount,2);assert.equal(result.reconciliation.uniqueKeywordCount,1);assert.deepEqual(result.reconciliation.countryCounts.map(c=>[c.country,c.count]),[['JP',1],['US',1]]);assert.equal(JSON.stringify(data),before);assert.notEqual(growthTargetId('flatkey.ai','API','US','en'),growthTargetId('flatkey.ai','API','JP','ja'));
});
test('RougeCue is data-only and never enters keyword production or paid monitoring',()=>{
 const result=buildGrowthWorkspace(input({memberships:[member({site:'rougecue.org'})],ranks:[evidence({site:'rougecue.org',url:'https://rougecue.org/blog/pricing'})]}));
 assert.equal(result.targets.length,0);const site=result.sites.find(s=>s.domain==='rougecue.org');assert.equal(site.trafficGoal,true);assert.equal(site.execution,false);assert.equal(site.keywordGoals,false);assert.equal(result.monitoringQuote.queryCount,0);
});
test('an identical approved word/market query is quoted once across independently planned sites and topic edges stay intact',()=>{
 const other='https://modelfit.cc/blog/pricing',data=input({memberships:[member({topicIds:['t2']}),member({site:'modelfit.cc',keywordId:'k2',targetUrls:[other]})],inventory:[{url,lastSeen:time},{url:other,lastSeen:time}],ranks:[],topics:[...input().topics,{id:'t2',text:'GPU comparisons',active:true,parentId:'t1',parentIds:['t1','another-parent'],sites:['flatkey.ai']}]});
 const result=buildGrowthWorkspace(data);assert.equal(result.reconciliation.formalCount,2);assert.equal(result.reconciliation.siteKeywordCount,2);assert.equal(result.reconciliation.uniqueKeywordCount,1);assert.equal(result.monitoringQuote.queryCount,1);assert.equal(result.monitoringQuote.queries[0].targetIds.length,2);assert.equal(result.monitoringQuote.maxCostMicros,6000);const topic=result.topics.find(t=>t.topicId==='t2');assert.equal(topic.formalCount,0);assert.equal(topic.relatedCount,1);assert.equal(topic.targetIds.length,1);assert.equal(result.topics.reduce((sum,t)=>sum+t.formalCount,0),2);assert.deepEqual(topic.parentIds,['another-parent','t1']);
});
test('pagination proposal is bounded to saved facts and never submits/approves a request or claims truncated data complete',()=>{
 const proposal=planGrowthDiscoveryPagination({site:'flatkey.ai',country:'US',language:'en',returned:1000,total:2505,limit:1000,offset:0,complete:false,unitCostMicros:10000});assert.equal(proposal.remaining,1505);assert.equal(proposal.pages,2);assert.equal(proposal.maxCostMicros,20000);assert.equal(proposal.returnedComplete,false);assert.equal(proposal.approved,false);assert.equal(proposal.paidRequests,0);
 const unknown=planGrowthDiscoveryPagination({site:'flatkey.ai',country:'US',language:'en',returned:1000,total:null,limit:1000,offset:0,complete:false});assert.equal(unknown.pages,null);assert.equal(unknown.maxCostMicros,null);
});
test('historical language projection preserves the original period/cohort denominators and does not call a partial capture a drop',()=>{
 const rows=[evidence({period:{id:'old',label:'10月第2期',scope:'SCHEDULED',cohortHash:'original-a',originalTargetCount:1500,originalQueryCount:1500}}),evidence({keyword:'nvidia b300',country:'JP',language:'ja',period:{id:'new',label:'11月第2期',scope:'SCHEDULED',cohortHash:'original-b',originalTargetCount:1525,originalQueryCount:1525}})];
 const before=JSON.stringify(rows),periods=reviewGrowthHistoricalPeriods(rows),latest=periods.find(p=>p.id==='new');assert.equal(latest.originalTargetCount,1525);assert.equal(latest.checkedQueries,1);assert.equal(latest.unknownLanguageTargets,1);assert.equal(latest.matchedRankedTargets,0);assert.equal(latest.comparable,false);assert.equal(latest.rawSnapshotPreserved,true);assert.equal(JSON.stringify(rows),before);
});

test('explicit secondary keywords reuse the original same-page task only in their existing market and preserve the original main word',()=>{
 const original={id:'original-page-task',siteDomain:'flatkey.ai',keyword:'rent gpu server',keywordId:'original-main',country:'US',language:'en',pageUrl:url,status:'in_progress',kind:'optimization'};
 const data=input({memberships:[member(),member({keywordId:'k2',keyword:'gpu rental'})],tasks:[original,{...original,id:'different-country',country:'JP',language:'ja'},{...original,id:'different-language',language:'ja'},{...original,id:'other-site',siteDomain:'modelfit.cc'},{...original,id:'deleted',deletedAt:time}],ranks:[]});
 const before=JSON.stringify(data),result=buildGrowthWorkspace(data);
 for(const row of result.targets){assert.deepEqual(row.taskIds,['original-page-task']);assert.equal(row.taskRelations.length,1);assert.equal(row.taskRelations[0].originalKeyword,'rent gpu server');assert.equal(row.taskRelations[0].status,'confirmed');assert.equal(row.taskRelations[0].source,'task_page');assert.equal(row.taskRelations[0].sourceKeywordId,row.keywordId);}
 assert.equal(result.reconciliation.formalCount,2);assert.equal(JSON.stringify(data),before);assert.equal(data.tasks[0].keywordId,'original-main');
});

test('same-page task clues never assign an unknown target market, approve execution, or promote a research keyword',()=>{
 const task={id:'original',siteDomain:'flatkey.ai',keyword:'rent gpu server',country:'US',language:'en',pageUrl:url,status:'in_progress',kind:'optimization'};
 const result=buildGrowthWorkspace(input({memberships:[member({marketAssignment:null}),member({keywordId:'research',keyword:'gpu rental',pool:'RESEARCH',marketAssignment:null})],tasks:[task],ranks:[]}));
 for(const row of result.targets){assert.equal(row.country,null);assert.equal(row.language,null);assert.deepEqual(row.taskIds,[]);assert.equal(row.taskRelations[0].status,'candidate');assert.equal(row.taskRelations[0].country,'US');assert.deepEqual(row.planningProofs,[]);assert.equal(row.monitoringEligible,false);}
 assert.equal(result.targets.find(row=>row.keywordId==='research').membership,'opportunity');assert.equal(result.reconciliation.formalCount,1);
});

test('shared Topic, sheet source, a different URL/query, and observed rank URLs cannot invent same-page task intent',()=>{
 const task={id:'original',siteDomain:'flatkey.ai',keyword:'rent gpu server',country:'US',language:'en',pageUrl:url,status:'in_progress'};
 const result=buildGrowthWorkspace(input({memberships:[member({targetUrls:[],sourceUrl:'https://alidocs.dingtalk.com/a/sheet'}),member({keywordId:'query',keyword:'gpu rental',targetUrls:[url+'?country=us']}),member({keywordId:'path',keyword:'gpu guide',targetUrls:[url+'-other']})],tasks:[task]}));
 for(const row of result.targets){assert.deepEqual(row.taskIds,[]);assert.equal(row.taskRelations,undefined);}
});

test('a real published same-page receipt links its original task and scope; drafts, future, and conflicting publications cannot',()=>{
 const task={id:'original',siteDomain:'flatkey.ai',keyword:'rent gpu server',country:'US',language:'en',pageUrl:'https://flatkey.ai/old-page',status:'verified'};
 const pub={id:'receipt',taskId:'original',siteDomain:'flatkey.ai',country:'US',language:'en',pageUrl:url,status:'verified',publishedAt:time};
 const data=input({tasks:[task],publications:[pub],inventory:[],ranks:[]});
 let result=buildGrowthWorkspace(data);assert.deepEqual(result.targets[0].taskIds,['original']);assert.equal(result.targets[0].taskRelations[0].publicationId,'receipt');assert.deepEqual(result.targets[0].publishedUrls,[url]);
 for(const patch of [{id:undefined},{status:'draft'},{publishedAt:'2026-11-24T00:00:00Z'},{country:'JP',language:'ja'},{siteDomain:'modelfit.cc'}]){result=buildGrowthWorkspace({...data,publications:[{...pub,...patch}]});assert.deepEqual(result.targets[0].taskIds,[]);assert.equal(result.targets[0].pageState,'planned');}
});

test('only an owned explicit source page may link a secondary term and alias task links merge without mutating target identity',()=>{
 const task={id:'original',siteDomain:'flatkey.ai',keyword:'rent gpu server',country:'US',language:'en',pageUrl:url,status:'verified'};
 const result=buildGrowthWorkspace(input({memberships:[member({keywordId:'a',targetUrls:[]}),member({keywordId:'z',targetUrls:[],sourceUrl:url+'#section'})],tasks:[task],ranks:[]}));
 assert.equal(result.targets.length,1);assert.equal(result.targets[0].id,growthTargetId('flatkey.ai','gpu pricing','US','en'));assert.equal(result.targets[0].keywordId,'a');assert.deepEqual(result.targets[0].taskIds,['original']);assert.equal(result.targets[0].taskRelations[0].sourceKeywordId,'z');assert.deepEqual(result.targets[0].aliasKeywordIds,['z']);
});
