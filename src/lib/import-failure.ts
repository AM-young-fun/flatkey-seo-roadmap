import { databaseErrorCode, isTransientDatabaseError } from "./database-read";

export function importFailure(error: unknown, requestId?: string) {
  const code = databaseErrorCode(error);
  const retryable = isTransientDatabaseError(error);
  return {
    status: retryable ? 503 : 500,
    headers: { "Cache-Control": "private, no-store", ...(retryable ? { "Retry-After": "2" } : {}) },
    body: { code, retryable, requestId, message: `未能确认导入结果（${code}），请保留相同 requestId 重试；已提交批次会自动去重` },
  };
}
