import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME,isAuthEnabled,isValidAuthToken } from "@/lib/auth";
import { authorizeAnalyticsRead,privateAnalyticsHeaders } from "@/lib/seo-analytics-access";
import { authorizeSavedRankingCoverage } from "@/lib/services/ranking-coverage-access";
import { readImportJson } from "@/lib/ranking-import";
import { GrowthCollectionError } from "@/lib/growth-collection";
import { growthDiscoveryCommandSchema } from "@/lib/growth-discovery";
import { loadGrowthDiscovery,saveGrowthDiscovery } from "@/lib/services/growth-discovery";
export const dynamic="force-dynamic";export const runtime="nodejs";export const maxDuration=300;
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:privateAnalyticsHeaders});
const failure=(error:unknown)=>error instanceof GrowthCollectionError?response({code:error.code,message:error.message},error.status):response({message:"辅助分页记录未完成，请读取原页账本；不要重复请求供应商"},503);
export async function GET(request:Request){try{if(!await authorizeAnalyticsRead(request)&&!await authorizeSavedRankingCoverage(request))return response({message:"请先登录"},401);const id=new URL(request.url).searchParams.get("id");if(!id||!/^[a-zA-Z0-9_-]{1,60}$/.test(id))return response({message:"清单标识无效"},400);return response({state:await loadGrowthDiscovery(id),paidRequests:0});}catch(error){return failure(error);}}
export async function POST(request:Request){try{
  const human=isAuthEnabled()&&await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value),origin=request.headers.get("origin"),sameOrigin=origin===new URL(request.url).origin,collector=!human&&await authorizeSavedRankingCoverage(request);
  if(human?!sameOrigin:!collector||Boolean(origin))return response({message:"需要同源真实登录用户或无Origin的有效采集凭据"},403);
  const command=growthDiscoveryCommandSchema.safeParse(await readImportJson(request));if(!command.success)return response({message:"分页参数无效"},400);
  if(command.data.action==="approve"&&!human)return response({message:"只有用户可批准确切分页清单和总费用"},403);
  return response(await saveGrowthDiscovery(command.data,human?"human":"collector"));
}catch(error){return failure(error);}}
