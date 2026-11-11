import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const IMPORT_TOKEN_PREFIX = "seo_import_";
export const importTokenCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(100).refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), "名称不能包含控制字符"),
    expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]),
  }).strict(),
  z.object({ action: z.literal("revoke"), id: z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/) }).strict(),
]);
export type ImportTokenCommand = z.infer<typeof importTokenCommandSchema>;
export type ImportTokenMetadata = {
  id: string; name: string; prefix: string; createdAt: string;
  expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null;
};
export type ImportTokenMetadataRow = Omit<ImportTokenMetadata, "createdAt" | "expiresAt" | "lastUsedAt" | "revokedAt"> & {
  createdAt: Date; expiresAt: Date | null; lastUsedAt: Date | null; revokedAt: Date | null;
};
export class ImportTokenError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}
export function hashImportToken(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}
export function createImportTokenSecret() {
  const secret = IMPORT_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { secret, tokenHash: hashImportToken(secret), prefix: secret.slice(0, IMPORT_TOKEN_PREFIX.length + 8) };
}
export function managedImportToken(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const secret = authorization.slice(7);
  if (!/^seo_import_[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  // Reject noncanonical encodings, not only invalid alphabet/length.
  const encoded = secret.slice(IMPORT_TOKEN_PREFIX.length), bytes = Buffer.from(encoded, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === encoded ? secret : null;
}
export function importTokenMetadata(row: ImportTokenMetadataRow): ImportTokenMetadata {
  return { id: row.id, name: row.name, prefix: row.prefix, createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null, lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null };
}
