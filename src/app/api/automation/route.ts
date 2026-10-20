import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptAutomationCredential } from "@/lib/automation-credentials";
import { verifyGa4 } from "@/lib/ga4-collector";
import { automationConfig, enqueueProjectJobs, rotateWorkerToken } from "@/lib/services/project-jobs";
import { readImportJson } from "@/lib/ranking-import";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
const headers={"Cache-Control":"private, no-store"};
const authorized=async()=>isAuthEnabled()&&await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value);
export async function GET() {
  if(!await authorized())return NextResponse.json({message:"请先登录"},{status:401,headers});
  try {
    const row=await prisma.projectAutomation.findUnique({where:{id:"default"},select:{trafficEnabled:true,sheetsEnabled:true,ga4Email:true,ga4VerifiedAt:true,workerSeenAt:true,workerTokenHash:true}});
    return NextResponse.json({trafficEnabled:row?.trafficEnabled??true,sheetsEnabled:row?.sheetsEnabled??true,ga4Email:row?.ga4Email??null,ga4VerifiedAt:row?.ga4VerifiedAt??null,workerSeenAt:row?.workerSeenAt??null,workerPaired:Boolean(row?.workerTokenHash)},{headers});
  }catch{return NextResponse.json({message:"连接状态暂时无法读取"},{status:503,headers});}
}
const inputSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("connectGa4"),credentials:z.unknown()}).strict(),
  z.object({action:z.literal("rotateWorker")}).strict(),
  z.object({action:z.literal("toggle"),kind:z.enum(["TRAFFIC","SHEETS"]),enabled:z.boolean()}).strict(),
  z.object({action:z.literal("retry"),kind:z.enum(["TRAFFIC","SHEETS"])}).strict(),
]);
export async function POST(request:Request) {
  if(!await authorized())return NextResponse.json({message:"请先登录"},{status:401,headers});
  if(request.headers.get("origin") && request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({message:"请求来源无效"},{status:403,headers});
  try {
    const input=inputSchema.parse(await readImportJson(request));
    await automationConfig();
    if(input.action==="connectGa4") {
      const key=await verifyGa4(input.credentials);
      await prisma.projectAutomation.update({where:{id:"default"},data:{ga4Credentials:encryptAutomationCredential(JSON.stringify(key)),ga4Email:key.client_email,ga4VerifiedAt:new Date()}});
      await prisma.projectJob.updateMany({where:{kind:"TRAFFIC",status:"BLOCKED"},data:{status:"QUEUED",nextAttemptAt:new Date(),errorCode:null,attempts:0}});
      return NextResponse.json({message:"GA4 认证、属性权限和注册事件已验证；到期后自动取数"},{headers});
    }
    if(input.action==="rotateWorker")return NextResponse.json({secret:await rotateWorkerToken(),message:"凭据仅显示本次；旧凭据已失效"},{headers});
    if(input.action==="toggle")await prisma.projectAutomation.update({where:{id:"default"},data:input.kind==="TRAFFIC"?{trafficEnabled:input.enabled}:{sheetsEnabled:input.enabled}});
    if(input.action==="retry") {
      await enqueueProjectJobs();
      await prisma.projectJob.updateMany({where:{kind:input.kind,status:{in:["FAILED","BLOCKED","RETRY"]}},data:{status:"QUEUED",nextAttemptAt:new Date(),errorCode:null,attempts:0}});
    }
    return NextResponse.json({message:input.action==="retry"?"已重新排队，等待项目调度执行":"计划已保存"},{headers});
  }catch(error) {
    const message=error instanceof Error&&error.message.startsWith("GA4_")?({GA4_AUTH_FAILED:"服务账号认证失败",GA4_PERMISSION:"服务账号尚无 GA4 属性读取权限，或 Data API 未开启",GA4_REGISTRATION_EVENT_UNVERIFIED:"未读到 sign_up_success 注册用户，请核对属性和事件",GA4_TIMEZONE_MISMATCH:"GA4 属性时区与当前周报不一致"}[error.message]??"GA4 连接暂时无法验证，请稍后重试"):"设置无效或保存失败，请检查后重试";
    return NextResponse.json({message},{status:400,headers});
  }
}
