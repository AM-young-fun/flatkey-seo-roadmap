import { NextResponse } from "next/server";
import { runSerpMonitorCron } from "@/lib/services/serp-monitor";
import { runKeywordDiscoveryCycle } from "@/lib/services/keyword-cycle";
import { loadSourceSyncHealth } from "@/lib/services/source-sync-health";

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
  const discovery = await runKeywordDiscoveryCycle({ deadline: startedAt + 180000 }).catch(() => ({ status: "UNAVAILABLE", ready: false, paidRequests: 0 }));
  const [serp, sourceHealth] = await Promise.allSettled([runSerpMonitorCron({ allowStart: discovery.ready, maxDurationMs: Math.max(0, 240000-(Date.now()-startedAt)) }), loadSourceSyncHealth()]);
  if (serp.status === "rejected") return NextResponse.json({ status: "NEEDS_REVIEW", message: "SERP原采集账本需要核对，请勿重复提交采集" }, { status: 503 });
  return NextResponse.json({ status: serp.value.status, discovery, serp: serp.value,
    // This is an honest baseline check, not a claim that the three protected
    // DingTalk tables have been pulled by the server.
    sourceSync: sourceHealth.status === "fulfilled" ? { ...sourceHealth.value, executed: false } : { status: "HEALTH_UNAVAILABLE", executed: false } },
    { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
