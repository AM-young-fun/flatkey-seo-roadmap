import { createHash } from "node:crypto";
import { z } from "zod";
export const REVIEW_ASSET_ORIGIN = "https://flatkey-seo-roadmap.vercel.app";
export const REVIEW_ASSET_MAX_BYTES = 1024 * 1024;
const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/);
export const reviewAssetCommand = z.object({ approvalId: identifier, itemId: identifier, contentVersion: z.string().min(1).max(200), capturedVersion: z.string().min(1).max(200), viewport: z.enum(["desktop", "mobile"]), mime: z.enum(["image/png", "image/jpeg"]), data: z.string().min(1).max(1398104) }).strict();
export const assetLabel = (viewport: "desktop" | "mobile", version: string) => `${viewport === "desktop" ? "桌面截图" : "手机截图"} · ${version}`;
export function parseReviewAsset(input: unknown) {
  const value = reviewAssetCommand.parse(input);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw Error("invalid_image_base64");
  const bytes = Buffer.from(value.data, "base64");
  if (!bytes.length || bytes.length > REVIEW_ASSET_MAX_BYTES || bytes.toString("base64") !== value.data) throw Error("invalid_image_size");
  const png = bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex")) && bytes.subarray(-12).equals(Buffer.from("0000000049454e44ae426082","hex"));
  const jpeg = bytes.length >= 4 && bytes.subarray(0,3).equals(Buffer.from("ffd8ff","hex")) && bytes.subarray(-2).equals(Buffer.from("ffd9","hex"));
  if (value.mime === "image/png" ? !png : !jpeg) throw Error("invalid_image_signature");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = createHash("sha256").update(JSON.stringify([value.approvalId,value.itemId,value.contentVersion,value.capturedVersion,value.viewport,value.mime,sha256])).digest("hex");
  return { ...value, id, sha256, bytes: bytes.length, url: `${REVIEW_ASSET_ORIGIN}/api/seo/review-assets/${id}` };
}
export type ReviewAsset = ReturnType<typeof parseReviewAsset> & { createdAt: string; actor: "human" | "collector" };
export function internalReviewAssetId(url: string | undefined): string | null {
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.origin !== REVIEW_ASSET_ORIGIN || !parsed.pathname.startsWith("/api/seo/review-assets")) return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !/^\/api\/seo\/review-assets\/[a-f0-9]{64}$/.test(parsed.pathname)) throw Error("invalid_internal_asset_url");
  return parsed.pathname.split("/").at(-1)!;
}
