#!/usr/bin/env node
"use strict";
// Explicit archived inputs only. This CLI contains no fetch, credentials,
// production writes, scheduler entry point or sending capability.
const fs=require("node:fs/promises"),path=require("node:path"),Module=require("node:module");
const {readDailyScalarEvidence,assembleDailyDashboardPackage,saveDailyDashboardPackage,canonical,hash}=require("./lib/seo-daily-dashboard-package.cjs");
let bootstrapped=false;
function bootstrap(){
 if(bootstrapped)return;bootstrapped=true;
 const ts=require("typescript"),root=path.resolve(__dirname,".."),prior=Module._resolveFilename;
 Module._resolveFilename=function(name,parent,...args){return prior.call(this,name.startsWith("@/")?path.join(root,"src",name.slice(2)):name,parent,...args);};
 require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(require("node:fs").readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
}
/** Shared by the original report entry point after resumption. These explicit
 * paths are archived inputs; preparation never loads credentials or sources. */
async function prepareArchivedDailyDashboard(options,{now=new Date()}={}){
 bootstrap();
 const read=async file=>JSON.parse(await fs.readFile(file,"utf8")),raw=await read(options.base),base=raw.report??raw,archive=await read(options.analytics);
 const {PILLAR_PAGE_GROUPS}=require("../src/lib/weekly-page-visitors.ts"),{DAILY_SEO_PAGE_GROUPS}=require("../src/lib/daily-seo-page-groups.ts"),{FLATKEY_ENTRY_HOSTS}=require("../src/lib/ga4-host-scope.ts");
 const {CLUSTER_SITES}=require("../src/lib/seo-cluster-sites.ts"),{analyticsObservationSchema,scopedAnalytics}=require("../src/lib/seo-analytics.ts");
 const {dailyDashboardCommandSchema,buildDailyDashboardSeoDigest}=require("../src/lib/seo-daily-dashboard.ts");
 const scalarEvidence=await readDailyScalarEvidence(path.resolve(options.scalars),{pillars:PILLAR_PAGE_GROUPS,pageGroups:DAILY_SEO_PAGE_GROUPS,entryHosts:FLATKEY_ENTRY_HOSTS},base.reportPeriod?.start,now);
 const pkg=assembleDailyDashboardPackage({baseReport:base,analyticsRows:Array.isArray(archive)?archive:archive.rows,scalarEvidence,siteDefinitions:[{domain:"flatkey.ai",ga4:"541304395",gsc:"sc-domain:flatkey.ai",ga4TimeZone:"America/Los_Angeles"},...CLUSTER_SITES],parseAnalytics:raw=>{const value={...raw};if(value.country==="all")delete value.country;const parsed=analyticsObservationSchema.safeParse(value);return parsed.success?scopedAnalytics([parsed.data])[0]??null:null;},now});
 dailyDashboardCommandSchema.parse(pkg.command);const report=buildDailyDashboardSeoDigest(base,pkg.command,now);
 return{pkg,report};
}
/** The existing authorized entry point supplies its normal API transport. There
 * is no implicit network adapter, approval, scheduler or sending operation. */
async function savePreparedDailyDashboard(pkg,{api,now=new Date()}){
 bootstrap();const {buildDailyDashboardSeoDigest,sameDailyDashboardDigest}=require("../src/lib/seo-daily-dashboard.ts");
 return saveDailyDashboardPackage(pkg,{api,build:buildDailyDashboardSeoDigest,compare:sameDailyDashboardDigest,now});
}
async function run(){
 const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf("=");if(!arg.startsWith("--")||i<0)throw Error("only_explicit_offline_file_options_supported");return[arg.slice(2,i),arg.slice(i+1)];}));
 if(Object.keys(options).some(key=>!["base","analytics","scalars","out","as-of"].includes(key))||!["base","analytics","scalars","out"].every(key=>options[key]))throw Error("usage_base_analytics_scalars_out_required_offline_only");
 const now=options["as-of"]?new Date(options["as-of"]):new Date();if(!Number.isFinite(now.getTime())||now.getTime()>Date.now())throw Error("invalid_offline_as_of");
 const {pkg,report}=await prepareArchivedDailyDashboard(options,{now});
 const directory=path.resolve(options.out),prefix=`${pkg.provenance.sourceDay}.${hash(pkg.command).slice(0,16)}`;await fs.mkdir(directory,{recursive:true,mode:0o700});
 for(const[suffix,value]of[["package",pkg],["request",pkg.command],["provenance",pkg.provenance],["preview",report]]){
  const file=path.join(directory,`${prefix}.${suffix}.json`),text=suffix==="provenance"?canonical(value):JSON.stringify(value,null,2)+"\n";
  try{await fs.writeFile(file,text,{flag:"wx",mode:0o600});}catch(error){if(error.code!=="EEXIST"||(suffix==="provenance"?await fs.readFile(file,"utf8")!==text:canonical(JSON.parse(await fs.readFile(file,"utf8")))!==canonical(value)))throw error;}
 }
 console.log(JSON.stringify({mode:pkg.mode,sourceDay:pkg.provenance.sourceDay,businessDate:pkg.provenance.businessDate,previewId:report.id,complete:pkg.complete,missing:pkg.missing.length,packageFile:path.join(directory,prefix+".package.json"),requests:0,notifications:0}));
}
if(require.main===module)run().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={bootstrap,prepareArchivedDailyDashboard,savePreparedDailyDashboard,run};
