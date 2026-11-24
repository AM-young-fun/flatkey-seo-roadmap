#!/usr/bin/env node
"use strict";
// Explicit saved inputs only. No credentials, provider calls, database writes,
// snapshot replacement, schedule mutation or network adapter.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),Module=require("node:module"),ts=require("typescript");
const root=path.resolve(__dirname,".."),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...args){return resolve.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...args);};
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
function main(){
 const options={};for(const arg of process.argv.slice(2)){const at=arg.indexOf("=");if(!arg.startsWith("--")||at<0)throw Error("explicit_saved_file_options_required");options[arg.slice(2,at)]=arg.slice(at+1);}
 if(Object.keys(options).some(key=>!["cohorts","tasks","out","start","end"].includes(key))||!["cohorts","tasks","out","start","end"].every(key=>options[key]))throw Error("usage_cohorts_tasks_start_end_out_required");
 const {serpCheckTrendFrames,serpTrendRange}=require("../src/lib/ranking-trends.ts"),{projectHistoricalWordLanguage}=require("../src/lib/ranking-language-history.ts");
 const {reviewGrowthLanguage}=require("../src/lib/growth-workspace.ts"),{approvedDiagnosticWordLanguages}=require("../src/lib/growth-word-language-evidence.ts");
 const {isOwnedBrandKeyword}=require("../src/lib/keyword-market-policy.ts"),{GROWTH_MARKET_LANGUAGES}=require("../src/lib/seo-growth-markets.ts"),{REGION_CODES}=require("../src/lib/seo.ts");
 const range=serpTrendRange(options.start,options.end),sourceFiles=[options.cohorts,options.tasks].map(file=>{const absolute=path.resolve(file),bytes=fs.readFileSync(absolute);return{path:absolute,sha256:hash(bytes),value:JSON.parse(bytes.toString())};});
 const cohorts=sourceFiles[0].value.cohorts??sourceFiles[0].value,tasks=sourceFiles[1].value.tasks??sourceFiles[1].value;
 if(!Array.isArray(cohorts)||!Array.isArray(tasks))throw Error("saved_cohort_and_task_arrays_required");
 if(sourceFiles.some(source=>source.value.partial===true||source.value.pagination))throw Error("paged_saved_exports_must_be_fully_assembled_before_review");
 const word=value=>value.normalize("NFKC").trim().replace(/\s+/gu," ").toLowerCase(),proofs=new Map(approvedDiagnosticWordLanguages().map(row=>[`${row.site}:${row.keywordId}:${word(row.keyword)}`,row]));
 const markets=REGION_CODES.map(region=>({region,frames:serpCheckTrendFrames([],tasks.filter(task=>task.region===region),range.start,range.end,{cohorts:cohorts.filter(cohort=>!cohort.regions||cohort.regions.includes(region)),site:"all"})}));
 const projection=projectHistoricalWordLanguage(markets,(target,country)=>{const language=GROWTH_MARKET_LANGUAGES[country];return{...reviewGrowthLanguage(target.keyword,country,language,undefined,proofs.get(`${target.siteDomain}:${target.keywordId}:${word(target.keyword)}`)),queryLanguage:language};},isOwnedBrandKeyword);
 const rulesFiles=["src/lib/ranking-language-history.ts","src/lib/ranking-trends.ts","src/lib/serp-results.ts","src/lib/growth-workspace.ts","src/lib/keyword-market-policy.ts","src/lib/growth-word-language-evidence.ts","src/lib/data/ranking-word-language-review-20261123.json","src/lib/data/growth-diagnostic-word-language-evidence-20261123.json"].map(file=>({path:file,sha256:hash(fs.readFileSync(path.join(root,file)))}));
 const originalCohorts=cohorts.map(cohort=>({runId:cohort.runId,periodKey:cohort.periodKey,runScope:cohort.runScope,runTargetCount:cohort.runTargetCount,frozenTargetCount:cohort.targets?.length,regions:cohort.regions}));
 const output={version:"historical-language-review-v1",status:"offline_review_not_published",sourceFiles:sourceFiles.map(({path,sha256})=>({path,sha256})),rulesFiles,originalCohorts,range,...projection,providerRequests:0,productionWrites:0};
 const encoded=JSON.stringify(output,null,2)+"\n",out=path.resolve(options.out);fs.mkdirSync(out,{recursive:true,mode:0o700});const file=path.join(out,`historical-language-review.${hash(encoded).slice(0,16)}.json`);if(fs.existsSync(file)){if(fs.readFileSync(file,"utf8")!==encoded)throw Error("immutable_output_conflict");}else fs.writeFileSync(file,encoded,{flag:"wx",mode:0o600});
 for(const source of sourceFiles)if(hash(fs.readFileSync(source.path))!==source.sha256)throw Error("source_changed_during_review");
 console.log(JSON.stringify({status:output.status,file,periods:projection.periods.map(period=>({key:period.periodKey,label:period.label,rawRanked:period.rawRanked,rankedWords:period.rankedWords,unknownLanguageWords:period.unknownLanguageWords,countries:period.countries})),providerRequests:0,productionWrites:0}));
}
try{main();}catch(error){console.error(error.message);process.exitCode=1;}
