import type { NextRequest } from "next/server";
import { hasResearchReadHeader } from "@/lib/seo-research-read";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { IMPORT_API_PATH } from "@/lib/ranking-import";
import { SOURCE_SYNC_API_PATH } from "@/lib/source-sync";
import { KEYWORD_EXPORT_API_PATH } from "@/lib/keyword-export";
import { DAILY_SEO_TRAFFIC_API_PATH } from "@/lib/daily-seo-traffic";
import { DAILY_SEO_PAGE_GROUPS_API_PATH } from "@/lib/daily-seo-page-groups";

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
  // These exact handlers enforce their own quarter membership credentials.
  if (["/api/keywords/quarter-membership", "/api/keywords/quarter-membership/reserved"].includes(request.nextUrl.pathname)
    && ["GET", "POST"].includes(request.method)) return NextResponse.next();
  // The additive association handler requires its own real human session.
  if (request.nextUrl.pathname === "/api/keywords/topic-associations" && ["GET", "POST"].includes(request.method)) return NextResponse.next();
  // These exact growth handlers authenticate their own cookie/collector credentials
  // and distinguish read, evidence write, and human-only decisions.
  const growth = ["/api/seo/growth", "/api/seo/growth/strategy", "/api/seo/growth/collection", "/api/seo/growth/discovery"].includes(request.nextUrl.pathname);
  if (growth && (request.method === "GET" || request.method === "POST" && request.nextUrl.pathname !== "/api/seo/growth")) return NextResponse.next();
  // This GET authenticates its own cookie/SEO Bearer and only reads saved rows.
  if (request.nextUrl.pathname === "/api/seo/ranked-keyword-coverage" && request.method === "GET") return NextResponse.next();
  if (request.nextUrl.pathname === "/api/seo/analytics" && request.method === "GET"
    && request.nextUrl.searchParams.get("view") === "old-post-shortlist") return NextResponse.next();
  // The fixed historical export authenticates the same saved-ranking read scope.
  if (request.nextUrl.pathname === "/api/seo/trends/history-export" && request.method === "GET") return NextResponse.next();
  // This exact POST authenticates the human cookie and same-origin write itself.
  if (request.nextUrl.pathname === "/api/seo/growth/hotspots/admit" && request.method === "POST") return NextResponse.next();
  // The exact hotspot GET authenticates its own cookie/collector read scope.
  if (request.nextUrl.pathname === "/api/seo/growth/hotspots" && request.method === "GET") return NextResponse.next();
  // Saved conversion evidence uses the existing read-only cookie/SEO scope.
  if (request.nextUrl.pathname === "/api/seo/growth/conversion" && request.method === "GET") return NextResponse.next();
  if (request.nextUrl.pathname === "/api/seo/approved-keyword-review" && request.method === "GET") return NextResponse.next();
  // The saved-evidence handler retains its own cookie/collector authorization.
  if (request.nextUrl.pathname === "/api/seo/approved-keyword-review/evidence" && request.method === "GET") return NextResponse.next();
  if (request.nextUrl.pathname === "/api/seo/approved-other-keyword-review" && request.method === "GET") return NextResponse.next();
  if (request.nextUrl.pathname === "/api/seo/approved-keyword-review/collect" && request.method === "POST") return NextResponse.next();
  // These two GET handlers validate the database-backed research key.
  if (hasResearchReadHeader(request)) return NextResponse.next();
  if (request.nextUrl.pathname === "/api/seo/review-assets" || /^\/api\/seo\/review-assets\/[a-f0-9]{64}$/.test(request.nextUrl.pathname)) return NextResponse.next();
  if (["/api/seo/workflow", "/api/seo/workflow/claims", "/api/seo/workflow/approval-check", "/api/seo/workflow/history", "/api/seo/digest", "/api/seo/reporting-control", "/api/seo/periods", "/api/seo/business", "/api/seo/registrations", "/api/seo/account-registrations", "/api/seo/github"].includes(request.nextUrl.pathname)) return NextResponse.next();
  if (request.nextUrl.pathname === "/api/seo/optimization-plans") return NextResponse.next();
  if (request.nextUrl.pathname === "/api/seo/ranking-notice") return NextResponse.next();
  // The handler accepts collector credentials and rejects unauthenticated reads/writes.
  if (request.nextUrl.pathname === "/api/traffic/registrations") return NextResponse.next();
  if (request.nextUrl.pathname === "/api/seo/traffic-summary" && ["GET", "POST"].includes(request.method)) return NextResponse.next();
  // These endpoints check their own dedicated credentials, even when page
  // login is disabled. Those credentials cannot access management routes.
  if (request.nextUrl.pathname === IMPORT_API_PATH || request.nextUrl.pathname === SOURCE_SYNC_API_PATH || request.nextUrl.pathname === KEYWORD_EXPORT_API_PATH || request.nextUrl.pathname === "/api/collectors/runs" || request.nextUrl.pathname === "/api/seo/analytics/import" || request.nextUrl.pathname === "/api/seo/analytics/health" || request.nextUrl.pathname === "/api/seo/pages" || request.nextUrl.pathname === "/api/seo/weekly-actions" || request.nextUrl.pathname === DAILY_SEO_TRAFFIC_API_PATH || request.nextUrl.pathname === DAILY_SEO_PAGE_GROUPS_API_PATH) return NextResponse.next();
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
