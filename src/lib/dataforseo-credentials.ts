import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { ImportRequestError } from "@/lib/ranking-import";

const key = (purpose: string) => {
  if (!process.env.LOGIN_PWD) throw new ImportRequestError("请先配置网页登录密码", 503);
  return scryptSync(process.env.LOGIN_PWD, `flatkey-dataforseo-${purpose}-v1`, 32);
};
export function encryptDataForSeoCredentials(apiLogin: string, apiPassword: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key("credentials"), iv);
  cipher.setAAD(Buffer.from("flatkey.ai:dataforseo:v1"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ apiLogin, apiPassword }), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptDataForSeoCredentials(value: string): { apiLogin: string; apiPassword: string } {
  try {
    const [version, iv, tag, ciphertext, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("invalid");
    const decipher = createDecipheriv("aes-256-gcm", key("credentials"), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from("flatkey.ai:dataforseo:v1")); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"));
    if (typeof parsed.apiLogin !== "string" || !parsed.apiLogin || typeof parsed.apiPassword !== "string" || !parsed.apiPassword) throw new Error("invalid");
    return parsed;
  } catch { throw new ImportRequestError("API连接无法解密，请重新保存凭据（网页登录密码变更后需要重新连接）", 409); }
}
export function maskDataForSeoLogin(value: string) { return `${value.slice(0, 1)}***${value.includes("@") ? "@***" : ""}`; }
export function signDataForSeoPreview(claims: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encoded}.${createHmac("sha256", key("preview")).update(encoded).digest("base64url")}`;
}
export function verifyDataForSeoPreview(token: string): Record<string, unknown> {
  try {
    const [encoded, signature, extra] = token.split(".");
    const expected = createHmac("sha256", key("preview")).update(encoded).digest(), actual = Buffer.from(signature, "base64url");
    if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid");
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch { throw new ImportRequestError("费用预览已失效，请重新预览", 409); }
}
