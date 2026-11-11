import { ZodError } from "zod";
import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders } from "./seo-analytics-access";
import { authenticateImportToken } from "./services/import-tokens";
import { isLocalPreviewOrigin } from "./preview-origin";
import { WorkflowError } from "./seo-workflow-state";

export const workflowHeaders = privateAnalyticsHeaders;
export async function authorizeWorkflow(request: Request, write = false) {
  const collector = await authenticateImportToken(request);
  if (!collector && !await authorizeAnalyticsRead(request)) throw new WorkflowError("unauthorized", "请先登录或使用采集凭据", 401);
  const localPreview = analyticsLocalPreview(request), origin = request.headers.get("origin");
  if (collector ? Boolean(origin) : write ? (localPreview ? !isLocalPreviewOrigin(request) : origin !== new URL(request.url).origin) : Boolean(origin && (localPreview ? !isLocalPreviewOrigin(request) : origin !== new URL(request.url).origin))) throw new WorkflowError("invalid_origin", "请求来源无效", 403);
  return { actor: collector ? "collector" as const : "human" as const, localPreview };
}
export async function readWorkflowBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new WorkflowError("empty_body", "缺少执行记录", 400);
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > 512 * 1024) { await reader.cancel(); throw new WorkflowError("body_too_large", "单条执行记录不能超过 512 KB", 413); } chunks.push(value); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export function workflowErrorResponse(error: unknown) {
  if (error instanceof WorkflowError) return Response.json({ code: error.code, message: error.message }, { status: error.status, headers: workflowHeaders });
  if (error instanceof ZodError) return Response.json({ code: "invalid_record", message: error.issues.map(issue => issue.message).slice(0, 3).join("；") || "执行记录字段无效", issues: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) }, { status: 400, headers: workflowHeaders });
  if (error instanceof SyntaxError) return Response.json({ code: "invalid_json", message: "执行记录不是有效 JSON" }, { status: 400, headers: workflowHeaders });
  return Response.json({ code: "storage_unavailable", message: "执行记录读取或保存失败；请检查数据库配置及运行记录后重试" }, { status: 503, headers: workflowHeaders });
}
