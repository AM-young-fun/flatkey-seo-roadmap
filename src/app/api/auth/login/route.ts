import { NextResponse } from "next/server";
import { AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_NAME, getAuthToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectTarget(request: Request): string {
  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  return next?.startsWith("/") ? next : "/";
}

function redirectWithError(request: Request) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", "1");
  url.searchParams.set("next", redirectTarget(request));
  return NextResponse.redirect(url, {
    status: 303
  });
}

async function readPassword(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => ({}))) as {
      password?: string;
    };
    return payload.password ?? "";
  }

  const formData = await request.formData().catch(() => null);
  return formData?.get("password")?.toString() ?? "";
}

export async function POST(request: Request) {
  const loginPassword = process.env.LOGIN_PWD;
  const providedPassword = await readPassword(request);

  if (loginPassword && providedPassword !== loginPassword) {
    if (request.headers.get("accept")?.includes("application/json")) {
      return NextResponse.json(
        {
          message: "Invalid password"
        },
        {
          status: 401
        }
      );
    }

    return redirectWithError(request);
  }

  const response = NextResponse.redirect(new URL(redirectTarget(request), request.url), {
    status: 303
  });

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: await getAuthToken(loginPassword),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE
  });

  return response;
}
