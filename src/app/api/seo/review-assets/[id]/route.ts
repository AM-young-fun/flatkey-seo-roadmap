import { authorizeReviewAsset, workflowErrorResponse } from "@/lib/seo-review-assets-http";
import { getReviewAsset } from "@/lib/services/seo-review-assets";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{await authorizeReviewAsset(request);const asset=await getReviewAsset((await context.params).id);return new Response(new Uint8Array(Buffer.from(asset.data,"base64")),{headers:{"Content-Type":asset.mime,"Content-Length":String(asset.bytes),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox","Cross-Origin-Resource-Policy":"same-origin","Content-Disposition":`inline; filename="${asset.viewport}-${asset.sha256}.${asset.mime==="image/png"?"png":"jpg"}"`}});}catch(error){return workflowErrorResponse(error);}}
