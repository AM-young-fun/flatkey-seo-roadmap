import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME,isAuthEnabled,isValidAuthToken } from "@/lib/auth";
import { privateAnalyticsHeaders,authorizeAnalyticsRead } from "@/lib/seo-analytics-access";
import { authorizeSavedRankingCoverage } from "@/lib/services/ranking-coverage-access";
import { readImportJson } from "@/lib/ranking-import";
import { GROWTH_COLLECTION_KIND,GrowthCollectionError,growthCollectionCommandSchema } from "@/lib/growth-collection";
import { loadGrowthCollection,saveGrowthCollection } from "@/lib/services/growth-collection";
import { resumeGrowthCollectionRun } from "@/lib/services/serp-monitor";

export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=300;
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:privateAnalyticsHeaders});
async function humanCookie(){return isAuthEnabled()&&await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value);}
function failure(error:unknown){return error instanceof GrowthCollectionError?response({code:error.code,message:error.message},error.status):response({code:`${GROWTH_COLLECTION_KIND}-unavailable`,message:"采集清单操作未完成，请读取原版本/账本后重试；不要重复提交采集"},503);}
export async function GET(request:Request){try{if(!await authorizeAnalyticsRead(request)&&!await authorizeSavedRankingCoverage(request))return response({message:"请先登录或使用只读采集凭据"},401);return response(await loadGrowthCollection(new URL(request.url).searchParams.get("periodKey")??undefined));}catch(error){return failure(error);}}
export async function POST(request:Request){try{
  const cookie=await humanCookie(),origin=request.headers.get("origin"),sameOrigin=origin===new URL(request.url).origin;
  const collector=!cookie&&await authorizeSavedRankingCoverage(request);
  if(cookie?!sameOrigin:!collector||Boolean(origin))return response({message:"需要同源已登录用户或无Origin的有效采集凭据"},403);
  const parsed=growthCollectionCommandSchema.safeParse(await readImportJson(request));if(!parsed.success)return response({message:"操作参数无效"},400);
  if(parsed.data.action==="approve"&&(!cookie||!sameOrigin))return response({message:"只有真实同源登录用户可批准该确切清单和费用"},403);
  const saved=await saveGrowthCollection(parsed.data,cookie?"human":"collector");
  // The only paid-capable edge is an explicit consume of an already approved
  // exact manifest. prepare/approve/reserve never call the provider.
  if(parsed.data.action==="resume"&&saved.state.runId)return response({...saved,run:await resumeGrowthCollectionRun(saved.state.runId,{allowSubmit:parsed.data.allowSubmit,deadline:Date.now()+225000})});
  return response(saved);
}catch(error){return failure(error);}}
