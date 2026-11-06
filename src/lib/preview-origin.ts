/** Next's development server may normalize request.url to localhost. */
export function isLocalPreviewRequest(request: Request): boolean {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  return ["localhost", "127.0.0.1"].includes(url.hostname)
    && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

export function isLocalPreviewOrigin(request: Request): boolean {
  if (!isLocalPreviewRequest(request)) return false;
  const url = new URL(request.url);
  return request.headers.get("origin") === `${url.protocol}//${request.headers.get("host") ?? url.host}`;
}
