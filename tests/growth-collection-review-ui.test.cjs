const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
const filename=path.resolve(__dirname,"../src/components/GrowthCollectionReview.tsx"),originalLoad=Module._load;
let slots=[],cursor=0,effects=[];
const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==="function"?initial():initial;return[slots[index],value=>{slots[index]=typeof value==="function"?value(slots[index]):value;}];},useEffect(effect){effects.push(effect);},useMemo(fn){return fn();},useCallback(fn){return fn;}};
function FeedbackButton(){};
Module._load=function(name,parent,...rest){if(parent?.filename===filename){if(name==="react")return react;if(name==="next/link")return {__esModule:true,default:"a"};if(name==="@/lib/serp-periods")return {serpPeriod:()=>({key:"2026-11-17"})};if(name==="./FeedbackButton")return {FeedbackButton};if(name.endsWith(".css"))return {__esModule:true,default:{}};}return originalLoad.call(this,name,parent,...rest);};
const m=new Module(filename,module);m.filename=filename;m.paths=module.paths;m._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);Module._load=originalLoad;
const render=()=>{cursor=0;effects=[];return m.exports.GrowthCollectionReview();};
function nodes(node){if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=="object")return[];return[node,...(Array.isArray(node.props?.children)?node.props.children:[node.props?.children]).flatMap(nodes)];}
const manifest={hash:"a".repeat(64),periodLabel:"本期",preparedAt:"2026-11-23T00:00:00Z",expiresAt:"2026-11-24T00:00:00Z",targets:[],reused:[],held:[],queries:[],maxCostMicros:6000};
const view={state:{id:"2026-11-17",version:7,manifest,approval:null,runId:null},run:null};
const button=(tree,label)=>nodes(tree).find(node=>node.type===FeedbackButton&&node.props.children===label);

test("reading the fee review only GETs; approval requires explicit confirmation and posts exact frozen version/hash/cap",async t=>{
 slots=[];let calls=[];t.mock.method(globalThis,"fetch",async(url,options={})=>{calls.push({url,options});return new Response(JSON.stringify(view),{status:200,headers:{"content-type":"application/json"}});});
 render();assert.equal(calls.length,0);await effects[0]();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);
 let tree=render(),approve=button(tree,"批准此清单及费用");assert.equal(approve.props.disabled,true);await approve.props.onClick();assert.equal(calls.length,1);
 const checkbox=nodes(tree).find(node=>node.type==="input"&&node.props.type==="checkbox");checkbox.props.onChange({target:{checked:true}});
 tree=render();approve=button(tree,"批准此清单及费用");assert.equal(approve.props.disabled,false);await approve.props.onClick();await new Promise(resolve=>setImmediate(resolve));
 const writes=calls.filter(call=>call.options.method==="POST");assert.equal(writes.length,1);const payload=JSON.parse(writes[0].options.body);assert.equal(payload.action,"approve");assert.equal(payload.manifestHash,manifest.hash);assert.equal(payload.maxCostMicros,6000);assert.equal(payload.expectedVersion,7);assert.equal(payload.periodKey,"2026-11-17");assert.equal(payload.allowSubmit,undefined);
 assert.equal(slots[4],false,"approval confirmation resets after the saved version is read back");
});
test("opening an approved manifest exposes no second approve or direct submit action",()=>{
 slots=["2026-11-17",{...view,state:{...view.state,approval:{actor:"human",maxCostMicros:6000}}},"",false,false,0];const tree=render();assert.equal(button(tree,"批准此清单及费用"),undefined);assert.ok(!nodes(tree).some(node=>node.props?.children==="立即付费采集"));
});
