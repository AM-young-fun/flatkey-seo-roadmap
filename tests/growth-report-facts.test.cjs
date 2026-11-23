const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const{unavailableGrowthReportSnapshot,growthReportMissingFactLines}=require('../src/lib/growth-strategy.ts');
const{buildSeoDigest}=require('../src/lib/seo-digest.ts');
const{buildDraftSeoDigest}=require('../src/lib/seo-draft-digest.ts');
const{buildReviewedSeoDigest}=require('../src/lib/seo-reviewed-digest.ts');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex'),now=new Date('2026-11-19T18:00:00Z'),period={start:'2026-11-12',end:'2026-11-18'};
const snapshot=unavailableGrowthReportSnapshot(period,now);
snapshot.directions=[{id:'dir-gpu',title:'GPU pricing growth',experimentId:'exp-gpu',recommendation:'核实需求后补原页',decision:'待用户判断方向',taskIds:['original-task-gpu'],drivers:[{title:'GPU pricing article',url:'https://flatkey.ai/blog/gpu-pricing',topicId:'gpu',module:'blog',country:'US',language:'en',source:'GA4',metric:'sessions',previous:111,current:222,window:{...period,previousStart:'2026-11-05',previousEnd:'2026-11-11',timezone:'America/Los_Angeles'},publicationIds:[],taskIds:['original-task-gpu'],explanation:'原页面贡献上涨',limitation:'尚未证明因果',nextAction:'沿原任务核查需求及竞品'}]}];
const base=buildSeoDigest({date:'2026-11-19',kind:'weekly',now,notificationCompact:true,growthSnapshot:snapshot,observations:[],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:'missing',optimizationCoverage:'missing'});
const command=text=>({action:'save_draft',kind:'weekly',date:base.date,baseReportId:base.id,baseReportHash:base.hash,reportPeriod:base.reportPeriod,text,textSha256:hash(text),sourceEvidenceSha256:hash('actual-source-fixture')});
test('unchanged growth facts can be prepared and approved with the same frozen structured values',()=>{
  assert.deepEqual(growthReportMissingFactLines(snapshot,base.text),[]);
  const draft=buildDraftSeoDigest(base,command(base.text),new Date(now.getTime()+1000));
  const approved=buildReviewedSeoDigest(draft,{...command(draft.text),action:'save_reviewed',baseReportId:draft.id,baseReportHash:draft.hash,approvedAt:new Date(now.getTime()+2000).toISOString()},new Date(now.getTime()+3000));
  assert.equal(approved.growthSnapshot.directions[0].drivers[0].current,222);assert.equal(approved.text,base.text);
});
test('draft and direct reviewed bodies cannot change the frozen driver value, URL, original task or action while rendering the old facts',()=>{
  for(const changed of [base.text.replace('111 → 222','111 → 999'),base.text.replace('https://flatkey.ai/blog/gpu-pricing','https://flatkey.ai/blog/different'),base.text.replace('original-task-gpu','replacement-task'),base.text.replace('沿原任务核查需求及竞品','直接增加十篇文章')]){
    assert.notEqual(changed,base.text);assert.throws(()=>buildDraftSeoDigest(base,command(changed),new Date(now.getTime()+1000)),/冻结growth事实不一致/);
    assert.throws(()=>buildReviewedSeoDigest(base,{...command(changed),action:'save_reviewed',approvedAt:new Date(now.getTime()+2000).toISOString()},new Date(now.getTime()+3000)),/冻结growth事实不一致/);
  }
});
