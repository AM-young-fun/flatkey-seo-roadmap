import { displayDataChanged } from "@/lib/services/display-change";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readImportJson, ImportRequestError } from "@/lib/ranking-import";
import { weeklyReportDraftSchema } from "@/lib/weekly-report-draft";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
  if(!isAuthEnabled() || !(await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)))return NextResponse.json({message:"需要登录"},{status:401});
  try {
    const parsed=weeklyReportDraftSchema.safeParse(await readImportJson(request));
    if(!parsed.success)return NextResponse.json({message:"草稿格式无效",errors:parsed.error.issues},{status:400});
    const payload=parsed.data, periodStart=new Date(payload.periodStart);
    const changed=await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`weekly-draft:${payload.siteDomain}:${payload.periodStart}`}))`;
      const site=await tx.seoSite.findUnique({where:{domain:payload.siteDomain}});
      if(!site?.active || site.ga4PropertyId!==payload.ga4PropertyId)throw new ImportRequestError("网站与GA4属性不匹配",400);
      const finalized=await tx.weeklyTraffic.findFirst({where:{siteDomain:payload.siteDomain,periodStart}});
      if(finalized)return false;
      const existing=await tx.weeklyReportDraft.findUnique({where:{siteDomain_periodStart:{siteDomain:payload.siteDomain,periodStart}}});
      if(existing && existing.collectedAt.getTime()>=Date.parse(payload.collectedAt))return false;
      const data={periodEnd:new Date(payload.periodEnd),collectedAt:new Date(payload.collectedAt),payload:JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue};
      await tx.weeklyReportDraft.upsert({where:{siteDomain_periodStart:{siteDomain:payload.siteDomain,periodStart}},create:{siteDomain:payload.siteDomain,periodStart,...data},update:data});
      return true;
    });
    if (changed) await displayDataChanged();
    return NextResponse.json({draft:true,duplicate:!changed,imported:changed?1:0});
  }catch(error){
    if(error instanceof ImportRequestError)return NextResponse.json({message:error.message},{status:error.status});
    console.error("Weekly draft save failed");return NextResponse.json({message:"草稿保存失败"},{status:503});
  }
}
