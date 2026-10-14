import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { getRankingImportSecret } from "@/lib/import-credential";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Never expose the credential when page login is disabled, even though the
  // proxy otherwise permits public access in that mode.
  if (
    !isAuthEnabled() ||
    !(await isValidAuthToken(request.cookies.get(AUTH_COOKIE_NAME)?.value))
  ) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const secret = getRankingImportSecret();
  if (!secret)
    return NextResponse.json({ message: "导入密钥尚未配置" }, { status: 503 });
  return NextResponse.json(
    { secret },
    {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
