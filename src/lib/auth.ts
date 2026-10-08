export const AUTH_COOKIE_NAME = "seo_rank_auth";
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function base64Url(bytes: Uint8Array): string {
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function isAuthEnabled(): boolean {
  return Boolean(process.env.LOGIN_PWD);
}

export async function getAuthToken(password = process.env.LOGIN_PWD ?? ""): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`seo-rank-monitor:${password}`)
  );

  return base64Url(new Uint8Array(digest));
}

export async function isValidAuthToken(token: string | undefined): Promise<boolean> {
  if (!process.env.LOGIN_PWD || !token) {
    return !process.env.LOGIN_PWD;
  }

  return token === (await getAuthToken());
}
