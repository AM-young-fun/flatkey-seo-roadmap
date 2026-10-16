"use client";
import { useCallback, useEffect, useState } from "react";
import { dashboardStore, DashboardReadError } from "@/lib/dashboard-client";

export function useDashboard(site = "all", source = "dataforseo_labs") {
  const key = `${site}:${source}`;
  const [state, setState] = useState(() => ({ key, data: dashboardStore.peek(site, source), error: null as string | null, cached: false }));
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    let active = true;
    const update = async (force = false) => {
      try {
        const data = await dashboardStore.read(site, source, force);
        if (active) setState(previous => previous.key === key && previous.data === data && !previous.error && !previous.cached ? previous : { key, data, error: null, cached: false });
      } catch (error) {
        if (!active) return;
        if (error instanceof DashboardReadError && error.status === 401) {
          dashboardStore.clear();
          window.location.assign("/login");
          return;
        }
        setState(previous => ({ key, data: previous.key === key ? previous.data : dashboardStore.peek(site, source), error: error instanceof Error ? error.message : "加载失败", cached: previous.cached }));
      }
    };
    let completed = false;
    void dashboardStore.hydrate(site, source).then(data => {
      if (active && data && !completed) setState(previous => previous.data ? previous : { key, data, error: null, cached: true });
    });
    void update(version > 0).finally(() => { completed = true; });
    const onVisible = () => { if (!document.hidden) void update(); };
    const timer = window.setInterval(onVisible, 60000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [key, site, source, version]);
  const data = state.key === key ? state.data : dashboardStore.peek(site, source);
  const error = state.key === key ? state.error : null;
  return { data, error, loading: !data && !error, refreshing: state.key === key && state.cached && !error, refresh };
}
