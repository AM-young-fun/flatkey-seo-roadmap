#!/usr/bin/env node
// Prepare only: exact source file -> immutable task/approval outbox. Never approves or publishes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {workflowTaskSchema,workflowApprovalSchema,approvalReviewReadiness}=require('../src/lib/seo-workflow.ts');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function buildPageReview(input,content,beforeContent,now=new Date()) {
 const {version=0,...raw}=input.task;
 delete raw.updatedAt; delete raw.recordedAt;
 if(!Number.isSafeInteger(version)||version<0)throw Error('invalid_task_version');
 const task=workflowTaskSchema.parse(raw);
 if(input.screenshots?.some(row=>!['desktop','mobile'].includes(row.viewport)))throw Error('invalid_screenshot_viewport');
 const approvalVersion=input.approvalVersion??0;if(!Number.isSafeInteger(approvalVersion)||approvalVersion<0)throw Error('invalid_approval_version');
 if(!task.pageUrl||!(task.language||input.language)||!['blog','landing','optimization','cluster','technical'].includes(task.kind))throw Error('page_task_required');
 if(typeof content!=='string'||!content.trim()||content.length>120000)throw Error('invalid_content');
 const contentVersion='sha256:'+hash(content),suffix=hash(task.id+':'+contentVersion).slice(0,24),stamp=input.preparedAt??now.toISOString();
 const evidence=[{label:'完整审稿内容 '+contentVersion,artifact:path.resolve(input.contentFile),observedAt:stamp},...(input.screenshots??[]).map(row=>({label:(row.viewport==='desktop'?'桌面截图 ':'手机截图 ')+contentVersion,url:row.url,observedAt:stamp}))];
 const item={id:'item-'+suffix,taskId:task.id,operation:input.operation,pageUrl:task.pageUrl,language:task.language||input.language,contentVersion,baseContentVersion:input.baseContentVersion??null,
  changeSummary:input.changeSummary,beforeSummary:input.beforeSummary??null,afterSummary:input.afterSummary,draftUrl:null,previewUrl:input.previewUrl??null,previewContentVersion:input.previewContentVersion??null,
  reviewContent:content,reviewFormat:input.reviewFormat??'markdown',beforeContent:beforeContent??null,evidence};
 const readiness=approvalReviewReadiness(item);
 // Staging deployment must identify exactly which source version is being reviewed.
 if(readiness.ready&&input.previewContentVersion!==contentVersion)throw Error('preview_version_not_bound');
 const approval=workflowApprovalSchema.parse({id:'approval-'+suffix,weekStart:task.weekStart,siteDomain:task.siteDomain,...(task.channel?{channel:task.channel}:{}),title:task.title+' · 页面审批',requestedBy:task.owner,
  submittedAt:readiness.ready?stamp:null,status:readiness.ready?'pending':'draft',items:[item],decisions:[],supersedesApprovalIds:input.supersedesApprovalIds??[],evidence});
 const nextTask=workflowTaskSchema.parse({...task,status:readiness.ready?'review_pending':'drafting',contentVersion,evidence:[...task.evidence,...evidence],nextAction:readiness.ready?'人工核验测试页面、截图和具体版本后决定；当前未批准。':'补齐'+readiness.missing.join('、')+'并绑定预览版本，再提交审批。'});
 return {contentVersion,readiness,commands:[{requestId:'prepare-task-'+suffix+':v'+version,action:'save_task',expectedVersion:version,record:nextTask},{requestId:'prepare-approval-'+suffix+':v'+approvalVersion,action:'save_approval',expectedVersion:approvalVersion,record:approval}]};
}
function writeExact(file,content){try{fs.writeFileSync(file,content,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST'||fs.readFileSync(file,'utf8')!==content)throw Error('output_version_conflict');}}
function run(){const args=Object.fromEntries(process.argv.slice(2).map(arg=>arg.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));if(!args.manifest||!args.out)throw Error('manifest_and_out_required');
 const input=JSON.parse(fs.readFileSync(args.manifest,'utf8'));const result=buildPageReview(input,fs.readFileSync(input.contentFile,'utf8'),input.beforeFile?fs.readFileSync(input.beforeFile,'utf8'):null);
 fs.mkdirSync(args.out,{recursive:true,mode:0o700});const output=path.resolve(args.out,'page-review.commands.json');writeExact(output,JSON.stringify(result.commands,null,2)+'\n');
 const summary={mode:'prepared_only_not_submitted',taskId:input.task.id,contentVersion:result.contentVersion,status:result.readiness.ready?'pending':'draft',missing:result.readiness.missing,commands:output,previewVerification:'版本来自提供的部署回执；本脚本不把存在链接等同线上验收。',next:'通过 seo-workflow-bridge.cjs 导入；人工批准后另行发布，发布前再次 approval-check。'};
 fs.writeFileSync(path.join(args.out,'page-review.readiness.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(summary));
}
module.exports={buildPageReview};if(require.main===module){try{run();}catch(error){console.error(JSON.stringify({status:'blocked',error:error.name==='ZodError'?'invalid_review_manifest':error.message}));process.exitCode=1;}}
