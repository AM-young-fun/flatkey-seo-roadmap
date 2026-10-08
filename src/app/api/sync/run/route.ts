import { NextResponse } from "next/server";
import { runDailyRankingSync } from "@/lib/services/sync-rankings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const result = await runDailyRankingSync();
  return NextResponse.json(result);
}
