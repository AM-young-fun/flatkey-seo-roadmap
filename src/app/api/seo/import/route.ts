import { importFailure } from "@/lib/import-failure";
import { NextResponse } from "next/server";
import { importSeo } from "@/lib/services/seo-import";
import { rankingImportSchema, readImportJson, ImportRequestError } from "@/lib/ranking-import";
import { isAuthEnabled, isValidAuthToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Manual file imports require the same logged-in session as the management page.
export async function POST(request: Request) {
  if (!isAuthEnabled() || !(await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value))) return NextResponse.json({ message: "需要登录" }, { status: 401 });
  let requestId: string | undefined;
  try {
    const parsed = rankingImportSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "数据格式错误", errors: parsed.error.issues }, { status: 400 });
    requestId = parsed.data.requestId;
    const result = await importSeo(parsed.data);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status });
    const failure = importFailure(error, requestId);
    console.error("SEO import failed", {code:failure.body.code,requestId});
    return NextResponse.json(failure.body, {status:failure.status,headers:failure.headers});
  }
}
