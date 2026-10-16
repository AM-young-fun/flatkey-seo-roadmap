// Tab-scoped cache, never a public/CDN cache. Compression keeps the full
// inventory within browser quotas without dropping keywords or countries.
export type DashboardPersistence = {
  load(key: string): Promise<{ body: string; savedAt: number } | null>;
  save(key: string, body: string, savedAt: number): Promise<void>;
  clear(): void;
};
const PREFIX = "seo-dashboard-labs-v2:";
let epoch = 0;

export const dashboardSession: DashboardPersistence = {
  async load(key) {
    if (typeof window === "undefined" || typeof DecompressionStream === "undefined") return null;
    try {
      const value = sessionStorage.getItem(PREFIX + key);
      if (!value) return null;
      const cached = JSON.parse(value) as { data: string; savedAt: number };
      if (!Number.isFinite(cached.savedAt) || Date.now() - cached.savedAt > 15 * 60000 || cached.savedAt > Date.now() + 60000) return null;
      const bytes = Uint8Array.from(atob(cached.data), c => c.charCodeAt(0));
      const body = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
      return { body, savedAt: cached.savedAt };
    } catch { return null; }
  },
  async save(key, body, savedAt) {
    if (typeof window === "undefined" || typeof CompressionStream === "undefined") return;
    const started = epoch;
    try {
      const bytes = new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      if (started === epoch) sessionStorage.setItem(PREFIX + key, JSON.stringify({ savedAt, data: btoa(binary) }));
    } catch { /* Storage unavailable or full: network loading still works. */ }
  },
  clear() {
    epoch++;
    if (typeof window === "undefined") return;
    try {
      for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
    } catch { /* Storage may be disabled. */ }
  },
};
