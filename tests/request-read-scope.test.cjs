const assert = require('node:assert/strict'), {test}=require('node:test'), fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {withRequestReads,requestRead}=require('../src/lib/request-read-scope.ts');
test('concurrent HTTP scopes never share inputs; concurrent views within each scope do',async()=>{
  let calls=0;
  const run=value=>withRequestReads(async()=>{
    const read=()=>requestRead('same-key',async()=>{calls++;await new Promise(resolve=>setImmediate(resolve));return value;});
    assert.deepEqual(await Promise.all([read(),read(),read()]),[value,value,value]);
  });
  await Promise.all([run('first'),run('second')]);assert.equal(calls,2);
});
test('a failed request cannot poison the next one and unscoped reads stay fresh',async()=>{
  await assert.rejects(withRequestReads(()=>requestRead('same-key',async()=>{throw Error('offline');})),/offline/);
  assert.equal(await withRequestReads(()=>requestRead('same-key',async()=>17)),17);
  let calls=0;const read=()=>requestRead('same-key',async()=>++calls);
  assert.deepEqual(await Promise.all([read(),read()]),[1,2]);
});
