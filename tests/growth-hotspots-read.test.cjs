const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
const root=path.resolve(__dirname,".."),original=Module._load;
let allowed=false,reads=0,items=[];
Module._load=function(name,parent,...rest){
  if(name==="@/lib/seo-workflow-http")return{authorizeWorkflow:async()=>{if(!allowed)throw new Error("unauthorized");return{actor:"human",localPreview:false}},workflowHeaders:{"Cache-Control":"private, no-store"},workflowErrorResponse:()=>Response.json({message:"请先登录"},{status:401})};
  if(name==="@/lib/services/growth-hotspots")return{loadGrowthHotspotView:async()=>{reads++;return{version:"growth-hotspots-v9",items}}};
  return original.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...rest);
};
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const route=require("../src/app/api/seo/growth/hotspots/route.ts");
test("unauthenticated hotspot reads cannot touch the source records",async()=>{allowed=false;reads=0;assert.equal((await route.GET(new Request("https://seo.test/api/seo/growth/hotspots"))).status,401);assert.equal(reads,0);});
test("hotspot read rejects mutation/filter parameters and has no write method",async()=>{allowed=true;reads=0;const response=await route.GET(new Request("https://seo.test/api/seo/growth/hotspots?approve=1"));assert.equal(response.status,400);assert.equal(reads,0);assert.equal(route.POST,undefined);assert.equal(route.DELETE,undefined);});
test("authorized projection is private, does not cache or schedule a background run",async()=>{allowed=true;reads=0;const response=await route.GET(new Request("https://seo.test/api/seo/growth/hotspots"));assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal(reads,1);assert.deepEqual((await response.json()).items,[]);});

test("hotspot pagination preserves the original projection and order", async () => {
  allowed = true;
  const url = "https://seo.test/api/seo/growth/hotspots";
  items = Array.from({ length: 12 }, (_, index) => ({ id: `hotspot-${index}`, stage: "expired", taskIds: [`original-${index}`] }));
  try {
    const legacy = await (await route.GET(new Request(url))).json();
    assert.deepEqual(legacy, { version: "growth-hotspots-v9", items });
    const first = await (await route.GET(new Request(`${url}?page=1`))).json();
    const second = await (await route.GET(new Request(`${url}?page=2`))).json();
    assert.deepEqual(first.pagination, { page: 1, total: 12, pageCount: 2 });
    assert.deepEqual(second.pagination, { page: 2, total: 12, pageCount: 2 });
    assert.equal(first.items.length, 10);
    assert.deepEqual([...first.items, ...second.items], items);
    assert.deepEqual(await (await route.GET(new Request(`${url}?page=99`))).json(), second);
    const before = reads;
    for (const query of ["page=0", "page=1.5", "page=", "page=1&page=2", "page=2&approve=1"]) {
      assert.equal((await route.GET(new Request(`${url}?${query}`))).status, 400);
    }
    assert.equal(reads, before);
  } finally { items = []; }
});
