const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const{buildSeoDigest}=require('../src/lib/seo-digest.ts'),{digestSnapshotId}=require('../src/lib/seo-digest-message.cjs');
const{buildDraftSeoDigest,sameDraftDigest}=require('../src/lib/seo-draft-digest.ts');
const{buildReviewedSeoDigest,sameReviewedDigest}=require('../src/lib/seo-reviewed-digest.ts');
const{hasWeeklyReportSections,weeklyTechnicalText}=require('../src/lib/seo-report-template.ts');
const{reportModuleShareLines,savedReportModuleShares}=require('../src/lib/report-module-shares.ts');
const{buildDailyDashboardSeoDigest}=require('../src/lib/seo-daily-dashboard.ts');
const now=new Date('2026-11-26T12:00:00Z'),hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const input={date:'2026-11-26',kind:'weekly',now,notificationCompact:true,observations:[],publications:[],optimizations:[],effects:[],priorities:[],issues:[],runNotes:[],publicationCoverage:'missing',optimizationCoverage:'missing'};
const command=(base,text=base.text)=>({action:'save_draft',kind:'weekly',date:base.date,baseReportId:base.id,baseReportHash:base.hash,reportPeriod:base.reportPeriod,text,textSha256:hash(text),sourceEvidenceSha256:hash('saved-evidence')});
test('new report has exactly five blocks, GPU/API conversion quality in business, and no GitHub body even if legacy input is supplied',()=>{
  const base=buildSeoDigest({...input,githubObservations:[{repository:'irrelevant'}]});
  assert.equal(base.reportTemplateVersion,9);assert.equal(hasWeeklyReportSections(base.text,9),true);assert.equal((base.text.match(/\*\*[一二三四五六]、/g)||[]).length,5);
  assert.equal(hasWeeklyReportSections(buildSeoDigest({...input,notificationCompact:false}).text,9),true,'default weekly generation cannot label verbose legacy text as v9');
  assert.doesNotMatch(base.text+base.detailText,/GitHub|独立渠道结果/);assert.match(base.text,/一、业务与搜索表现[\s\S]+GPU业务承接[\s\S]+API自然获客[\s\S]+二、/);
  assert.match(base.text,/整理取数 2026\/11\/26 20:00（北京时间/);assert.equal(hasWeeklyReportSections(base.text.replace('一、业务与搜索表现','二、业务与搜索表现'),9),false);
  assert.match(base.text,/\| 站点 \|[^\n]+\n\|---\|/);assert.doesNotMatch(base.text,/\|[^\n]*\|\n\n\|/);
  assert.equal(base.conversionSnapshot.api.firstPayment30d.rate.value,null);assert.match(weeklyTechnicalText(base.text,9),/检查未完成/);
});
test('whole-period module source is frozen, same-window only, and an explicit new source package updates body and projection together',()=>{
  const values={previous:{all:100,modelDetail:70,prompts:60},current:{all:100,modelDetail:80,prompts:70},observedAt:now.toISOString()};
  const base=buildSeoDigest(input),snapshot={version:1,period:base.reportPeriod,comparisonPeriod:{start:'2026-11-12',end:'2026-11-18'},timezone:'America/Los_Angeles',sourceReportId:base.id,sourceEvidenceSha256:hash('whole-period'),values};
  const measured=buildSeoDigest({...input,moduleShareSnapshot:snapshot});assert.match(measured.text,/模型详情 70\.0% → 80\.0%/);assert.equal(measured.moduleShareSnapshot.values.current.all,100);
  const wrong=buildSeoDigest({...input,moduleShareSnapshot:{...snapshot,comparisonPeriod:{start:'2026-11-11',end:'2026-11-17'}}});assert.equal(wrong.moduleShareSnapshot,undefined);assert.match(wrong.text,/暂不计算/);
  const traffic=()=>({sessions:{previous:null,current:null},clicks:{previous:null,current:null},impressions:{previous:null,current:null}});
  const evidence={scope:'website-console',timezone:'America/Los_Angeles',observedAt:now.toISOString(),gscComparable:false,sites:['flatkey.ai','rackrate.org','modelfit.cc','mochichatbot.com','jev-llm.com'].map(name=>({name,...traffic()})),countries:['US','JP','BR','ES'].map(name=>({name,...traffic()})),moduleShares:values};
  const text=base.text.replace(reportModuleShareLines()[0],reportModuleShareLines(values).join('\n\n'));
  const draft=buildDraftSeoDigest(base,{...command(base,text),dashboardEvidence:evidence},new Date(now.getTime()+1000));assert.equal(draft.moduleShareSnapshot.values.current.modelDetail,80);assert.equal(draft.dashboard.moduleShares.current.modelDetail,80);
  assert.throws(()=>buildDraftSeoDigest(base,{...command(base),dashboardEvidence:evidence},new Date(now.getTime()+1000)),/模块占比/);
  assert.equal(savedReportModuleShares({...values,current:{...values.current,secret:'private'},secret:'private'}).secret,undefined);
});
test('v9 daily source revision updates its exact module lines and retained projection together while preserving the old snapshot',()=>{
  const base=buildSeoDigest({...input,date:'2026-11-24',kind:'daily'}),before=structuredClone(base),values={previous:{all:100,modelDetail:70,prompts:60},current:{all:100,modelDetail:80,prompts:70},observedAt:now.toISOString()};
  const raw={action:'save_daily_dashboard',kind:'daily',date:base.date,baseReportId:base.id,baseReportHash:base.hash,sourceEvidenceSha256:hash('actual-daily-period'),moduleShares:values};
  const result=buildDailyDashboardSeoDigest(base,raw,now);assert.deepEqual(base,before);assert.match(result.text,/模型详情 70\.0% → 80\.0%/);assert.doesNotMatch(result.text,/整段去重访客来源未齐/);
  assert.equal(result.hash,hash(result.text));assert.equal(result.moduleShareSnapshot.values.current.modelDetail,80);assert.match(result.dashboard.detailText,/80\.0%/);
  const again=buildDailyDashboardSeoDigest(result,{...raw,baseReportId:result.id,baseReportHash:result.hash,moduleShares:{...values,current:{...values.current,modelDetail:90}}},now);assert.match(again.text,/90\.0%/);assert.doesNotMatch(again.text,/80\.0%/);
});
test('v9 pending and approved bodies freeze conversion evidence; edits cannot retain mismatching displayed facts or restore a removed block',()=>{
  const base=buildSeoDigest(input),draft=buildDraftSeoDigest(base,command(base),new Date(now.getTime()+1000));assert.equal(sameDraftDigest(structuredClone(draft),draft),true);
  const reviewed=buildReviewedSeoDigest(draft,{...command(draft),action:'save_reviewed',approvedAt:new Date(now.getTime()+2000).toISOString()},new Date(now.getTime()+3000));assert.equal(sameReviewedDigest(structuredClone(reviewed),reviewed),true);
  for(const text of [base.text+'\n\n**六、独立渠道结果**\n旧内容',base.text.replace('30天批次未成熟或来源未齐时保留原注册分母','全部批次均已成熟且付费率为0')])assert.throws(()=>buildDraftSeoDigest(base,command(base,text),new Date(now.getTime()+1000)));
  const altered=structuredClone(draft);altered.conversionSnapshot.api.firstPayment30d.rate.value=0;assert.equal(sameDraftDigest(altered,draft),false);
});
test('snapshot identity includes conversion/template fields without changing the legacy hash contract or accepting another window',()=>{
  const legacy={date:'2026-11-19',text:'old immutable body',detailText:'old details'},oldVersion=crypto.createHash('sha256').update(JSON.stringify({text:legacy.text,detailText:legacy.detailText})).digest('hex').slice(0,16);
  assert.equal(digestSnapshotId(legacy),`seo-digest:2026-11-19:${oldVersion}`);
  const base=buildSeoDigest(input),other=structuredClone(base.conversionSnapshot);other.scope.end='2026-11-24';other.api.registration.rate.value=.5;
  const normalized=buildSeoDigest({...input,conversionSnapshot:other});assert.equal(normalized.conversionSnapshot.api.registration.rate.value,null);assert.match(normalized.conversionSnapshot.readiness.reasons.join(''),/窗口不一致/);
  assert.notEqual(digestSnapshotId({...legacy,conversionSnapshot:base.conversionSnapshot}),digestSnapshotId({...legacy,conversionSnapshot:other}));
});
