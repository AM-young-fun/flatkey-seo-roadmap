#!/usr/bin/env node
// Read-only GitHub collection by default. --apply imports private SEO evidence, never publishes repository content.
const fs = require('node:fs/promises'), path = require('node:path'), {execFile} = require('node:child_process'), ts = require('typescript'), syncfs = require('node:fs');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(syncfs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {PROMPT_REPOSITORIES,githubChannelSchema,githubChannelId}=require('../src/lib/seo-github-channel.ts');
const arg=name=>process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1);
const shift=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
async function github(route){
 const token=process.env.GITHUB_CHANNEL_TOKEN?.trim();
 if(token){const r=await fetch('https://api.github.com/'+route,{headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('github_http_'+r.status);return r.json();}
 return new Promise((resolve,reject)=>execFile('gh',['api',route],{timeout:30000,maxBuffer:2000000},(error,stdout)=>{if(error)return reject(Error('github_cli_unavailable_or_forbidden'));try{resolve(JSON.parse(stdout));}catch{reject(Error('github_invalid_json'));}}));
}
function parseTraffic(result,key){
 if(result.status!=='fulfilled')return {status:'unavailable',count:null,uniques:null,days:[],reason:result.reason?.message||'github_unavailable'};
 const v=result.value;if(!Array.isArray(v[key]))throw Error('github_invalid_traffic');
 return {status:'ok',count:v.count,uniques:v.uniques,days:v[key].map(r=>({date:r.timestamp.slice(0,10),count:r.count,uniques:r.uniques})),reason:null};
}
function auditLinks(result,repository){
 if(result.status!=='fulfilled'||result.value.encoding!=='base64')return {status:'unavailable',flatkeyLinks:null,attributedLinks:null,reason:'readme_unavailable'};
 const text=Buffer.from(result.value.content,'base64').toString('utf8'),links=new Set();
 for(const raw of text.match(/https:\/\/(?:www\.|console\.)?flatkey\.ai[^\s<>"'`)\]]*/g)||[]){try{const u=new URL(raw.replace(/&amp;/g,'&'));if(!/^\/(?:assets|api|v1)(?:\/|$)/.test(u.pathname))links.add(u.href);}catch{ /* Ignore malformed non-navigation text. */ }}
 let attributed=0;for(const raw of links){const u=new URL(raw);if(u.searchParams.get('utm_source')==='github'&&u.searchParams.get('utm_medium')==='referral'&&u.searchParams.get('utm_campaign')===repository.split('/')[1])attributed++;}
 return {status:'ok',flatkeyLinks:links.size,attributedLinks:attributed,reason:null};
}
function referralWindows(date,now=new Date()){
 const propertyToday=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(now),closedDay=shift(propertyToday,-1);
 const friday=shift(date,-((new Date(date+'T00:00:00Z').getUTCDay()+2)%7));
 return [{start:closedDay,end:closedDay},{start:shift(friday,-7),end:shift(friday,-1)}];
}
async function run(){
 const apply=process.argv.includes('--apply'),output=path.resolve(arg('--out')||'.local/github-channel'),now=new Date(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now),date=arg('--date')||today;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date!==today)throw Error('collection_date_must_be_today');
 const platform=new URL(process.env.SEO_PLATFORM_ORIGIN||'https://flatkey-seo-roadmap.vercel.app');
 if(platform.origin!=='https://flatkey-seo-roadmap.vercel.app'&&!['localhost','127.0.0.1'].includes(platform.hostname))throw Error('unexpected_platform_origin');
 if(apply&&!process.env.SEO_IMPORT_TOKEN)throw Error('missing_import_token');
 const api=async(route,body)=>{const r=await fetch(platform.origin+route,{method:body?'POST':'GET',headers:{authorization:'Bearer '+process.env.SEO_IMPORT_TOKEN,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('seo_api_'+r.status);return r.json();};
 await fs.mkdir(output,{recursive:true,mode:0o700});
 const windows=referralWindows(date,now);
 const summaries=[];
 for(const repository of PROMPT_REPOSITORIES){
  const r=await Promise.allSettled([github('repos/'+repository),github('repos/'+repository+'/traffic/views?per=day'),github('repos/'+repository+'/traffic/clones?per=day'),github('repos/'+repository+'/readme')]);
  const meta=r[0].status==='fulfilled'?r[0].value:null,referrals=[];
  if(apply)for(const w of windows){try{const response=await api('/api/seo/github?collect=referrals&repository='+encodeURIComponent(repository)+'&start='+w.start+'&end='+w.end);referrals.push(response.record);}catch{referrals.push({...w,timezone:'America/Los_Angeles',status:'unavailable',sessions:null,users:null,observedAt:now.toISOString(),reason:'ga4_platform_source_unavailable'});}}
  const record=githubChannelSchema.parse({version:1,kind:'github-prompt-channel',repository,observedAt:now.toISOString(),timezone:'UTC',stars:meta?.stargazers_count??null,forks:meta?.forks_count??null,metadataStatus:meta?'ok':'unavailable',metadataReason:meta?null:'github_metadata_unavailable',views:parseTraffic(r[1],'views'),clones:parseTraffic(r[2],'clones'),referrals,linkAudit:auditLinks(r[3],repository)});
  const id=githubChannelId(record),file=path.join(output,date+'.'+repository.split('/')[1]+'.'+id.slice(-12)+'.json');await fs.writeFile(file,JSON.stringify(record,null,2)+'\n',{mode:0o600});
  let stored=false;if(apply){const receipt=await api('/api/seo/github',record);if(receipt.stored!==true||receipt.storage!=='database'||receipt.id!==id||githubChannelId(receipt.record)!==id)throw Error('github_import_receipt_mismatch');const read=await api('/api/seo/github?start='+shift(date,-14)+'&end='+date);if(!read.records?.some(row=>githubChannelId(row)===id))throw Error('github_readback_missing');stored=true;await fs.writeFile(file+'.receipt.json',JSON.stringify({id,stored,storage:'database',verifiedAt:new Date().toISOString()}),{mode:0o600});}
  summaries.push({repository,id,file,stored,metadata:record.metadataStatus,views:record.views.status,clones:record.clones.status,referrals:record.referrals.map(v=>({start:v.start,end:v.end,status:v.status})),mode:apply?'collected_and_imported':'local_read_only_archive'});
 }
 console.log(JSON.stringify({date,repositories:summaries}));
}
module.exports={parseTraffic,auditLinks,referralWindows};if(require.main===module)run().catch(e=>{console.error(JSON.stringify({status:'blocked',error:e.name==='ZodError'?'invalid_github_response':e.message}));process.exitCode=1;});
