import { NextResponse } from "next/server";
import { runSerpMonitorCron } from "@/lib/services/serp-monitor";
import { runKeywordDiscoveryCycle } from "@/lib/services/keyword-cycle";
import { loadSourceSyncHealth } from "@/lib/services/source-sync-health";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handleCron(request: Request) {
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
  // Save an invocation receipt before doing work. This distinguishes a
  // configured cron from an invocation the project actually received.
  const checkId = randomUUID();
  try { await prisma.schedulerCheck.create({ data: { id: checkId } }); }
  catch { return NextResponse.json({ status: "UNAVAILABLE", message: "调度记录无法保存，未开始采集" }, { status: 503 }); }
  try {
  const discovery = await runKeywordDiscoveryCycle({ deadline: startedAt + 180000 }).catch(() => ({ status: "UNAVAILABLE", ready: false, paidRequests: 0 }));
  const [serp, sourceHealth] = await Promise.allSettled([runSerpMonitorCron({ allowStart: discovery.ready, maxDurationMs: Math.max(0, 240000-(Date.now()-startedAt)) }), loadSourceSyncHealth()]);
  const needsReview = serp.status === "rejected" || ["NEEDS_REVIEW", "UNAVAILABLE"].includes(discovery.status) || (serp.status === "fulfilled" && serp.value.status === "NEEDS_REVIEW");
  await prisma.schedulerCheck.update({ where: { id: checkId }, data: { completedAt: new Date(), status: needsReview ? "NEEDS_REVIEW" : "COMPLETED", discoveryStatus: discovery.status,
    serpStatus: serp.status === "fulfilled" ? serp.value.status : "NEEDS_REVIEW", paidRequests: discovery.paidRequests + (serp.status === "fulfilled" ? serp.value.paidRequests : 0) } });
  if (serp.status === "rejected") return NextResponse.json({ status: "NEEDS_REVIEW", message: "SERP原采集账本需要核对，请勿重复提交采集" }, { status: 503 });
  return NextResponse.json({ status: serp.value.status, discovery, serp: serp.value,
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
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
