import "server-only";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { getRankingImportSecret } from "@/lib/import-credential";
import { hashImportToken, managedImportToken } from "@/lib/import-token";
import { prisma } from "@/lib/prisma";
import { importSecretMatches } from "@/lib/ranking-import";

/** Saved ranking coverage GET only; authentication never records token usage. */
export async function authorizeSavedRankingCoverage(request: Request): Promise<boolean> {
  if (isAuthEnabled() && await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) return true;
  if (request.headers.has("origin")) return false;

  const authorization = request.headers.get("authorization"), legacy = getRankingImportSecret();
  if (legacy && importSecretMatches(authorization, legacy)) return true;
  const secret = managedImportToken(authorization);
  if (!secret || !process.env.DATABASE_URL) return false;
  try {
    const row = await prisma.seoImportToken.findFirst({
      where: {
        tokenHash: hashImportToken(secret), revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    return row !== null;
  } catch { return false; }
}
