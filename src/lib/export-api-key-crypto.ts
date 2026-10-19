import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

const aad = Buffer.from("seo-keyword-export-api-key:v1");
const encryptionKey = () => {
  if (!process.env.LOGIN_PWD) throw new Error("LOGIN_PWD is required");
  return scryptSync(process.env.LOGIN_PWD, aad, 32);
};
export const hashExportApiKey = (value: string) => createHash("sha256").update(value).digest("hex");
export const generateExportApiKey = () => `seo_export_${randomBytes(32).toString("base64url")}`;
export function encryptExportApiKey(value: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
export function decryptExportApiKey(value: string): string {
  const [version, iv, tag, ciphertext, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("Invalid encrypted API key");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(aad); decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
