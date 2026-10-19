// Memory only, scoped to this tab. Never cache POSTs, credentials, failures or
// use a public/CDN cache for authenticated business data.
export class ClientReadError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function createClientReadCache(fetcher: typeof fetch = fetch, now = Date.now) {
  const entries = new Map<string, { value: unknown; expires: number }>();
  const pending = new Map<string, Promise<unknown>>();
  let generation = 0;
  return {
    clear() { generation++; entries.clear(); pending.clear(); },
    peek<T>(url: string): T | null { return entries.get(url)?.value as T ?? null; },
    read<T>(url: string, force = false, ttl = 60_000): Promise<T> {
      const saved = entries.get(url);
      if (!force && saved && saved.expires > now()) return Promise.resolve(saved.value as T);
      if (pending.has(url)) return pending.get(url) as Promise<T>;
      const started = generation;
      const request = (async () => {
        const response = await fetcher(url, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new ClientReadError(data.message ?? "数据读取失败，请重试", response.status);
        if (started === generation) {
          entries.set(url, { value: data, expires: now() + ttl });
          if (entries.size > 32) entries.delete(entries.keys().next().value!);
        }
        return data as T;
      })();
      pending.set(url, request);
      void request.finally(() => { if (pending.get(url) === request) pending.delete(url); }).catch(() => {});
      return request;
    },
  };
}
export const clientReadCache = createClientReadCache();
if (typeof window !== "undefined") {
  window.addEventListener("seo-rankings-updated", () => clientReadCache.clear());
  window.addEventListener("dataforseo-connection-updated", () => clientReadCache.clear());
}
