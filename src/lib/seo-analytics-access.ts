import "server-only";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "./auth";
import { isLocalPreviewRequest } from "./preview-origin";

export function analyticsLocalPreview(request: Request) {
  return process.env.NODE_ENV === "development" && Boolean(process.env.SEO_PREVIEW_UPSTREAM_TOKEN)
    && isLocalPreviewRequest(request) && ["same-origin", "none", null].includes(request.headers.get("sec-fetch-site"));
}

export async function authorizeAnalyticsRead(request: Request) {
  if (analyticsLocalPreview(request)) return true;
  return isAuthEnabled() && await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value);
}

export const privateAnalyticsHeaders = { "Cache-Control": "private, no-store" };
