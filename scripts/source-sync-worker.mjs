// Standalone project worker. Run on a persistent host with a logged-in DWS
// CLI. It never reads browser cookies, calls DataForSEO, or writes DingTalk.
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseSheet, hash } from "./dws-sheet-parser.cjs";
const exec=promisify(execFile);
export async function runWorkerOnce(config, deps={}) {
  const base=new URL(config.baseUrl);
  if(base.protocol!=="https:" || base.username || base.password || base.pathname!=="/")throw new Error("WORKER_CONFIG_INVALID");
  if(!/^fk_worker_[\w-]{40,}$/.test(config.token))throw new Error("WORKER_CONFIG_INVALID");
  const post=deps.post??(async body=>{
    const response=await fetch(new URL("/api/automation/worker",base),{method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(60000),redirect:"error"});
    if(!response.ok)throw new Error(response.status===401?"WORKER_AUTH":"WORKER_REQUEST_FAILED");
    return response.json();
  });
  const cli=deps.cli??(async args=>{
    try {
      const {stdout}=await exec(config.dwsPath??"dws",[...args,...(config.profile?["--profile",config.profile]:[]),"--format","json"],{timeout:55000,maxBuffer:12*1024*1024});
      const result=JSON.parse(stdout);
      if(result.error||result.success===false)throw new Error("DWS_AUTH");
      return result;
    }catch(error){throw new Error(error?.message==="DWS_AUTH"?"DWS_AUTH":"SHEET_READ_FAILED");}
  });
  const {job}=await post({action:"claim"});
  if(!job)return false;
  const identity={jobId:job.id,leaseToken:job.leaseToken};
  try {
    // CLI inputs come from the fixed server source registry, never from cells.
    const {nodeId,sheetId,url}=job.source;
    const doc=await cli(["doc","info","--node",url]);
    const meta=doc.node??doc;
    if(meta.contentType!=="ALIDOC"||meta.extension!=="axls")throw new Error("SHEET_SCHEMA_CHANGED");
    const info=await cli(["sheet","info","--node",nodeId,"--sheet-id",sheetId]);
    const last=info.nonEmptyRange?.lastRow, column=info.nonEmptyRange?.lastColumn;
    if(!Number.isInteger(last)||last<2||last>10000||!/^([A-Z]|[A-Z]{2})$/.test(column)||info.mergedRanges?.length)throw new Error("SHEET_SCHEMA_CHANGED");
    const matrix=[];
    for(let start=1;start<=last;start+=30) {
      const end=Math.min(last,start+29),data=await cli(["sheet","range","read","--node",nodeId,"--sheet-id",sheetId,"--range",`A${start}:${column}${end}`,"--value-render-option","raw_value"]);
      if(!Array.isArray(data.cells)||data.cells.length!==end-start+1)throw new Error("SHEET_READ_FAILED");
      matrix.push(...data.cells.map(row=>row.map(cell=>cell?.value??"")));
    }
    const after=await cli(["sheet","info","--node",nodeId,"--sheet-id",sheetId]);
    const docAfter=await cli(["doc","info","--node",url]);
    const version=value=>{const item=value.node??value;return {nodeId:item.nodeId,updateTime:item.updateTime,extension:item.extension,contentType:item.contentType};};
    if(hash(info.nonEmptyRange)!==hash(after.nonEmptyRange)||hash(version(doc))!==hash(version(docAfter)))throw new Error("SHEET_CHANGED_DURING_READ");
    const rows=parseSheet(job.sourceId,matrix),collectedAt=new Date().toISOString();
    for(let start=0;start<rows.length;start+=30) {
      const chunk=rows.slice(start,start+30);
      await post({action:"batch",...identity,batch:{kind:"source-sync",action:"apply",requestId:`worker.${job.sourceId}.${hash(chunk)}`,targetDomain:"flatkey.ai",sourceId:job.sourceId,collectedAt,rows:chunk}});
    }
    await post({action:"complete",...identity,readRows:rows.length});
    return true;
  }catch(error) {
    const code=["DWS_AUTH","SHEET_SCHEMA_CHANGED","SHEET_CHANGED_DURING_READ"].includes(error.message)?error.message:"SHEET_READ_FAILED";
    await post({action:"fail",...identity,errorCode:code}).catch(()=>{});
    throw new Error(code);
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  // Keep pairing credentials outside the repository. Never pass them on the
  // command line or log document contents / provider errors.
  const file=process.env.SOURCE_WORKER_CONFIG;
  if(!file)throw new Error("Set SOURCE_WORKER_CONFIG to a private JSON file");
  const config=JSON.parse(await readFile(file,"utf8"));
  let running=true;
  while(running) {
    try {let ran;do {ran=await runWorkerOnce(config);}while(ran);}catch(error){console.error(new Date().toISOString(),error.message);}
    running=!process.argv.includes("--once");
    if(running)await delay(60000);
  }
}
