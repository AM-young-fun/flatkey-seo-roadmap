export type SerpCollectionProgress = {
  runId: string; periodLabel: string; status: string; totalKeywords: number; completedKeywords: number;
  totalQueries: number; completedQueries: number; submittedQueries: number; waitingQueries: number;
  plannedQueries: number; processingQueries: number; failedQueries: number;
  pendingTasks?: {id:string;keyword:string;region:string;state:string;errorCode:string|null;waitMinutes:number;lastPolledMinutesAgo:number|null}[];
  startedAt: string; completedAt: string | null; checkedAt: string;
};

export const collectionIsActive = (status: string) => ["PLANNED", "RUNNING"].includes(status);

export function collectionPercent(completed: number,total: number) {
  const value=total > 0 ? Math.max(0,Math.min(100,completed/total*100)) : 0;
  return value > 99 && value < 100 ? `${Math.min(99.99,value).toFixed(2)}%` : `${Math.floor(value)}%`;
}
export function collectionWaitingReason(code:string|null|undefined) {
  if(code === "PROVIDER_NOT_READY")return "服务商尚未返回结果";
  if(code === "POLL_RETRY_FREE" || code?.startsWith("POLL_HTTP_"))return "读取结果未成功，正在免费重试";
  if(code === "POLL_INVALID_RECEIPT")return "返回内容需重新核对";
  if(code?.startsWith("ACCOUNT_"))return "接口连接需处理";
  return "等待结果";
}
