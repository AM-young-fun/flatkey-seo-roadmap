import { syncDisplaySourceVersion } from "@/lib/services/display-snapshots";
import { refreshDisplayViews } from "@/lib/services/display-views";
import { NextResponse } from "next/server";
import { runSerpMonitorCron } from "@/lib/services/serp-monitor";
import { loadSourceSyncHealth } from "@/lib/services/source-sync-health";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isSeoWorkday } from "@/lib/seo-workday";
import { seoScheduleOpensAt } from "@/lib/seo-schedule-window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handleCron(request: Request, scheduled = false) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        message: "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  const startedAt = Date.now();
  if (scheduled && (!isSeoWorkday(new Date(startedAt)) || startedAt < seoScheduleOpensAt(new Date(startedAt)))) {
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  }
  // Save an invocation receipt before doing work. This distinguishes a
  // configured cron from an invocation the project actually received.
  const checkId = randomUUID();
  try { await prisma.schedulerCheck.create({ data: { id: checkId } }); }
  catch { return NextResponse.json({ status: "UNAVAILABLE", message: "调度记录无法保存，未开始采集" }, { status: 503 }); }
  try {
  const {runGrowthCollectionCron}=await import("@/lib/services/growth-collection");
  const {runGrowthDiscoveryCron}=await import("@/lib/services/growth-discovery");
  // Domain discovery is auxiliary and requires its own reviewed paid manifest.
  // Never make current-page SERP monitoring wait for four Labs jobs.
  const [growth, auxiliary, serp, sourceHealth] = await Promise.allSettled([runGrowthCollectionCron({deadline:startedAt+225000}),runGrowthDiscoveryCron({deadline:startedAt+210000}),runSerpMonitorCron({ allowStart: false, allowSubmit: false, maxDurationMs: Math.max(0, 240000-(Date.now()-startedAt)) }), loadSourceSyncHealth()]);
  const discovery=auxiliary.status==="fulfilled"?auxiliary.value:{status:"NEEDS_REVIEW",paidRequests:0};
  const needsReview = growth.status === "rejected" || auxiliary.status === "rejected" || discovery.status==="NEEDS_REVIEW" || serp.status === "rejected" || (growth.status === "fulfilled" && ["UNKNOWN","NEEDS_REVIEW"].includes(growth.value.status)) || (serp.status === "fulfilled" && serp.value.status === "NEEDS_REVIEW");
  await prisma.schedulerCheck.update({ where: { id: checkId }, data: { completedAt: new Date(), status: needsReview ? "NEEDS_REVIEW" : "COMPLETED", discoveryStatus: discovery.status,
    serpStatus: growth.status === "fulfilled" ? growth.value.status : "NEEDS_REVIEW", paidRequests: discovery.paidRequests+(growth.status === "fulfilled" ? growth.value.paidRequests : 0) + (serp.status === "fulfilled" ? serp.value.paidRequests : 0) } });
  if (serp.status === "rejected") return NextResponse.json({ status: "NEEDS_REVIEW", message: "SERP原采集账本需要核对，请勿重复提交采集" }, { status: 503 });
  try {
    await syncDisplaySourceVersion();
    await refreshDisplayViews(startedAt + 285000);
  } catch { console.error("Display refresh deferred to next coordinator"); }
  return NextResponse.json({ status: growth.status === "fulfilled" ? growth.value.status : "NEEDS_REVIEW", discovery, growth: growth.status === "fulfilled" ? growth.value : {status:"NEEDS_REVIEW",paidRequests:0}, serp: serp.value,
    // This is an honest baseline check, not a claim that the three protected
    // DingTalk tables have been pulled by the server.
    sourceSync: sourceHealth.status === "fulfilled" ? { ...sourceHealth.value, executed: false } : { status: "HEALTH_UNAVAILABLE", executed: false } },
    { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // No exception details, credentials or provider payloads in receipts.
    await prisma.schedulerCheck.update({ where: { id: checkId }, data: { status: "FAILED", completedAt: new Date() } }).catch(() => {});
    return NextResponse.json({ status: "NEEDS_REVIEW", message: "调度执行异常，请查看原任务记录" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  return handleCron(request, true);
}

export async function POST(request: Request) {
  return handleCron(request);
}
