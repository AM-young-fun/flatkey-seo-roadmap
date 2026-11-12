const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {keywordGoalTask,matchingKeywordGoal,keywordGoalTaskHref}=require('../src/lib/keyword-goals.ts');
const input={keyword:'gpu rental',country:'US',siteDomain:'flatkey.ai',business:'GPU',pageUrl:'',owner:'负责人',dueDate:'2026-11-13',goal:'明确租用价格与操作步骤'};
test('one target saves one existing workflow task; URL chooses optimization without inventing research or approval',()=>{
 const landing=keywordGoalTask(input,'goal-1');assert.equal(landing.kind,'landing');assert.equal(landing.pageUrl,null);assert.equal(landing.weekStart,'2026-11-09');
 assert.equal(landing.status,'planned');assert.equal(landing.approval,null);assert.equal(landing.research,null);assert.deepEqual(landing.evidence,[]);
 const optimization=keywordGoalTask({...input,pageUrl:'https://flatkey.ai/gpu'},'goal-2');assert.equal(optimization.kind,'optimization');assert.equal(optimization.pageUrl,'https://flatkey.ai/gpu');
 const blog=keywordGoalTask({...input,pageUrl:'https://flatkey.ai/es/blog/gpu',country:'ES',keyword:'alquiler gpu'},'goal-3');assert.equal(blog.pageType,'blog');assert.equal(blog.language,'es-ES');
 assert.match(keywordGoalTaskHref(optimization),/taskType=optimization/);assert.match(keywordGoalTaskHref(landing),/taskType=landing/);
});
test('country is explicit, local keywords and owned HTTPS URLs are required',()=>{
 assert.equal(keywordGoalTask({...input,country:'BR',keyword:'aluguel gpu'},'goal-br').language,'pt-BR');
 assert.equal(keywordGoalTask({...input,country:'JP',keyword:'GPU レンタル'},'goal-jp').language,'ja');
 for(const pageUrl of ['https://evil.example/gpu','https://flatkey.ai:444/gpu','https://u:p@flatkey.ai/gpu','https://flatkey.ai/gpu#hash','http://flatkey.ai/gpu'])assert.throws(()=>keywordGoalTask({...input,pageUrl},'goal-bad'));
 assert.throws(()=>keywordGoalTask({...input,keyword:'中文关键词'},'goal-cn'));
});
test('reuses in-progress goal across weeks and preserves independent countries and completed work',()=>{
 const task={...keywordGoalTask(input,'old-task'),weekStart:'2026-11-02'},candidate=keywordGoalTask({...input,keyword:' GPU  rental '},'new-task');
 assert.equal(matchingKeywordGoal([task],candidate).id,'old-task');
 assert.equal(matchingKeywordGoal([{...task,country:'BR'}],candidate),undefined);
 assert.equal(matchingKeywordGoal([{...task,status:'verified'}],candidate),undefined);
});
test('navigation has only requested five work areas and legacy analysis deep links remain',()=>{
 const source=fs.readFileSync(require.resolve('../src/components/PageHeader.tsx'),'utf8');const nav=source.slice(source.indexOf('const workspaceLinks'),source.indexOf('] as const;'));
 for(const label of ['总览','工作任务','关键词目标','日周效果','定时任务'])assert.ok(nav.includes(label));
 for(const label of ['页面优化','页面审批','问题处理'])assert.ok(!nav.includes(label));
 const route=fs.readFileSync(require.resolve('../src/app/opportunities/page.tsx'),'utf8');assert.match(route,/params\.details/);assert.match(route,/params\.view === "new".*KeywordGoals/);assert.match(route,/return <KeywordDetails/);
});

test("cluster content follows verified site languages independently of the reporting country",()=>{
 const english=keywordGoalTask({...input,siteDomain:"rackrate.org",country:"ES",keyword:"gpu rental"}, "rackrate-es-en");
 assert.equal(english.language,"en"); assert.equal(english.country,"ES");
 const mochi=keywordGoalTask({...input,siteDomain:"mochichatbot.com",country:"JP",keyword:"AI チャット"}, "mochi-ja");
 assert.equal(mochi.language,"ja");
 const chinese=keywordGoalTask({...input,siteDomain:"mochichatbot.com",language:"zh-CN",keyword:"人工智能聊天"}, "mochi-zh");
 assert.equal(chinese.language,"zh-CN");
 const {workflowTaskSchema}=require("../src/lib/seo-workflow.ts");
 assert.throws(()=>workflowTaskSchema.parse({...english,language:"es-ES"}));
 assert.throws(()=>workflowTaskSchema.parse({...mochi,siteDomain:"flatkey.ai",language:"en"}));
});
