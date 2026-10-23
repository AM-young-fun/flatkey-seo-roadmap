import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { AUTH_COOKIE_NAME,isAuthEnabled,isValidAuthToken } from "@/lib/auth";
import { getRankingImportSecret } from "@/lib/import-credential";
import { importSecretMatches,readImportJson } from "@/lib/ranking-import";
import { collectorRunId,collectorRunSchema } from "@/lib/collector-runs";
import { weeklyEvidenceSchema } from "@/lib/weekly-evidence-schema";
import { PILLAR_VISITORS_START } from "@/lib/weekly-page-visitors";
import { prisma } from "@/lib/prisma";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function POST(request:Request){
  const secret=getRankingImportSecret(),bearer=Boolean(secret&&importSecretMatches(request.headers.get("authorization"),secret));
  if(!bearer&&(!isAuthEnabled()||!await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)))return NextResponse.json({message:"请先登录或使用现有采集凭据"},{status:401,headers});
  try{
    const input=collectorRunSchema.parse(await readImportJson(request)),id=collectorRunId(input.kind,input.periodStart);
    if(input.kind==="GA4"&&input.status==="COMPLETED"){
      const report=await prisma.weeklyTraffic.findFirst({where:{siteDomain:"flatkey.ai",periodStart:new Date(input.periodStart)},orderBy:{collectedAt:"desc"}});
      const evidence=weeklyEvidenceSchema.safeParse(report?.analysis);
      if(!report||!evidence.success||!evidence.data.codexSummary||evidence.data.totals.current.newUsers!==report.newUsers||evidence.data.totals.current.newRegistrations!==report.newRegistrations)return NextResponse.json({message:"须先保存已核对并含 Codex 总结的完整周报"},{status:409,headers});
      if(input.periodStart>=PILLAR_VISITORS_START&&(!evidence.data.pageVisitors||evidence.data.pageVisitors.groups.some(group=>group.users.current===null)))return NextResponse.json({message:"须先补齐本周模型页和提示词页的去重访客量"},{status:409,headers});
      if(new Date(input.periodStart).getUTCDay()===5){
        if(evidence.data.pageVisitors?.ruleVersion!==2||evidence.data.pageVisitors.siteUsers?.current==null||evidence.data.pageVisitors.groups.some(group=>group.users.current===null)) return NextResponse.json({message:"须补齐模型详情、Prompt Library及全站去重访客量，才能计算占比并完成周报"},{status:409,headers});
      }
    }
    const existing=await prisma.collectorRun.findUnique({where:{id},select:{status:true}});
    if(existing?.status==="COMPLETED")return NextResponse.json({id,status:"COMPLETED",duplicate:true},{headers});
    const data={...input,...(input.sourceChecks?{sourceChecks:input.sourceChecks as Prisma.InputJsonValue}:{}),completedAt:input.status==="RUNNING"?null:new Date()};
    await prisma.collectorRun.createMany({data:[{id,...data}],skipDuplicates:true});
    await prisma.collectorRun.updateMany({where:{id,status:{not:"COMPLETED"}},data});
    const saved=await prisma.collectorRun.findUnique({where:{id},select:{status:true}});
    return NextResponse.json({id,status:saved?.status??input.status},{headers});
  }catch{return NextResponse.json({message:"采集回执无效或保存失败，不据此标记成功"},{status:400,headers});}
}
