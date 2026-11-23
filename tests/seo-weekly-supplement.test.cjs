const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
require.extensions[".ts"]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const model=require("../src/lib/seo-weekly-supplement.ts");
test("Thursday and Friday revisions share a note, following week stays separate",()=>{
  assert.equal(model.emptyWeeklySupplement("2026-11-19").id,model.emptyWeeklySupplement("2026-11-20").id);
  assert.notEqual(model.emptyWeeklySupplement("2026-11-19").id,model.emptyWeeklySupplement("2026-11-26").id);
});
test("saving a stale editor conflicts and validation rejects unexpected fields",()=>{
  const input={reportId:"seo-digest:2026-11-19:1234567890abcdef",expectedRevision:0,text:"补充\n第二行"};
  const next=model.nextWeeklySupplement(model.emptyWeeklySupplement("2026-11-19"),input);
  assert.equal(next.text,input.text);assert.equal(next.revision,1);
  assert.throws(()=>model.nextWeeklySupplement(next,input),/supplement_conflict/);
  assert.equal(model.weeklySupplementInput.safeParse({...input,approved:true}).success,false);
});
test("saved notes reload across revisions, keep history, and clear explicitly",async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"weekly-supplement-test-"));
  process.env.SEO_WEEKLY_SUPPLEMENT_PREVIEW_DIR=directory;
  const original=Module._load;
  Module._load=function(name,...rest){
    if(name==="@/lib/prisma")return {prisma:{}};
    return original.call(this,name,...rest);
  };
  let service;
  try{service=require("../src/lib/services/seo-weekly-supplement.ts");}finally{Module._load=original;}
  try{
    const reportId="seo-digest:2026-11-19:1234567890abcdef";
    await service.saveWeeklySupplement({reportId,expectedRevision:0,text:"本周补充 <script>文字</script>"},true);
    const loaded=await service.loadWeeklySupplement("seo-digest:2026-11-20:abcdef1234567890",true);
    assert.equal(loaded.text,"本周补充 <script>文字</script>");
    await assert.rejects(service.saveWeeklySupplement({reportId,expectedRevision:0,text:"旧窗口"},true),error=>error.status===409);
    await service.saveWeeklySupplement({reportId,expectedRevision:1,text:""},true);
    assert.equal((await service.loadWeeklySupplement(reportId,true)).text,"");
    assert.equal(fs.readdirSync(directory).length,2,"old saved revision retained");
  }finally{fs.rmSync(directory,{recursive:true,force:true});delete process.env.SEO_WEEKLY_SUPPLEMENT_PREVIEW_DIR;}
});
