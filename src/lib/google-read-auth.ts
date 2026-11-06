import "server-only";
import { createHash, sign } from "node:crypto";
import { readFile } from "node:fs/promises";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

type ErrorCode = "missing_credentials" | "invalid_credentials" | "auth_failed" |
  "forbidden" | "rate_limited" | "unavailable" | "invalid_response";

export class GoogleReadError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly status?: number) {
    super(message);
    this.name = "GoogleReadError";
  }
}

type AccessToken = { token: string; expiresAt: number };
const tokens = new Map<string, Promise<AccessToken>>();

async function credentialsText() {
  const configured = process.env.SEO_GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (configured) return configured;
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!file) throw new GoogleReadError("missing_credentials", "Google 只读凭据未配置");
  try {
    return await readFile(file, "utf8");
  } catch {
    throw new GoogleReadError("invalid_credentials", "无法读取配置的 Google 凭据文件");
  }
}

function tokenForm(raw: string, scope: string): URLSearchParams {
  try {
    const credential = JSON.parse(raw);
    if (credential?.type === "service_account" && credential.client_email && credential.private_key) {
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const issuedAt = Math.floor(Date.now() / 1000);
      const assertion = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
        iss: credential.client_email,
        scope,
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + 3600,
      })}`;
      const signature = sign("RSA-SHA256", Buffer.from(assertion), credential.private_key).toString("base64url");
      return new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${assertion}.${signature}`,
      });
    }
    if (credential?.type === "authorized_user" && credential.client_id && credential.client_secret && credential.refresh_token) {
      return new URLSearchParams({
        grant_type: "refresh_token",
        client_id: credential.client_id,
        client_secret: credential.client_secret,
        refresh_token: credential.refresh_token,
        scope,
      });
    }
  } catch {
    // Provider errors can include credentials or local paths. Return a safe diagnostic.
  }
  throw new GoogleReadError("invalid_credentials", "Google 凭据格式无效");
}

async function exchange(raw: string, scope: string): Promise<AccessToken> {
  const body = tokenForm(raw, scope);
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GoogleReadError("unavailable", "无法连接 Google OAuth 服务");
  }
  if (!response.ok) {
    if (response.status === 429) throw new GoogleReadError("rate_limited", "Google OAuth 请求已限流", response.status);
    if (response.status >= 500) throw new GoogleReadError("unavailable", "Google OAuth 服务暂不可用", response.status);
    throw new GoogleReadError("auth_failed", "Google OAuth 授权失败", response.status);
  }
  const result = await response.json().catch(() => null);
  if (typeof result?.access_token !== "string" || !result.access_token.trim() ||
      typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0) {
    throw new GoogleReadError("invalid_response", "Google OAuth 响应格式无效");
  }
  return { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
}

export async function getGoogleReadAccessToken(scope: string): Promise<string> {
  const raw = await credentialsText();
  const key = createHash("sha256").update(scope).update("\0").update(raw).digest("hex");
  const cached = tokens.get(key);
  if (cached) {
    const entry = await cached;
    if (entry.expiresAt > Date.now() + 60_000) return entry.token;
    if (tokens.get(key) !== cached) return (await tokens.get(key)!).token;
  }

  const pending = exchange(raw, scope);
  tokens.set(key, pending);
  try {
    return (await pending).token;
  } catch (error) {
    if (tokens.get(key) === pending) tokens.delete(key);
    throw error;
  }
}
