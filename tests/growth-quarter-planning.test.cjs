const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;Module._resolveFilename=function(n,p,...a){return resolve.call(this,n.startsWith('@/')?path.join(root,'src',n.slice(2)):n,p,...a)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {allocateIntegerBudget,MARKET_RESEARCH_WEIGHTS,DELIVERY_WEIGHTS,quarterPlanningInputSchema}=require('../src/lib/growth-quarter-planning.ts');
const {emptyGrowthStrategy,prepareGrowthStrategyMutation,growthWorkspaceIdentity,growthHash}=require('../src/lib/growth-strategy.ts');
const now=new Date('2026-11-24T06:00:00Z'),target={id:'t1',keywordId:'k1',site:'flatkey.ai',topicId:'topic1',keyword:'model api cost',country:null,language:null,languageStatus:'unknown',membership:'formal',publishedUrls:[],plannedUrls:[],pageState:'unmapped'};
const ws={targets:[target],topics:[{topicId:'topic1',site:'flatkey.ai'}]};
const plan=()=>({version:'quarter-planning-v1',sourceVersion:growthWorkspaceIdentity(ws),title:'完整季度方向与市场研究审核',targetIds:['t1'],artifact:{reference:'/private/exact-quarter.json',sha256:'a'.repeat(64)},executionStart:'2026-11-25',executionEnd:'2027-02-05',workstreams:[{id:'api-cost',title:'模型API有效成本',bucket:'primary',topicIds:['topic1'],taskIds:[],rationale:'现有本话题页面和业务能力明确，先补原词当地需求证据',verification:'按真实当地原词研究，完成Top10和前5逐页比对后制作',evidenceReferences:['saved-pages-and-original-topic.json']},{id:'coverage',title:'基本覆盖',bucket:'foundation',topicIds:['topic1'],taskIds:[],rationale:'已有页面的持续维护纳入基本覆盖，不重复新增同题文章',verification:'保留原页面和原任务，按7/14/28天真实来源评价效果',evidenceReferences:['saved-original-task.json']}],researchBudget:{total:239,counts:allocateIntegerBudget(239,MARKET_RESEARCH_WEIGHTS)},deliveryBudget:{total:552,counts:allocateIntegerBudget(552,DELIVERY_WEIGHTS)},reservedOriginalTaskIds:['original-task'],limitations:['当前研究名额不等于已经验证的新词，不提供付费授权；待核身份继续留N且不计排名']});
test('v9 GPU/API/other is one 70/25/5 budget while legacy receipts retain their old schema',()=>{
 const {BUSINESS_DELIVERY_WEIGHTS,planStrategyAllocationSchema}=require('../src/lib/growth-quarter-planning.ts');
 const revised={...plan(),version:'quarter-planning-v2',targetUnit:'normalized_original_word',targetIds:Array.from({length:1600},(_,i)=>'target-'+i),workstreams:plan().workstreams.map((row,i)=>({...row,bucket:i?'api':'gpu'})),deliveryBudget:{total:1600,counts:allocateIntegerBudget(1600,BUSINESS_DELIVERY_WEIGHTS)}};
 assert.deepEqual(revised.deliveryBudget.counts,{gpu:1120,api:400,other:80});assert.equal(quarterPlanningInputSchema.safeParse(revised).success,true);
 assert.equal(quarterPlanningInputSchema.safeParse({...revised,deliveryBudget:plan().deliveryBudget}).success,false,'cannot layer legacy quotas onto GPU allocation');
 assert.equal(quarterPlanningInputSchema.safeParse({...revised,targetUnit:undefined}).success,false);
 assert.equal(quarterPlanningInputSchema.safeParse(plan()).success,true,'old snapshots stay readable');
 const receipt={version:'quarter-planning-v2',quarterPlanHash:'a'.repeat(64),futureBudget:{total:20,counts:allocateIntegerBudget(20,BUSINESS_DELIVERY_WEIGHTS)},preservedTaskIds:[],tasks:[],gaps:[],marketResearchBudget:{total:0,counts:allocateIntegerBudget(0,MARKET_RESEARCH_WEIGHTS)}};
 assert.equal(planStrategyAllocationSchema.safeParse(receipt).success,true);
 assert.equal(planStrategyAllocationSchema.safeParse({...receipt,gaps:[{bucket:'primary',count:1,reason:'旧主攻分类不能混进新GPU业务预算中'}]}).success,false);
});
const run=(state,command,actor='collector')=>prepareGrowthStrategyMutation(state,{requestId:'quarter-plan-test',expectedVersion:state.version,...command},actor,ws,[],['original-task'],now);

test('the 1000-word calendar replaces the active cohort only after exact validation and retains the historical baseline', () => {
 const { BUSINESS_DELIVERY_WEIGHTS } = require('../src/lib/growth-quarter-planning.ts');
 const { QUARTER_NEW_WORD_VERSION, QUARTER_NEW_MARKET_SHARES } = require('../src/lib/growth-quarter-calendar.ts');
 const { growthStrategyStoredSchema, evaluateGrowthGoals } = require('../src/lib/growth-strategy.ts');
 const countries = [['US','en'],['JP','ja'],['ES','es-ES'],['SG','zh-CN'],['BR','pt-BR']];
 const targets = countries.flatMap(([country,language]) => Array.from({length:200},(_,index)=>({
  ...target,id:`new-${country}-${index}`,keywordId:`keyword-${country}-${index}`,keyword:`raw word ${country} ${index}`,country,language,languageStatus:'match',workState:'planned',taskIds:[],
 })));
 const source = {...ws,targets};
 const proposal = {...plan(),version:QUARTER_NEW_WORD_VERSION,targetUnit:'normalized_original_word',sourceVersion:growthWorkspaceIdentity(source),
  targetIds:targets.map(row=>row.id),executionStart:'2026-11-27',
  researchBudget:{total:1000,counts:allocateIntegerBudget(1000,QUARTER_NEW_MARKET_SHARES)},
  deliveryBudget:{total:10,counts:allocateIntegerBudget(10,BUSINESS_DELIVERY_WEIGHTS)},
  workstreams:plan().workstreams.map((row,index)=>({...row,bucket:index?'api':'gpu'})),
  calendar:targets.map((row,index)=>({targetId:row.id,intentId:row.country,primary:index%200===0,kind:'blog',
   researchDate:'2026-11-27',deliveryDate:'2026-11-30',ahrefs:{keyword:row.keyword,country:row.country,source:'ahrefs_web',
    sourceReference:'ahrefs-export.csv',sourceSha256:'b'.repeat(64),sourceRow:index+1,observedAt:now.toISOString(),volume:20}})),
 };
 const { membership, ...frozenTarget } = target;
 assert.equal(membership,'formal');
 const legacy = {...emptyGrowthStrategy(),baseline:{frozenAt:'2026-11-20T00:00:00.000Z',actor:'human',sourceVersion:'old',targets:[frozenTarget],reason:'原季度版本历史回执'}};
 const mutate = (state, action, command, workspace = source, context = {}) => prepareGrowthStrategyMutation(
  state,{requestId:'quarter-calendar-migration',expectedVersion:state.version,action,...command},'human',workspace,[],['original-task'],now,context);
 const research = {...proposal,calendar:proposal.calendar.map(({targetId,researchDate,ahrefs})=>({targetId,researchDate,ahrefs,stage:'research_only'}))};
 const researchDraft = mutate(legacy,'save_quarter_plan',{plan:research});
 assert.equal(researchDraft.quarterPlanning.plan.calendar.length,1000);
 assert.deepEqual(researchDraft.baseline,legacy.baseline);
 const assigned = {...source,targets:[{...source.targets[0],taskIds:['original-task']},...source.targets.slice(1)]};
 assert.throws(()=>mutate(legacy,'save_quarter_plan',{plan:research},assigned),{code:'quarter_new_word_scope'});
 assert.throws(()=>mutate(researchDraft,'approve_quarter_plan',{hash:researchDraft.quarterPlanning.hash,
  sourceVersion:research.sourceVersion,reason:'用户核对已排研究日期及原季度历史'}),{code:'quarter_delivery_pending'});
 const activeResearch = mutate(researchDraft,'approve_quarter_plan',{hash:researchDraft.quarterPlanning.hash,
  sourceVersion:research.sourceVersion,reason:'用户确认启用新词清单及研究排期，页面交付另行核实',researchOnly:true});
 assert.equal(activeResearch.baseline.targets.length,1000);
 assert.equal(activeResearch.baselineHistory[0].targets.length,legacy.baseline.targets.length);
 const replacementTargets = targets.map(row => ({ ...row, id: "replacement-" + row.id, keywordId: "replacement-" + row.keywordId, keyword: "replacement " + row.keyword }));
 const replacementWorkspace = { ...source, targets: replacementTargets };
 const replacement = { ...research, replacesBaselineHash: activeResearch.baseline.planHash, sourceVersion: growthWorkspaceIdentity(replacementWorkspace),
  targetIds: replacementTargets.map(row => row.id), calendar: research.calendar.map((entry, index) => ({
    ...entry, targetId: replacementTargets[index].id, ahrefs: { ...entry.ahrefs, keyword: replacementTargets[index].keyword },
  })) };
 const replacementDraft = mutate(activeResearch, "save_quarter_plan", { plan: replacement }, replacementWorkspace);
 assert.deepEqual(replacementDraft.baseline, activeResearch.baseline);
 const replacementApproval = { action: "approve_quarter_plan", hash: replacementDraft.quarterPlanning.hash, sourceVersion: replacement.sourceVersion,
  reason: "用户核对确切原词替换、国家配额、历史和新旧计划", researchOnly: true };
 assert.throws(() => prepareGrowthStrategyMutation(replacementDraft,
  { ...replacementApproval, requestId: "quarter-replacement-auto", expectedVersion: replacementDraft.version }, "collector", replacementWorkspace, [], ["original-task"], now), { code: "human_required" });
 const replaced = mutate(replacementDraft, "approve_quarter_plan", replacementApproval, replacementWorkspace);
 assert.deepEqual(replaced.baseline.targets.map(row => row.id), replacementTargets.map(row => row.id));
 assert.deepEqual(replaced.baselineHistory.at(-1), activeResearch.baseline);
 const swapped = { ...replacementTargets[0], country: "JP", language: "ja" };
 const uneven = { ...replacementWorkspace, targets: [swapped, ...replacementTargets.slice(1)] };
 assert.throws(() => mutate(activeResearch, "save_quarter_plan", { plan: { ...replacement, sourceVersion: growthWorkspaceIdentity(uneven),
  calendar: [{ ...replacement.calendar[0], ahrefs: { ...replacement.calendar[0].ahrefs, country: "JP" } }, ...replacement.calendar.slice(1)] } }, uneven),
  { code: "quarter_calendar_invalid" });
 assert.throws(() => mutate(activeResearch, "save_quarter_plan", { plan: { ...replacement, replacesBaselineHash: "d".repeat(64) } }, replacementWorkspace), { code: "quarter_replacement_stale" });
 const delivery = mutate(activeResearch,'save_quarter_plan',{plan:proposal});
 const activeDelivery = mutate(delivery,'approve_quarter_plan',{hash:delivery.quarterPlanning.hash,
  sourceVersion:proposal.sourceVersion,reason:'用户核对完成制作日期后沿同一批原词启用交付'});
 assert.deepEqual(activeDelivery.baseline.targets,activeResearch.baseline.targets);
 assert.equal(activeDelivery.baseline.frozenAt,activeResearch.baseline.frozenAt);
 const forged = structuredClone(research);
 forged.calendar[0].deliveryDate = '2026-11-30';
 assert.equal(quarterPlanningInputSchema.safeParse(forged).success,false);
 const staggered = structuredClone(proposal);
 staggered.calendar[1].researchDate = '2026-11-30';
 assert.equal(mutate(legacy,'save_quarter_plan',{plan:staggered}).quarterPlanning.plan.calendar[1].researchDate,'2026-11-30');
 assert.throws(()=>mutate(legacy,'save_quarter_plan',{plan:proposal},source,
  {originalCommitments:[{site:'flatkey.ai',kind:'blog',deliveryDate:'2026-11-30'}]}),/日产能/);
 const wrong = structuredClone(proposal);
 wrong.calendar[0].ahrefs.country='JP';
 assert.throws(()=>mutate(legacy,'save_quarter_plan',{plan:wrong}),/Ahrefs原词/);
 const weekend = structuredClone(proposal);
 weekend.calendar[0].deliveryDate='2026-11-29';
 assert.equal(quarterPlanningInputSchema.safeParse(weekend).success,false);
 const draft = mutate(legacy,'save_quarter_plan',{plan:proposal});
 assert.deepEqual(draft.baseline,legacy.baseline);
 const approved = mutate(draft,'approve_quarter_plan',{hash:draft.quarterPlanning.hash,sourceVersion:proposal.sourceVersion,reason:'用户已授权直接应用这份新版季度日历'});
 assert.equal(approved.baseline.targets.length,1000);
 assert.equal(approved.baseline.planHash,draft.quarterPlanning.hash);
 assert.deepEqual(approved.baselineHistory,[legacy.baseline]);
 const parsed = growthStrategyStoredSchema.safeParse(approved);
 assert.equal(parsed.success,true, JSON.stringify(parsed.error?.issues));
 const prior = evaluateGrowthGoals(approved,{...source,opportunities:[]},[],{start:'2026-11-10',end:'2026-11-16'},new Date('2026-11-22T00:00:00Z'));
 assert.equal(prior.baselineCount,1);
});
test('integer market and delivery budgets preserve totals and distinct units',()=>{assert.deepEqual(allocateIntegerBudget(239,MARKET_RESEARCH_WEIGHTS),{US:83,JP:60,BR:48,SG:36,other:12});assert.deepEqual(allocateIntegerBudget(552,DELIVERY_WEIGHTS),{primary:331,foundation:138,experiment:83});assert.deepEqual(allocateIntegerBudget(0,DELIVERY_WEIGHTS),{primary:0,foundation:0,experiment:0});assert.throws(()=>allocateIntegerBudget(-1,DELIVERY_WEIGHTS));});
test('cumulative research never loses an allocated country slot at a one-slot boundary',()=>{const a=allocateIntegerBudget(9,MARKET_RESEARCH_WEIGHTS),b=allocateIntegerBudget(10,MARKET_RESEARCH_WEIGHTS);assert.equal(Object.keys(a).every(key=>b[key]>=a[key]),true);for(let n=1;n<100;n++){const before=allocateIntegerBudget(n-1,MARKET_RESEARCH_WEIGHTS),after=allocateIntegerBudget(n,MARKET_RESEARCH_WEIGHTS);assert.equal(Object.keys(before).every(key=>after[key]>=before[key]),true);}});
test('quarter proposal has actual workstreams, source identity and exact budgets rather than inventory-only approval',()=>{assert.equal(quarterPlanningInputSchema.safeParse(plan()).success,true);const wrong=plan();wrong.researchBudget.counts.US++;assert.equal(quarterPlanningInputSchema.safeParse(wrong).success,false);const duplicate=plan();duplicate.targetIds.push('t1');assert.equal(quarterPlanningInputSchema.safeParse(duplicate).success,false);const p=plan();p.workstreams[0].topicIds=['fake'];assert.throws(()=>run(emptyGrowthStrategy(),{action:'save_quarter_plan',plan:p}),{code:'quarter_reference_missing'});});
test('AI can save a complete draft but only human can approve its exact version and freeze all stable members',()=>{const state=run(emptyGrowthStrategy(),{action:'save_quarter_plan',plan:plan()});assert.equal(state.baseline,null);assert.equal(state.quarterPlanning.approval,null);const command={action:'approve_quarter_plan',hash:state.quarterPlanning.hash,sourceVersion:growthWorkspaceIdentity(ws),reason:'用户审阅完整话题、当地研究预算、工作包与限制后明确批准'};assert.throws(()=>run(state,command),{code:'human_required'});const approved=run(state,command,'human');assert.equal(approved.baseline.targets.length,1);assert.equal(approved.baseline.targets[0].country,null);assert.equal(approved.quarterPlanning.approval.hash,growthHash(plan()));assert.throws(()=>run(state,{...command,hash:'b'.repeat(64)},'human'),{code:'quarter_plan_changed'});});
test('new raw-inventory freeze is refused, old stored cohorts remain compatible',()=>{assert.throws(()=>run(emptyGrowthStrategy(),{action:'freeze_baseline',targetIds:['t1'],sourceVersion:growthWorkspaceIdentity(ws),reason:'只看词库总数，未形成季度方向和投入方案'},'human'),{code:'quarter_plan_required'});});
test('quarter revision changes future investment only and never edits an existing baseline or N',()=>{let state=run(emptyGrowthStrategy(),{action:'save_quarter_plan',plan:plan()});state=run(state,{action:'approve_quarter_plan',hash:state.quarterPlanning.hash,sourceVersion:growthWorkspaceIdentity(ws),reason:'用户明确审核完整方案后批准并保留待核身份'},'human');const baseline=structuredClone(state.baseline);const revised=plan();revised.title='未来投入修订，原季度分母不动';state=run(state,{action:'save_quarter_plan',plan:revised});state=run(state,{action:'approve_quarter_plan',hash:state.quarterPlanning.hash,sourceVersion:growthWorkspaceIdentity(ws),reason:'用户批准新投入版本，不改变原成员和基线历史'},'human');assert.deepEqual(state.baseline,baseline);const bad=plan();bad.targetIds=[];assert.equal(quarterPlanningInputSchema.safeParse(bad).success,false);});
test('a new AI draft retains the active approval and cannot reset earlier cumulative budget',()=>{const {quarterAllocationProblems}=require('../src/lib/growth-quarter-planning.ts');let state=run(emptyGrowthStrategy(),{action:'save_quarter_plan',plan:plan()});state=run(state,{action:'approve_quarter_plan',hash:state.quarterPlanning.hash,sourceVersion:growthWorkspaceIdentity(ws),reason:'用户审阅完整旧方案并明确批准原工作范围与额度'},'human');const approvedHash=state.quarterPlanning.hash;const revised=plan();revised.title='新增待审草稿不撤销原批准';state=run(state,{action:'save_quarter_plan',plan:revised});assert.equal(state.quarterPlanning.approval,null);assert.equal(state.quarterPlanningHistory[0].approval.hash,approvedHash);const prior={id:'prior-week',status:'scheduled',targets:{executionRange:{start:'2026-11-20',end:'2026-11-26'}},strategyAllocation:{futureBudget:{total:10},marketResearchBudget:{total:10}}};const existing={id:'existing-plan',targets:{executionRange:{start:'2026-11-27',end:'2026-12-03'}},strategyAllocation:{quarterPlanHash:approvedHash,tasks:[],futureBudget:{total:20,offset:10},marketResearchBudget:{total:20,offset:10}}};assert.deepEqual(quarterAllocationProblems(existing,state,[],[prior,existing]),[]);assert.match(quarterAllocationProblems({...existing,strategyAllocation:{...existing.strategyAllocation,futureBudget:{total:20,offset:0}}},state,[],[prior,existing]).join(' '),/累计/);});

test('opportunity capacity cannot substitute for a user-approved direction and experiment',()=>{const {quarterAllocationProblems}=require('../src/lib/growth-quarter-planning.ts');const proposal=plan();proposal.workstreams.push({...proposal.workstreams[0],id:'hotspot',bucket:'experiment'});let state=run(emptyGrowthStrategy(),{action:'save_quarter_plan',plan:proposal});state=run(state,{action:'approve_quarter_plan',hash:state.quarterPlanning.hash,sourceVersion:growthWorkspaceIdentity(ws),reason:'用户批准预留容量，不是批准尚未发现的热点方向'},'human');const workflowPlan={id:'new-week',targets:{executionRange:{start:'2026-11-27',end:'2026-12-03'}},strategyAllocation:{quarterPlanHash:state.quarterPlanning.hash,tasks:[{taskId:'actual-task',bucket:'experiment',workstreamId:'hotspot'}],futureBudget:{total:1},marketResearchBudget:{total:0}}};const task={id:'actual-task',topicId:'topic1',dueAt:'2026-11-27T06:00:00Z'};assert.match(quarterAllocationProblems(workflowPlan,state,[task]).join(' '),/机会预留不是热点方向批准/);});

test('a human quarterly list freezes 1600 original words once while preserving a cross-site alias outside the denominator',()=>{const targets=Array.from({length:1600},(_,i)=>({...target,id:`word-${i}`,keywordId:`keyword-${i}`,keyword:`specific topic keyword ${i}`}));const source={...ws,targets:[...targets,{...targets[0],id:'cross-site-alias',site:'modelfit.cc'}],topics:[...ws.topics,{topicId:'topic1',site:'modelfit.cc'}]};const proposal={...plan(),sourceVersion:growthWorkspaceIdentity(source),targetUnit:'normalized_original_word',targetIds:targets.map(row=>row.id)};let state=prepareGrowthStrategyMutation(emptyGrowthStrategy(),{requestId:'save-quarter-1600',expectedVersion:0,action:'save_quarter_plan',plan:proposal},'collector',source,[],['original-task'],now);state=prepareGrowthStrategyMutation(state,{requestId:'approve-quarter-1600',expectedVersion:state.version,action:'approve_quarter_plan',hash:state.quarterPlanning.hash,sourceVersion:proposal.sourceVersion,reason:'用户明确整合正式规划、已排与已做为1600个季度原词'},'human',source,[],['original-task'],now);assert.equal(state.baseline.targets.length,1600);assert.equal(source.targets.length,1601);assert.equal(new Set(state.baseline.targets.map(row=>row.keyword)).size,1600);const bad={...proposal,targetIds:[...proposal.targetIds.slice(1),'cross-site-alias']};assert.equal(quarterPlanningInputSchema.safeParse({...proposal,targetIds:proposal.targetIds.slice(1)}).success,false);assert.equal(quarterPlanningInputSchema.safeParse(bad).success,true);});
