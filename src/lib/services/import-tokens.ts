import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getRankingImportSecret } from "@/lib/import-credential";
import { importSecretMatches } from "@/lib/ranking-import";
import { createImportTokenSecret, hashImportToken, importTokenCommandSchema, importTokenMetadata, ImportTokenError, managedImportToken, type ImportTokenCommand } from "@/lib/import-token";

const metadataSelect = { id: true, name: true, prefix: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true } as const;
function requireDatabase() {
  if (!process.env.DATABASE_URL) throw new ImportTokenError("storage_unavailable", "接入凭据管理尚未接通数据库", 503);
}
export async function listImportTokens() {
  requireDatabase();
  const rows = await prisma.seoImportToken.findMany({ select: metadataSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  return { tokens: rows.map(importTokenMetadata), legacy: { configured: Boolean(getRankingImportSecret()), managed: false as const }, storage: "database" as const };
}
export async function mutateImportToken(input: ImportTokenCommand, now = new Date()) {
  const command = importTokenCommandSchema.parse(input);
  requireDatabase();
  if (command.action === "create") {
    const generated = createImportTokenSecret();
    const row = await prisma.seoImportToken.create({ data: {
      id: randomUUID(), name: command.name, tokenHash: generated.tokenHash, prefix: generated.prefix, createdAt: now,
      expiresAt: command.expiresInDays === null ? null : new Date(now.getTime() + command.expiresInDays * 86400000),
    }, select: metadataSelect });
    // Plaintext exists only in this create response; subsequent reads select metadata only.
    return { token: importTokenMetadata(row), secret: generated.secret };
  }
  const updated = await prisma.seoImportToken.updateMany({ where: { id: command.id, revokedAt: null }, data: { revokedAt: now } });
  if (!updated.count && !await prisma.seoImportToken.findUnique({ where: { id: command.id }, select: { id: true } })) {
    throw new ImportTokenError("token_not_found", "接入凭据不存在", 404);
  }
  return { revoked: true as const };
}

/** Authentication only: callers retain their existing route and scope restrictions.
 * The conditional database write makes revocation/expiry effective across workers;
 * there is no local cache, and a failed update must never grant access. */
export async function authenticateImportToken(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization"), legacy = getRankingImportSecret();
  if (legacy && importSecretMatches(authorization, legacy)) return true;
  const secret = managedImportToken(authorization);
  if (!secret || !process.env.DATABASE_URL) return false;
  try {
    const now = new Date();
    const result = await prisma.seoImportToken.updateMany({ where: {
      tokenHash: hashImportToken(secret), revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    }, data: { lastUsedAt: now } });
    return result.count === 1;
  } catch { return false; }
}
