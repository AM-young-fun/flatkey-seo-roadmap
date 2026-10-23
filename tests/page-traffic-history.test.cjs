const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),ts=require("typescript");
require.extensions[".ts"]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {PAGE_TRAFFIC_GROUPS,pageTrafficHistorySchema,mergePageTrafficHistory}=require("../src/lib/page-traffic-history.ts");
const evidence=(date,users)=>({metric:"totalUsers",eventName:"page_view",ruleVersion:1,timezone:"America/Los_Angeles",sourceUrl:"https://analytics.google.com/analytics/web/",groups:PAGE_TRAFFIC_GROUPS.map(g=>({key:g.key,points:[{date,users,pageViews:users}]}))});
const row=(d,u,collectedAt)=>({analysis:{pageTrends:evidence(d,u)},collectedAt:new Date(collectedAt)});
test("history survives new weeks and missing samples",()=>{const old=row("2026-10-02",99,"2026-10-23"),next=row("2026-10-23",120,"2026-10-30"),missing=row("2026-10-02",null,"2026-10-31");assert.deepEqual(mergePageTrafficHistory([next,old,missing,old],"2026-10-29")[0].points.map(p=>[p.date,p.users]),[["2026-10-02",99],["2026-10-23",120]]);assert.equal(mergePageTrafficHistory([next,old],"2026-10-22")[0].points.length,1);assert.equal(mergePageTrafficHistory([old,row("2026-10-02",101,"2026-10-24")],"2026-10-22")[0].points[0].users,101);assert.equal(old.analysis.pageTrends.groups[0].points[0].users,99);});
test("model list and detail share one group while prompts stay separate",()=>{for(const p of ["","/en","/zh","/pt"])for(const [path,key] of [["/models","models"],["/models/x","models"],["/models/x/prompts/a","prompts"],["/compute/prices","compute"],["/prompts/video","prompts"]])assert.deepEqual(PAGE_TRAFFIC_GROUPS.filter(g=>new RegExp(g.pathPattern).test(p+path)).map(g=>g.key),[key]);});
test("reject duplicate dates",()=>{const d=evidence("2026-10-02",1);assert.equal(pageTrafficHistorySchema.safeParse(d).success,true);d.groups[0].points.push({...d.groups[0].points[0]});assert.equal(pageTrafficHistorySchema.safeParse(d).success,false);});

const {pageTrafficWindow}=require("../src/lib/page-traffic-history.ts");
test("range reports identical three-week coverage and filters a shared seven-day calendar",()=>{
  const series=mergePageTrafficHistory(Array.from({length:21},(_,i)=>row(new Date(Date.UTC(2026,9,2+i)).toISOString().slice(0,10),i,"2026-10-23")),"2026-10-22");
  const all=pageTrafficWindow(series,"all"),three=pageTrafficWindow(series,"21"),week=pageTrafficWindow(series,"7");
  assert.equal(three.sameAsAll,true);assert.deepEqual(three.series,all.series);assert.equal(three.days,21);
  assert.equal(week.start,"2026-10-16");assert.equal(week.end,"2026-10-22");assert.equal(week.sameAsAll,false);assert.equal(week.series[0].points.length,7);
  const extended=mergePageTrafficHistory([...Array.from({length:28},(_,i)=>row(new Date(Date.UTC(2026,9,2+i)).toISOString().slice(0,10),i,"2026-10-30"))],"2026-10-29");
  const next=pageTrafficWindow(extended,"21");assert.equal(next.start,"2026-10-09");assert.equal(next.sameAsAll,false);assert.equal(next.series[0].points.length,21);assert.equal(extended[0].points.length,28);
  const sparse=series.map((g,i)=>({...g,points:i===1?g.points.slice(0,-3):g.points}));assert.equal(pageTrafficWindow(sparse,"7").series[1].points[0].date,"2026-10-16");
});
