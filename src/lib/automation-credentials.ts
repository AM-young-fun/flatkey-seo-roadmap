import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
const aad = Buffer.from("flatkey-project-automation-v1");
const key = () => {
  if (!process.env.LOGIN_PWD) throw new Error("AUTH_NOT_CONFIGURED");
  return scryptSync(process.env.LOGIN_PWD, aad, 32);
};
export function encryptAutomationCredential(value: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}
export function decryptAutomationCredential(value: string): string {
  const [version, iv, tag, body, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body || extra) throw new Error("CREDENTIAL_INVALID");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  cipher.setAAD(aad); cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([cipher.update(Buffer.from(body, "base64url")), cipher.final()]).toString("utf8");
}
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function workerTokenMatches(header: string | null, hash: string | null) {
  if (!hash || !header?.startsWith("Bearer fk_worker_")) return false;
  const actual = Buffer.from(tokenHash(header.slice(7)), "hex"), expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
