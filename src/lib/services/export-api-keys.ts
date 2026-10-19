import { prisma } from "@/lib/prisma";
import { ImportRequestError } from "@/lib/ranking-import";
import { decryptExportApiKey, encryptExportApiKey, generateExportApiKey, hashExportApiKey } from "@/lib/export-api-key-crypto";
import type { apiKeyMutationSchema } from "@/lib/keyword-export";
import type { z } from "zod";

const select = { id: true, name: true, prefix: true, siteDomain: true, createdAt: true, lastUsedAt: true, revokedAt: true } as const;
export async function listExportApiKeys() {
  return prisma.keywordExportApiKey.findMany({ select, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
}
export async function mutateExportApiKey(input: z.infer<typeof apiKeyMutationSchema>) {
  if (input.action === "create") {
    const secret = generateExportApiKey();
    const key = await prisma.keywordExportApiKey.create({ data: { name: input.name, siteDomain: input.siteDomain,
      keyHash: hashExportApiKey(secret), encryptedKey: encryptExportApiKey(secret), prefix: `${secret.slice(0, 17)}…` }, select });
    return { key, secret };
  }
  if (input.action === "revoke") {
    await prisma.keywordExportApiKey.updateMany({ where: { id: input.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { revoked: true };
  }
  const row = await prisma.keywordExportApiKey.findFirst({ where: { id: input.id, revokedAt: null }, select: { encryptedKey: true } });
  if (!row) throw new ImportRequestError("API Key 不存在或已停用", 404);
  try { return { secret: decryptExportApiKey(row.encryptedKey) }; }
  catch { throw new ImportRequestError("API Key 无法解密，请停用后重新创建（网页登录密码变更后需要重新创建）", 409); }
}
export async function authenticateExportApiKey(request: Request) {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer (\S+)$/i)?.[1];
  const headerKey = request.headers.get("x-api-key");
  if ((authorization && !bearer) || (bearer && headerKey && bearer !== headerKey)) return null;
  const secret = bearer ?? headerKey;
  if (!secret || !/^seo_export_[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return prisma.keywordExportApiKey.findFirst({ where: { keyHash: hashExportApiKey(secret), revokedAt: null }, select: { id: true, siteDomain: true } });
}
