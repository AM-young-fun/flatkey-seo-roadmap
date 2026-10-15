import type { DashboardResponse } from "@/lib/types";

export class DashboardReadError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Navigation and focus events share a request rather than aborting and starting
// another full database read whenever a dashboard component mounts.
export function createDashboardStore(fetcher: typeof fetch = fetch, now = Date.now) {
  const entries = new Map<string, { value?: DashboardResponse; updatedAt: number; body?: string; pending?: Promise<DashboardResponse> }>();
  const keyFor = (site: string, source: string) => `${site}:${source}`;
  return {
    peek: (site: string, source: string) => entries.get(keyFor(site, source))?.value ?? null,
    clear: () => entries.clear(),
    read(site: string, source: string, force = false): Promise<DashboardResponse> {
      const key = keyFor(site, source);
      const entry = entries.get(key) ?? { updatedAt: 0 };
      if (entry.pending) return entry.pending;
      if (!force && entry.value && now() - entry.updatedAt < 30000) return Promise.resolve(entry.value);
      entries.set(key, entry);
      entry.pending = (async () => {
        let payload: DashboardResponse | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetcher(`/api/dashboard?site=${encodeURIComponent(site)}&source=${encodeURIComponent(source)}`, { cache: "no-store" });
            if (!response.ok) {
              if (response.status === 401) entries.clear();
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
        return payload;
      })().finally(() => { entry.pending = undefined; });
      return entry.pending;
    },
  };
}

export const dashboardStore = createDashboardStore();
