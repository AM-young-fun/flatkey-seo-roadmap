const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),ts=require("typescript");
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {weeklySummaryText}=require("../src/lib/weekly-summary.ts");
const sample=()=>({current:{newUsers:2007,newRegistrations:222},previous:{newUsers:1597,newRegistrations:280},comparable:true,diagnosis:{significant:true,findings:[{title:"自然搜索增长集中在模型页面",evidence:"已保存证据",action:"内部下一步",level:"finding"},{title:"自然搜索注册减少，需核对落地页",evidence:"已保存证据",action:"内部下一步",level:"finding"},{title:"技术根因尚缺生产日志证据",evidence:"待确认的问题",action:"内部调查任务",level:"unresolved"}]}});
test("summary keeps the displayed period's totals and measured conclusions, without investigation labels or actions",()=>{
  const result=weeklySummaryText(sample());
  for(const value of ["2,007","25.7%","222","20.7%","自然搜索增长集中在模型页面","自然搜索注册减少"])assert.ok(result.includes(value));
  for(const value of ["待确认","内部下一步","技术根因","调查任务"])assert.ok(!result.includes(value));
  assert.ok(!result.includes("\n"));
});
test("a saved Codex paragraph is authoritative and displayed as one paragraph",()=>{
  const input=sample();input.evidence={trafficScope:"organic_search",codexSummary:{text:"已核对的本期总结。\n 已完成的数据直接复用。"}};
  assert.equal(weeklySummaryText(input),"已核对的本期总结。 已完成的数据直接复用。");
});
test("expanded keyword coverage never becomes a claimed natural ranking increase",()=>{
  const input=sample();input.comparison={current:565,net:546};input.ranking={waiting:false,captureWeek:true,baseline:false,noNewCapture:false,comparisonReference:{kind:"FIRST_ISSUE"}};
  const text=weeklySummaryText(input);assert.match(text,/565 个词进入前100/);assert.match(text,/采集范围不同/);assert.ok(!text.includes("净增 546"));
  input.ranking.captureWeek=false;assert.match(weeklySummaryText(input),/本周未安排关键词采集/);
});
test("missing comparisons do not invent percent changes or manufacture a summary from unresolved tasks",()=>{
  const input=sample();input.comparable=false;input.previous=null;input.diagnosis.findings=[];
  assert.ok(!weeklySummaryText(input).includes("%"));
  input.current=null;assert.equal(weeklySummaryText(input),"");
});

test("unscoped saved text and funnels cannot override the organic report summary",()=>{
 const input=sample();input.evidence={codexSummary:{text:"广告带来的全渠道增长"},newVisitorFunnel:{current:[{name:"first_visit",users:200,completionRate:.1},{name:"sign_up_success",users:20,completionRate:null}],previous:[{name:"first_visit",users:100,completionRate:.2},{name:"sign_up_success",users:20,completionRate:null}]}};
 const text=weeklySummaryText(input);assert.doesNotMatch(text,/广告带来的|转化率|顺序漏斗完成率/);assert.match(text,/本期自然搜索新用户/);
});
