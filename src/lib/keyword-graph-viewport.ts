export type KeywordGraphViewport = { zoom?: number; center?: [number | string, number | string] };

/** ECharts 6.1 cannot invert a graph View whose container has zero width or height. */
export function keywordGraphDimensions(target: Pick<HTMLElement, "isConnected" | "clientWidth" | "clientHeight">) {
  const width = target.clientWidth, height = target.clientHeight;
  return target.isConnected && Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? { width, height } : null;
}

/** Keep genuine roaming state, not a transient/invalid transform from a previous render. */
export function keywordGraphViewport(value: unknown): KeywordGraphViewport {
  if (!value || typeof value !== "object") return {};
  const row = value as { zoom?: unknown; center?: unknown }, viewport: KeywordGraphViewport = {};
  if (typeof row.zoom === "number" && Number.isFinite(row.zoom) && row.zoom > 0) viewport.zoom = row.zoom;
  const coordinate = (part: unknown): part is number | string => typeof part === "number" ? Number.isFinite(part)
    : typeof part === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(part) && Number.isFinite(Number(part.slice(0, -1)));
  if (Array.isArray(row.center) && row.center.length === 2 && row.center.every(coordinate)) viewport.center = [row.center[0], row.center[1]];
  return viewport;
}
