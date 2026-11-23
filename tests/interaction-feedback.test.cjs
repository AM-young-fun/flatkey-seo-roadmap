const assert = require('node:assert/strict'), {test} = require('node:test');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {createInteractionFeedback, interactionFeedback} = require('../src/lib/interaction-feedback.ts');

test('finishing one concurrent activity cannot hide another; completion is idempotent', () => {
  const ui = createInteractionFeedback(() => 4000); let changes=0;
  const unsubscribe=ui.subscribe(()=>changes++);
  const page=ui.begin('navigation','Opening'), data=ui.begin('read','Reading');
  assert.equal(ui.snapshot().activities.length,2);
  page(); assert.equal(ui.snapshot().activities.length,1);
  assert.equal(ui.snapshot().activities[0].kind,'read');
  const snapshot=ui.snapshot();page();assert.equal(ui.snapshot(),snapshot);
  data();assert.equal(ui.snapshot().activities.length,0);
  assert.equal(changes,4);unsubscribe();
});
test('an older success-dismiss timer cannot remove a newer error notice', () => {
  const ui=createInteractionFeedback();ui.notify('success','Saved');const first=ui.snapshot().notice.id;
  ui.notify('error','Not confirmed');const error=ui.snapshot().notice;
  ui.dismiss(first);assert.equal(ui.snapshot().notice,error);
  ui.dismiss(error.id);assert.equal(ui.snapshot().notice,null);
  assert.equal(ui.serverSnapshot().notice,null);
});

test('a user action clears a previous notice while a background read does not erase it',()=>{
  const ui=createInteractionFeedback();ui.notify('error','Previous failure');
  const reading=ui.begin('read','Reading');assert.equal(ui.snapshot().notice.message,'Previous failure');reading();
  const retry=ui.begin('action','Retrying');assert.equal(ui.snapshot().notice,null);retry();
});

test('the action guard blocks same-frame double submissions, unlocks after settlement, and releases activity on unmount', () => {
  const hookFile=path.resolve(__dirname,'../src/components/useActionFeedback.ts');
  const slots=[], cleanups=[];let cursor=0;
  const react={
    useState(initial){const n=cursor++;if(!(n in slots))slots[n]=initial;return[slots[n],v=>{slots[n]=v;}];},
    useRef(initial){const n=cursor++;if(!(n in slots))slots[n]={current:initial};return slots[n];},
    useCallback:fn=>fn,useEffect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup);},
  };
  const original=Module._load;
  Module._load=function(name,parent,...rest){if(parent?.filename===hookFile){if(name==='react')return react;if(name==='@/lib/interaction-feedback')return{interactionFeedback};}return original.call(this,name,parent,...rest);};
  let useActionFeedback;try{({useActionFeedback}=require(hookFile));}finally{Module._load=original;}
  const ui=useActionFeedback('Saving');let writes=0;
  const click=()=>{if(ui.start())writes++;};click();click();click();
  assert.equal(writes,1);assert.equal(interactionFeedback.snapshot().activities.length,1);
  ui.finish();assert.equal(interactionFeedback.snapshot().activities.length,0);click();assert.equal(writes,2);
  cleanups.forEach(cleanup=>cleanup());assert.equal(interactionFeedback.snapshot().activities.length,0);
  assert.equal(interactionFeedback.snapshot().notice,null,'cleanup cannot invent a success');
});
