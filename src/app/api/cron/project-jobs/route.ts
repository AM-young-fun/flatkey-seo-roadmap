import { NextResponse } from "next/server";
import { runProjectJobs } from "@/lib/services/project-jobs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(request:Request) {
  if(!process.env.CRON_SECRET || request.headers.get("authorization")!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({message:"Unauthorized"},{status:401});
  try {return NextResponse.json(await runProjectJobs(),{headers:{"Cache-Control":"private, no-store"}});}
  catch{return NextResponse.json({status:"FAILED",message:"项目任务调度失败"},{status:503});}
}
