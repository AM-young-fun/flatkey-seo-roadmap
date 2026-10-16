import type { DashboardResponse } from "@/lib/types";
import { dashboardSession, type DashboardPersistence } from "@/lib/dashboard-session";

export class DashboardReadError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Navigation and focus events share a request rather than aborting and starting
// another full database read whenever a dashboard component mounts.
export function createDashboardStore(fetcher: typeof fetch = fetch, now = Date.now, persistence?: DashboardPersistence) {
  const entries = new Map<string, { value?: DashboardResponse; updatedAt: number; body?: string; pending?: Promise<DashboardResponse> }>();
  const keyFor = (site: string, source: string, includeResearch = false) => `serp-rankings-v1:${site}:${source}:${includeResearch ? "library" : "formal"}`;
  let generation = 0;
  const clear = () => { generation++; entries.clear(); persistence?.clear(); };
  return {
    revision: () => generation,
    peek: (site: string, source: string, includeResearch = false) => entries.get(keyFor(site, source, includeResearch))?.value ?? null,
    clear,
    async hydrate(site: string, source: string, includeResearch = false): Promise<DashboardResponse | null> {
      const key = keyFor(site, source, includeResearch);
      const started = generation;
      if (entries.get(key)?.value) return entries.get(key)!.value!;
      try {
        const saved = await persistence?.load(key);
        if (!saved || started !== generation || now() - saved.savedAt > 15 * 60000) return null;
        const value = JSON.parse(saved.body) as DashboardResponse;
        if (!Array.isArray(value.keywords) || !Array.isArray(value.topics)) return null;
        const entry = entries.get(key) ?? { updatedAt: 0 };
        // A network response that finished during decompression wins.
        if (!entry.value) { entry.value = value; entry.body = saved.body; entries.set(key, entry); }
        return entry.value;
      } catch { return null; }
    },
    read(site: string, source: string, force = false, includeResearch = false): Promise<DashboardResponse> {
      const key = keyFor(site, source, includeResearch);
      const entry = entries.get(key) ?? { updatedAt: 0 };
      if (entry.pending) return entry.pending;
      if (!force && entry.value && now() - entry.updatedAt < 30000) return Promise.resolve(entry.value);
      entries.set(key, entry);
      const started = generation;
      entry.pending = (async () => {
        let payload: DashboardResponse | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetcher(`/api/dashboard?site=${encodeURIComponent(site)}&source=${encodeURIComponent(source)}${includeResearch ? "&includeResearch=1" : ""}${force ? "&refresh=1" : ""}`, { cache: "no-store" });
            if (!response.ok) {
              if (response.status === 401) clear();
              const failure = await response.json().catch(() => ({})) as { code?: string };
              throw new DashboardReadError(`数据加载失败${failure.code ? `（${failure.code}）` : `（${response.status}）`}，请重试`, response.status);
            }
            const body = await response.text();
            payload = entry.body === body && entry.value ? entry.value : JSON.parse(body) as DashboardResponse;
            entry.body = body;
            break;
          } catch (error) {
            if (error instanceof DashboardReadError && error.status < 500 || attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 600));
          }
        }
        if (!payload) throw new Error("数据加载失败，请重试");
        entry.value = payload;
        entry.updatedAt = now();
        if (started === generation && entry.body) void persistence?.save(key, entry.body, entry.updatedAt).catch(() => {});
        return payload;
      })().finally(() => { entry.pending = undefined; });
      return entry.pending;
    },
  };
}

export const dashboardStore = createDashboardStore(fetch, Date.now, dashboardSession);
