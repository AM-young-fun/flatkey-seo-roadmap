import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { IMPORT_API_PATH } from "@/lib/ranking-import";
import { SOURCE_SYNC_API_PATH } from "@/lib/source-sync";
import { KEYWORD_EXPORT_API_PATH } from "@/lib/keyword-export";

function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/api/auth/");
}

function isAuthorizedCron(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;

  return Boolean(
    cronSecret &&
      request.nextUrl.pathname === "/api/cron/daily-rankings" &&
      request.headers.get("authorization") === `Bearer ${cronSecret}`
  );
}

export async function proxy(request: NextRequest) {
  // These endpoints check their own dedicated credentials, even when page
  // login is disabled. Those credentials cannot access management routes.
  if (request.nextUrl.pathname === IMPORT_API_PATH || request.nextUrl.pathname === SOURCE_SYNC_API_PATH || request.nextUrl.pathname === KEYWORD_EXPORT_API_PATH) return NextResponse.next();
  if (!isAuthEnabled() || isPublicPath(request.nextUrl.pathname) || isAuthorizedCron(request)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (await isValidAuthToken(token)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        message: "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)"]
};
