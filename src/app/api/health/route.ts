import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    databaseConfigured: isDatabaseConfigured(),
    timestamp: new Date().toISOString()
  });
}
