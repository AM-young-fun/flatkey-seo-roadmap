const assert=require("node:assert/strict"),{test}=require("node:test"),fs=require("node:fs"),ts=require("typescript"),echarts=require("echarts");
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {keywordGraphDimensions,keywordGraphViewport}=require("../src/lib/keyword-graph-viewport.ts");
const target=(width,height,isConnected=true)=>({clientWidth:width,clientHeight:height,isConnected});

test("detached, hidden and invalid chart dimensions wait instead of creating singular graph transforms",()=>{
 for(const dimensions of [target(0,420),target(390,0),target(0,0),target(-1,420),target(NaN,420),target(390,Infinity),target(390,420,false)]) assert.equal(keywordGraphDimensions(dimensions),null);
 assert.deepEqual(keywordGraphDimensions(target(390,420)),{width:390,height:420});
});
test("viewport persistence copies only valid roaming values without treating default null as a saved center",()=>{
 const input={zoom:2,center:[-12,"50%"]},result=keywordGraphViewport(input);
 assert.deepEqual(result,input);input.center[0]=999;assert.deepEqual(result.center,[-12,"50%"]);
 for(const zoom of [0,-1,NaN,Infinity,"2"]) assert.equal(keywordGraphViewport({zoom}).zoom,undefined);
 for(const center of [null,undefined,[1],[1,2,3],[NaN,0],[0,Infinity],["abc%",0]]) assert.equal(keywordGraphViewport({center}).center,undefined);
 assert.deepEqual(keywordGraphViewport({zoom:1,center:null}),{zoom:1});assert.deepEqual(keywordGraphViewport({center:[0,0]}),{center:[0,0]});
});
test("real ECharts graph survives all→JP→blog→all across hidden and 390px resize transitions",()=>{
 let saved={};
 for(const count of [1634,97,45,1634,1]){
  let chart;
  const observedSizes=[target(0,0),target(1120,560),target(0,560),target(390,0),target(390,420),target(390,420,false),target(0,0),target(1120,560),target(390,420)];
  const option={animation:false,series:[{type:"graph",layout:"none",left:"6%",top:"6%",width:"88%",height:"88%",roam:true,...saved,
   data:Array.from({length:count},(_,i)=>{const angle=i*Math.PI*(3-Math.sqrt(5)),radius=500*Math.sqrt((i+.5)/count);return{id:String(i),x:Math.cos(angle)*radius,y:Math.sin(angle)*radius};})}]};
  try {
   for(const observation of observedSizes){
    const size=keywordGraphDimensions(observation);
    if(!size) continue;
    if(!chart){chart=echarts.init(null,null,{renderer:"svg",ssr:true,...size});chart.setOption(option,true);}
    else if(chart.getWidth()!==size.width||chart.getHeight()!==size.height) chart.resize(size);
   }
   assert.equal(chart.getWidth(),390);assert.equal(chart.getHeight(),420);assert.equal(chart.getOption().series[0].data.length,count);
   saved=keywordGraphViewport(chart.getOption().series[0]);
  }finally{chart?.dispose();}
 }
});
