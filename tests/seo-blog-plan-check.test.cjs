const {test}=require('node:test');
const assert=require('node:assert/strict');
const {checkPlan,calendarDays,calendarPlanWeeks,readSnapshot,readCalendarSnapshots}=require('../scripts/seo-blog-plan-check.cjs');
const calendar={weekStart:'2026-11-16',workdays:['2026-11-18','2026-11-19','2026-11-20'],evidence:{sourceUrl:'https://www.gov.cn/zhengce/content/202511/content_7046381.htm',checkedAt:'2026-11-18T07:00:00Z'}};
function task(day,id=day){return {id,weekStart:calendar.weekStart,siteDomain:'modelfit.cc',kind:'blog',country:'US',language:'en',keyword:'topic '+id,keywordId:'keyword-'+id,pageUrl:'https://modelfit.cc/blog/topic-'+id,dueAt:day+'T16:00:00+08:00',status:'ready',evidence:[{}],research:{evidence:[{}]},nextAction:'Write the validated source.'};}
function snapshot(tasks=calendar.workdays.map(d=>task(d))){return {storage:'database',plan:{id:'plan',weekStart:calendar.weekStart,status:'scheduled',version:1,taskIds:tasks.map(t=>t.id),gaps:[]},tasks};}
test('detects the production incident: only calculator tasks and zero ModelFit blogs',()=>{const s=snapshot([]);s.tasks=[{...task('2026-11-18'),kind:'landing'}];const r=checkPlan(s,calendar);assert.equal(r.ok,false);assert.equal(r.errors.filter(e=>e.code==='missing_daily_slot').length,3);});
test('one independent US English source per workday passes',()=>assert.equal(checkPlan(snapshot(),calendar).ok,true));
test('candidate coverage cannot pass as the formal production schedule',()=>{const s=snapshot();s.plan.status='draft';assert.equal(checkPlan(s,calendar).ok,false);assert.equal(checkPlan(s,calendar,undefined,'candidate').ok,true);});
test('Flatkey English quota does not fill a ModelFit slot',()=>{const s=snapshot();s.tasks[0].siteDomain='flatkey.ai';assert.equal(checkPlan(s,calendar).ok,false);});
test('two originals on one date fail even if weekly total looks right',()=>{const s=snapshot();s.tasks[1].dueAt=s.tasks[0].dueAt;assert.ok(checkPlan(s,calendar).errors.some(e=>e.code==='daily_quota_exceeded'));});
test('ongoing, published, verified and failed originals keep their original date',()=>{for(const status of ['drafting','published','verified','blocked','failed']){const s=snapshot();s.tasks[0].status=status;const r=checkPlan(s,calendar);assert.equal(r.scheduled,3);assert.equal(r.days[0].taskId,'2026-11-18');assert.equal(r.errors.some(e=>e.code==='missing_daily_slot'),false);}});
test('an unplanned existing task must be reconciled, not duplicated',()=>{const s=snapshot();s.plan.taskIds.shift();assert.ok(checkPlan(s,calendar).errors.some(e=>e.code==='existing_task_not_in_plan'));});
test('a specific dated gap is accounted for but never completed',()=>{const s=snapshot();s.tasks.shift();s.plan.taskIds.shift();s.plan.gaps=[{category:'other',count:1,reason:'[ModelFit US/en 2026-11-18] SERP evidence incomplete; retain candidate for research.'}];const r=checkPlan(s,calendar);assert.equal(r.accountedFor,true);assert.equal(r.ok,false);assert.equal(r.gaps,1);});
test('vague weekly gaps cannot conceal a missing day',()=>{const s=snapshot([]);s.plan.gaps=[{category:'other',count:3,reason:'ModelFit has no topics'}];assert.equal(checkPlan(s,calendar).accountedFor,false);});
test('formal keyword, evidence and exact blog route are required',()=>{for(const field of ['keywordId','pageUrl','research']){const s=snapshot();s.tasks[0][field]=null;assert.ok(checkPlan(s,calendar).errors.some(e=>e.code==='task_inputs_incomplete'));}});
test('retrying a keyword or URL on a second day is rejected',()=>{const s=snapshot();s.tasks[1].keyword=s.tasks[0].keyword;assert.ok(checkPlan(s,calendar).errors.some(e=>e.code==='duplicate_keyword'));});
test('business date uses Beijing midnight rather than UTC',()=>{const s=snapshot();s.tasks[0].dueAt='2026-11-17T16:00:00Z';assert.equal(checkPlan(s,calendar).ok,true);});
test('explicit official calendar supports weekend make-up days',()=>{const c={...calendar,workdays:['2026-11-21']};const s=snapshot([task('2026-11-21')]);assert.equal(checkPlan(s,c).ok,true);assert.throws(()=>calendarDays({...c,evidence:null}),/verified_workday_calendar_required/);});

const businessCalendar={range:{start:'2026-11-27',end:'2026-12-03'},workdays:['2026-11-27','2026-11-30','2026-12-01','2026-12-02','2026-12-03'],evidence:calendar.evidence};
const monday = day => { const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10); };
function businessSnapshots(c=businessCalendar) {
  return calendarPlanWeeks(c).map(weekStart=>{
    const tasks=c.workdays.filter(day=>monday(day)===weekStart).map(day=>({...task(day),weekStart}));
    return {storage:'database',weekStart,plan:{id:'plan-'+weekStart,weekStart,status:'scheduled',version:2,taskIds:tasks.map(t=>t.id),gaps:[],targets:{blog:5}},tasks};
  });
}
test('Friday to Thursday coverage reads two Monday plans and counts only five daily slots',()=>{
  const s=businessSnapshots(),before=structuredClone(s),r=checkPlan(s,businessCalendar);
  assert.equal(r.ok,true);assert.equal(r.expected,5);assert.equal(r.scheduled,5);
  assert.deepEqual(r.range,{start:'2026-11-27',end:'2026-12-03'});
  assert.deepEqual(r.planWeeks,['2026-11-23','2026-11-30']);
  assert.deepEqual(r.days.map(d=>d.weekStart),['2026-11-23',...Array(4).fill('2026-11-30')]);
  assert.equal(r.weekStart,undefined,'business output does not advertise a Friday production key');
  assert.deepEqual(s,before,'checking does not reschedule tasks or add bucket quotas');
});
test('bucket tasks outside the business window do not cause non-workday or duplicate errors',()=>{
  const s=businessSnapshots();
  for(const [index,day] of [[0,'2026-11-23'],[1,'2026-12-04']]){
    const t={...task(day),weekStart:s[index].weekStart,keyword:s[0].tasks[0].keyword,pageUrl:s[0].tasks[0].pageUrl};
    s[index].tasks.push(t);s[index].plan.taskIds.push(t.id);
  }
  assert.equal(checkPlan(s,businessCalendar).ok,true);
});
test('from can cross Monday buckets without moving or replacing the original Friday slot',()=>{
  const s=businessSnapshots(),r=checkPlan(s,businessCalendar,'2026-11-30');
  assert.equal(r.ok,true);assert.equal(r.expected,4);assert.equal(r.days[0].date,'2026-11-30');
  assert.equal(checkPlan(s,businessCalendar,'2026-11-28').expected,4);
  assert.throws(()=>checkPlan(s,businessCalendar,'2026-12-04'),/from_outside_week/);
});
test('a task must be listed in its due-date Monday plan rather than the other bucket',()=>{
  const s=businessSnapshots(),t=s[1].tasks[0];s[1].plan.taskIds.shift();s[0].plan.taskIds.push(t.id);
  const r=checkPlan(s,businessCalendar);
  assert.ok(r.errors.some(e=>e.code==='existing_task_not_in_plan'&&e.taskIds.includes(t.id)));
  assert.ok(r.errors.some(e=>e.code==='missing_daily_slot'&&e.date==='2026-11-30'));
});
test('a Friday weekStart is never accepted as a production plan or task bucket',()=>{
  assert.throws(()=>calendarDays({...businessCalendar,weekStart:'2026-11-27'}),/calendar_week_invalid/);
  const s=businessSnapshots();s[0].plan.weekStart='2026-11-27';s[0].tasks[0].weekStart='2026-11-27';
  const r=checkPlan(s,businessCalendar);
  assert.ok(r.errors.some(e=>e.code==='formal_plan_required'));assert.ok(r.errors.some(e=>e.code==='task_week_mismatch'));
});
test('business coverage requires verified calendar and two matching production plan snapshots',()=>{
  assert.throws(()=>checkPlan(businessSnapshots(),{...businessCalendar,evidence:null}),/verified_workday_calendar_required/);
  assert.throws(()=>checkPlan({},businessCalendar),/business_snapshots_array_required/);
  const s=businessSnapshots();assert.ok(checkPlan(s.slice(0,1),businessCalendar).errors.some(e=>e.code==='formal_plan_required'&&e.weekStart==='2026-11-30'));
  s[0].storage='demo';assert.ok(checkPlan(s,businessCalendar).errors.some(e=>e.code==='production_database_required'));
  assert.ok(checkPlan([...businessSnapshots(),businessSnapshots()[0]],businessCalendar).errors.some(e=>e.code==='duplicate_plan_snapshot'));
});
test('business calendar requires an exact Friday to Thursday window and unique bounded workdays',()=>{
  for(const range of [{start:'2026-11-23',end:'2026-11-29'},{start:'2026-11-27',end:'2026-12-04'},{start:'2026-02-30',end:'2026-03-08'}])assert.throws(()=>calendarDays({...businessCalendar,range}),/calendar_range_invalid/);
  for(const workdays of [['2026-11-26'],['2026-11-27','2026-11-27'],['2026-11-31']])assert.throws(()=>calendarDays({...businessCalendar,workdays}),/calendar_days_invalid/);
});
test('business checks retain market, inputs, research, failure and duplicate protections across buckets',()=>{
  for(const [field,value,code] of [['country','JP','wrong_market_or_language'],['keywordId',null,'task_inputs_incomplete'],['research',null,'task_inputs_incomplete'],['status','researching','research_not_ready'],['status','failed','original_task_needs_repair']]){
    const s=businessSnapshots();s[1].tasks[0][field]=value;assert.ok(checkPlan(s,businessCalendar).errors.some(e=>e.code===code));
  }
  for(const field of ['keyword','pageUrl']){
    const s=businessSnapshots();s[1].tasks[0][field]=s[0].tasks[0][field];assert.ok(checkPlan(s,businessCalendar).errors.some(e=>e.code==='duplicate_'+(field==='pageUrl'?'url':'keyword')));
  }
});
test('business tasks on an unlisted workday fail, while a verified makeup weekend is allowed',()=>{
  const s=businessSnapshots(),t={...task('2026-11-28'),weekStart:'2026-11-23'};s[0].tasks.push(t);s[0].plan.taskIds.push(t.id);
  assert.ok(checkPlan(s,businessCalendar).errors.some(e=>e.code==='non_workday_task'));
  assert.equal(checkPlan(s,{...businessCalendar,workdays:[...businessCalendar.workdays,'2026-11-28']}).ok,true);
});
test('same task in both saved snapshots is counted once, conflicting readbacks fail',()=>{
  const s=businessSnapshots();s[1].tasks.push(structuredClone(s[0].tasks[0]));assert.equal(checkPlan(s,businessCalendar).scheduled,5);
  s[1].tasks.at(-1).status='drafting';assert.ok(checkPlan(s,businessCalendar).errors.some(e=>e.code==='conflicting_task_snapshot'));
});
test('business candidate and dated-gap checks use the correct original plan',()=>{
  const s=businessSnapshots();s[1].plan.status='draft';assert.equal(checkPlan(s,businessCalendar).ok,false);assert.equal(checkPlan(s,businessCalendar,undefined,'candidate').ok,true);
  s[1].plan.status='scheduled';const t=s[1].tasks.shift();s[1].plan.taskIds.shift();
  const gap={category:'other',count:1,reason:`[ModelFit US/en 2026-11-30] Original candidate still needs complete research evidence.`};
  s[0].plan.gaps.push(gap);assert.equal(checkPlan(s,businessCalendar).accountedFor,false);
  s[0].plan.gaps=[];s[1].plan.gaps.push(gap);const r=checkPlan(s,businessCalendar);assert.equal(r.accountedFor,true);assert.equal(r.ok,false);assert.equal(r.gaps,1);
  assert.equal(t.id,'2026-11-30');
});
test('production business reads make exactly two read-only Monday requests and never request Friday keys',async()=>{
  const previousFetch=global.fetch,previousToken=process.env.SEO_IMPORT_TOKEN,calls=[];process.env.SEO_IMPORT_TOKEN='coverage-test-token';
  global.fetch=async(url,options)=>{calls.push({url,options});const week=new URL(url).searchParams.get('week');return{ok:true,json:async()=>({storage:'database',weekStart:week})};};
  try{
    const result=await readCalendarSnapshots(businessCalendar,'unused-settings');assert.deepEqual(result.map(s=>s.weekStart),['2026-11-23','2026-11-30']);
    assert.equal(calls.length,2);assert.ok(calls.every(c=>c.options.method===undefined&&!('body'in c.options)&&c.options.redirect==='error'));
    assert.ok(calls.every(c=>!c.url.includes('2026-11-27')));
  }finally{global.fetch=previousFetch;if(previousToken===undefined)delete process.env.SEO_IMPORT_TOKEN;else process.env.SEO_IMPORT_TOKEN=previousToken;}
});
test('production token-file reads retain regular-file, current-owner and private-mode checks',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'seo-coverage-token-')),tokenFile=path.join(dir,'token'),settingsFile=path.join(dir,'settings.json');
  const previousFetch=global.fetch,previousToken=process.env.SEO_IMPORT_TOKEN;let requests=0;
  delete process.env.SEO_IMPORT_TOKEN;fs.writeFileSync(tokenFile,'private-test-token',{mode:0o600});fs.writeFileSync(settingsFile,JSON.stringify({tokenFile}));
  global.fetch=async()=>{requests++;return{ok:true,json:async()=>({storage:'database'})};};
  try{
    assert.equal(fs.statSync(tokenFile).uid,process.getuid());
    await readSnapshot('2026-11-23',settingsFile);assert.equal(requests,1);
    fs.chmodSync(tokenFile,0o644);await assert.rejects(readSnapshot('2026-11-23',settingsFile),/insecure_token_file/);assert.equal(requests,1);
    fs.chmodSync(tokenFile,0o600);const link=path.join(dir,'symlink');fs.symlinkSync(tokenFile,link);fs.writeFileSync(settingsFile,JSON.stringify({tokenFile:link}));
    await assert.rejects(readSnapshot('2026-11-23',settingsFile),/insecure_token_file/);assert.equal(requests,1);
  }finally{global.fetch=previousFetch;if(previousToken===undefined)delete process.env.SEO_IMPORT_TOKEN;else process.env.SEO_IMPORT_TOKEN=previousToken;fs.rmSync(dir,{recursive:true,force:true});}
});
test('CLI accepts saved business snapshot arrays and preserves success, gap, failure and invalid-input exit codes',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'seo-coverage-'));const calendarFile=path.join(dir,'calendar.json'),snapshotFile=path.join(dir,'snapshot.json');
  fs.writeFileSync(calendarFile,JSON.stringify(businessCalendar));
  const run=(s,extra=[])=>{fs.writeFileSync(snapshotFile,JSON.stringify(s));return spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/seo-blog-plan-check.cjs'),'--calendar='+calendarFile,'--snapshot='+snapshotFile,...extra],{encoding:'utf8'});};
  try{
    let s=businessSnapshots(),r=run(s,['--from=2026-11-30']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).expected,4);
    s[0].tasks=[];s[0].plan.taskIds=[];s[0].plan.gaps=[{category:'other',count:1,reason:'[ModelFit US/en 2026-11-27] Research still incomplete, preserve original candidate.'}];assert.equal(run(s).status,3);
    s[0].plan.gaps=[];assert.equal(run(s).status,2);
    assert.equal(run({},[]).status,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
