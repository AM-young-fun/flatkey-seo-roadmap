const assert=require("node:assert/strict");const {test}=require("node:test");
const {parseSheet}=require("../scripts/dws-sheet-parser.cjs");
const matrix=[["编号","主关键词","副关键词（已确定）","生成状态","文章链接","language","title","slug","Ahrefs 优先副关键词"],["12","Claude API","claude pricing;claude pricing","已生成","https://flatkey.ai/claude-api","English","Claude","claude-api","not a confirmed keyword"]];
test("source parser uses stable IDs and confirmed columns without inventing page verification",()=>{
  const rows=parseSheet("api_main",matrix);assert.equal(rows[0].rowKey,"id:12:en");assert.equal(rows[0].keywords.length,2);
  assert.ok(rows[0].keywords.every(row=>row.relevance==="REVIEW"&&!row.pageIntentMatched));assert.equal(rows[0].publication.pageVerified,false);
  assert.ok(!JSON.stringify(rows).includes("not a confirmed keyword"));
  assert.throws(()=>parseSheet("api_main",[...matrix,matrix[1]]),/SHEET_SCHEMA_CHANGED/);
  assert.throws(()=>parseSheet("api_main",[matrix[0],matrix[1].map((value,i)=>i===0?"":i===7?"":value)]),/SHEET_SCHEMA_CHANGED/);
});
test("worker completes only after real full reads and successful batch saves; ignores transient log IDs",async()=>{
  const {runWorkerOnce}=await import("../scripts/source-sync-worker.mjs"),events=[];
  const config={baseUrl:"https://example.com/",token:"fk_worker_"+"a".repeat(43)};
  const job={id:"job",leaseToken:"123",sourceId:"api_main",source:{nodeId:"fixed",sheetId:"fixed",url:"https://alidocs.dingtalk.com/i/nodes/fixed"}};
  let counter=0;
  const cli=async args=>args[0]==="doc"?{contentType:"ALIDOC",extension:"axls",nodeId:"fixed",updateTime:1,logId:String(counter++)}:args[1]==="info"?{nonEmptyRange:{lastRow:2,lastColumn:"I"},mergedRanges:[]}:{cells:matrix.map(row=>row.map(value=>({value})))};
  const post=async body=>{events.push(body);return body.action==="claim"?{job}:{status:"SAVED"};};
  assert.equal(await runWorkerOnce(config,{cli,post}),true);
  assert.deepEqual(events.map(row=>row.action),["claim","batch","complete"]);assert.equal(events.at(-1).readRows,1);
  const failed=[];
  await assert.rejects(()=>runWorkerOnce(config,{cli,post:async body=>{failed.push(body.action);if(body.action==="batch")throw new Error("fail");return body.action==="claim"?{job}:{};}}));
  assert.ok(!failed.includes("complete"));assert.equal(failed.at(-1),"fail");
});
