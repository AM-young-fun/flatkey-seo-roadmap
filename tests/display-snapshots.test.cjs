const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...rest);};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
let row=null,builds=0,reads=0;
const prisma={
  $queryRaw:async (sql,...args)=>{
    if(sql.join('').includes('INSERT INTO')) {
      if(row && (row.leaseUntil || row.body && row.revision === row.builtRevision))return [];
      row??={body:null,revision:1,builtRevision:0,builtAt:null};row.leaseToken=args[1];row.leaseUntil=new Date(Date.now()+240000);return [{revision:row.revision}];
    }
    reads++;return row?[{...row}]:[];
  },
  $executeRaw:async(sql,...args)=>{
    const text=sql.join('');
    if(text.includes('revision = revision + 1')){if(row)row.revision++;return 1;}
    if(text.includes('SET body =')) {if(row.leaseToken!==args[5])return 0;Object.assign(row,{body:args[0],keywordRows:args[1],builtRevision:args[2],builtAt:args[3],leaseToken:null,leaseUntil:null});return 1;}
    if(text.includes("BUILD_FAILED")){if(row.leaseToken===args[1])Object.assign(row,{leaseToken:null,leaseUntil:null,lastError:'BUILD_FAILED'});return 1;}
    throw new Error('unexpected source write');
  },
};
const p=path.join(root,'src/lib/prisma.ts');require.cache[p]={id:p,filename:p,loaded:true,exports:{prisma}};
const mod=()=>{const p=path.join(root,'src/lib/services/display-snapshots.ts');delete require.cache[p];return require(p);};
const fixture={keywords:[{text:'same api',ranks:{US:1,JP:2,ES:null,BR:9},urls:['https://flatkey.ai/api','https://flatkey.ai/ja/api']}],total:1};
const spec={key:'display-v1:dashboard:all:0',build:async()=>{builds++;return {value:fixture,keywordRows:[{id:'same api'}]};}};
test('stored reads survive a fresh server instance without rebuilding or dropping country evidence',async()=>{
  row=null;builds=0;reads=0;
  let service=mod();let saved=await service.readDisplaySnapshot(spec);
  assert.deepEqual(JSON.parse(saved.body).keywords,fixture.keywords);assert.equal(builds,1);assert.equal(saved.stale,false);
  service=mod();await service.readDisplaySnapshot(spec);assert.equal(builds,1);assert.equal(reads,3);assert.ok(row.body.byteLength < saved.body.length);assert.equal(row.builtRevision,1);
});
test('only one durable lease can build and an invalidation during it is not lost',async()=>{
  row=null;const service=mod();let release;const gate=new Promise(resolve=>release=resolve);
  const building=service.rebuildDisplaySnapshot({...spec,build:async()=>{await gate;return {value:fixture};}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await service.rebuildDisplaySnapshot(spec),false);
  await service.invalidateDisplaySnapshots();release();await building;
  assert.equal(row.revision,2);assert.equal(row.builtRevision,1);assert.equal((await service.readDisplaySnapshot(spec)).stale,true);
});
test('a refresh failure retains the last valid body and releases its lease for retry',async()=>{
  const service=mod();const oldBody=Buffer.from(row.body);await service.invalidateDisplaySnapshots();
  await assert.rejects(service.rebuildDisplaySnapshot({...spec,build:async()=>{throw new Error('offline');}}));
  assert.deepEqual(row.body,oldBody);assert.equal(row.leaseToken,null);assert.equal(row.lastError,'BUILD_FAILED');
  assert.equal(await service.rebuildDisplaySnapshot(spec),true);assert.equal(row.revision,row.builtRevision);
});
