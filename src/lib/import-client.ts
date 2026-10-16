import type { SourceSyncSummary } from "./source-sync";
import type { PageAuditSummary } from "./page-audit";

type BatchResult = { imported: number; duplicate: boolean; importId?: string; action?: "preview" | "apply"; sourceSummary?: SourceSyncSummary; pageSummary?: PageAuditSummary };
type Dependencies = { fetch?: typeof fetch; delay?: (milliseconds:number)=>Promise<void>; onRetry?: (attempt:number)=>void };

// Retry the exact serialized batch: its durable requestId makes a lost response
// safe to replay even when the first transaction already committed.
export async function postImportBatch(batch: {requestId?:string;kind?:string}, dependencies: Dependencies = {}): Promise<BatchResult> {
  if (!batch.requestId?.trim()) throw new Error("每批数据必须包含固定的 requestId，才能安全重试");
  const body = JSON.stringify(batch);
  const send = dependencies.fetch ?? fetch;
  const delay = dependencies.delay ?? (milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)));
  for (let attempt=0; attempt<3; attempt++) {
    try {
      const endpoint = batch.kind === "source-sync" ? "/api/keywords/source-sync" : batch.kind === "page-audit" ? "/api/keywords/page-audit" : "/api/seo/import";
      const response = await send(endpoint, {method:"POST",headers:{"Content-Type":"application/json"},body});
      const result = await response.json().catch(()=>null) as (BatchResult & {message?:string;retryable?:boolean}) | null;
      if (!response.ok) {
        const retryable = response.status >= 500 && (result?.retryable ?? [502,503,504].includes(response.status));
        throw Object.assign(new Error(result?.message ?? (response.status===401 ? "登录已失效，请重新登录后重传原文件" : `导入请求失败（${response.status}）`)), {retryable});
      }
      if (!result || !Number.isInteger(result.imported) || typeof result.duplicate!=="boolean") throw Object.assign(new Error("未收到完整导入确认，请重传原文件核实"),{retryable:true});
      return result;
    } catch(error) {
      const retryable = error instanceof TypeError || (error instanceof Error && "retryable" in error && error.retryable===true);
      if (!retryable || attempt===2) throw error;
      dependencies.onRetry?.(attempt+1);
      await delay((attempt+1)*1000);
    }
  }
  throw new Error("导入未完成，请保留原文件重试");
}
