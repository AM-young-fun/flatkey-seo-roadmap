import { authorizeReviewAsset, readReviewAssetBody, workflowErrorResponse } from "@/lib/seo-review-assets-http";
import { uploadReviewAsset } from "@/lib/services/seo-review-assets";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function POST(request:Request){try{const auth=await authorizeReviewAsset(request,true);return Response.json(await uploadReviewAsset(await readReviewAssetBody(request),auth.actor),{headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});}catch(error){return workflowErrorResponse(error);}}
