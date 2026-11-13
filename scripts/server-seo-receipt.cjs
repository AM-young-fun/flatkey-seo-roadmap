const REPOSITORY = "AM-young-fun/flatkey-seo-roadmap";
function collectionReceipt({ runId, attempt = "1", sha, startedAt, completedAt, result, error }) {
  if (!/^\d+$/.test(runId ?? "") || !/^\d+$/.test(attempt) || !/^[a-f0-9]{40}$/.test(sha ?? "")) throw Error("invalid_collection_run_identity");
  const day = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai"}).format(new Date(startedAt));
  const week = new Date(day+"T00:00:00Z"); week.setUTCDate(week.getUTCDate()-((week.getUTCDay()+6)%7));
  const failed = Boolean(error || !result || result.failures || result.missing);
  const partial = !failed && Boolean(result.unavailable || result.qualityIssues?.length);
  const id = `server-collection-${runId}-${attempt}`;
  const dates = { 北京采集日期: result?.reportingDate ?? day };
  for (const scope of result?.windows ?? []) { dates[scope.site+":GA4_requested_end"]=scope.ga4.end; dates[scope.site+":GSC_requested_end"]=scope.gsc.end; }
  const summary = result ? `已导入并读回 ${result.imported} 条；${result.failures} 个失败；${result.unavailable} 个范围无源数据；${result.qualityIssues?.length ?? 0} 项指标覆盖限制；应有 ${result.expected} 条，缺失 ${result.missing} 条。` : "未取得完整采集结果。";
  return {action:"record_run",requestId:id,expectedVersion:0,record:{
    id,weekStart:week.toISOString().slice(0,10),stage:"SERVER_COLLECTION",scheduledFor:startedAt,startedAt,completedAt,
    status:failed?"failed":partial?"partial":"completed",owner:"GitHub Actions",taskIds:[],inputVersion:sha,
    evidence:[{label:summary,url:`https://github.com/${REPOSITORY}/actions/runs/${runId}`,observedAt:completedAt}],
    failureReason:failed?(error?"采集执行失败；以工作流日志为准。":"采集或读回有失败。")+summary:partial?summary:null,
    nextAction:failed?"排查失败源并重跑；不得补0或将失败写成成功。":partial?"保留无源数据范围说明，下一次采集继续检查。":"按每日08:30计划继续，持续核查数据日期。",
    checkedItems:result?.expected??0,completedItems:Math.max(0,(result?.expected??0)-(result?.missing??0)),costMicros:null,
    coverage:failed?"unknown":partial?"partial":"full",sourceDates:dates
  }};
}
async function saveCollectionReceipt(input) {
  if (!process.env.GITHUB_RUN_ID) return; // Local collection does not invent a GitHub receipt.
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY) throw Error("unexpected_collection_repository");
  const command=collectionReceipt({...input,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT||"1",sha:process.env.GITHUB_SHA});
  const r=await fetch("https://flatkey-seo-roadmap.vercel.app/api/seo/workflow",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+process.env.SEO_IMPORT_TOKEN},body:JSON.stringify(command),redirect:"error",signal:AbortSignal.timeout(60000)});
  const data=await r.json();
  if(!r.ok||data.record?.id!==command.record.id||data.record?.version!==1)throw Error("collection_receipt_not_verified");
  console.log(JSON.stringify({kind:"server-collection-receipt",id:data.record.id,status:data.record.status,version:data.record.version}));
}
module.exports={collectionReceipt,saveCollectionReceipt};
