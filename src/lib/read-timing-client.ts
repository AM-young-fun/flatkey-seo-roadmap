/** Explicit, private browser diagnostics; never log search text, rows or secrets. */
export function logReadTiming(url: string, response: Response, started: number, value: unknown) {
  if (typeof window === "undefined" || new URLSearchParams(window.location.search).get("performance") !== "1") return;
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
  console.info("[SEO read] " + JSON.stringify({path:new URL(url,window.location.origin).pathname,
    durationMs:Math.round(performance.now()-started),serverTiming:response.headers.get("Server-Timing"),payloadBytes:bytes}));
}
