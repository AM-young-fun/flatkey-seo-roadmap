import { authorizeWorkflow, workflowErrorResponse } from "./seo-workflow-http";
import { isAuthEnabled } from "./auth";
import { WorkflowError } from "./seo-workflow-state";
export { workflowErrorResponse };
export async function authorizeReviewAsset(request: Request, write = false) {
  if(request.headers.get("sec-fetch-site")==="cross-site")throw new WorkflowError("invalid_origin","请求来源无效",403);
  const auth=await authorizeWorkflow(request,write);
  if(auth.localPreview || auth.actor==="human"&&!isAuthEnabled())throw new WorkflowError("unauthorized","截图需要真实登录或现有采集凭据",401);
  return auth;
}
export async function readReviewAssetBody(request: Request) {
  if(request.headers.get("content-type")?.split(";")[0]!=="application/json")throw new WorkflowError("invalid_type","需要JSON截图内容",415);
  const reader=request.body?.getReader();if(!reader)throw new WorkflowError("empty_body","缺少截图",400);
  const chunks:Uint8Array[]=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1450000){await reader.cancel();throw new WorkflowError("body_too_large","截图请求超过限制",413);}chunks.push(value);}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
