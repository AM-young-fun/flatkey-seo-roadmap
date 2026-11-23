"use client";
import { useCallback, useEffect, useState } from "react";
import { dashboardStore, DashboardReadError } from "@/lib/dashboard-client";
import { createPendingDisplayPoll } from "@/lib/pending-display-poll";
import { interactionFeedback } from "@/lib/interaction-feedback";

export function useDashboard(site = "all", source = "dataforseo_serp", includeResearch = false) {
  const key = `${site}:${source}:${includeResearch ? "library" : "formal"}`;
  const [state, setState] = useState(() => ({ key, data: dashboardStore.peek(site, source, includeResearch), error: null as string | null, cached: false }));
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    let active = true;
    const reads = new Set<() => void>();
    const pendingPoll = createPendingDisplayPoll(() => { void update(true); });
    const update = async (force = false) => {
      if (!pendingPoll.canRead()) return;
      pendingPoll.cancel();
      const finish = force || !dashboardStore.peek(site, source, includeResearch)
        ? interactionFeedback.begin("read", "正在加载总览数据…") : () => {};
      reads.add(finish);
      try {
        const data = await dashboardStore.read(site, source, force, includeResearch);
        pendingPoll.update(Boolean(data.displaySnapshot?.pending));
        if (active) setState(previous => previous.key === key && previous.data === data && !previous.error && !previous.cached ? previous : { key, data, error: null, cached: false });
      } catch (error) {
        pendingPoll.cancel();
        if (!active) return;
        if (error instanceof DashboardReadError && error.status === 401) {
          dashboardStore.clear();
          window.location.assign("/login");
          return;
        }
        setState(previous => ({ key, data: previous.key === key ? previous.data : dashboardStore.peek(site, source, includeResearch), error: error instanceof Error ? error.message : "加载失败", cached: previous.cached }));
      } finally { finish(); reads.delete(finish); }
    };
    let completed = false;
    void dashboardStore.hydrate(site, source, includeResearch).then(data => {
      if (active && data && !completed) setState(previous => previous.data ? previous : { key, data, error: null, cached: true });
    });
    void update(version > 0).finally(() => { completed = true; });
    const onVisible = () => { if (!document.hidden) void update(); };
    const timer = window.setInterval(onVisible, 5 * 60000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const onRankingsUpdated = () => { void update(true); };
    window.addEventListener("seo-rankings-updated", onRankingsUpdated);
    return () => {
      active = false; pendingPoll.dispose();
      reads.forEach(finish => finish()); reads.clear();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("seo-rankings-updated", onRankingsUpdated);
    };
  }, [key, site, source, includeResearch, version]);
  const data = state.key === key ? state.data : dashboardStore.peek(site, source, includeResearch);
  const error = state.key === key ? state.error : null;
  return { data, error, loading: !data && !error, refreshing: state.key === key && state.cached && !error, refresh };
}
