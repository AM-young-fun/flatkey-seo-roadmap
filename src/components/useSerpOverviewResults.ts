"use client";
import { useCallback, useEffect, useState } from "react";
import type { SerpAllRegionsResponse } from "@/lib/serp-results";

export function useSerpOverviewResults(site: string) {
  const [state, setState] = useState<{ site: string; data: SerpAllRegionsResponse | null; error: string | null } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/serp-monitor/results?${new URLSearchParams({ site, region: "all" })}`, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { window.location.assign("/login"); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "排名汇总读取失败");
        if (result.schemaVersion !== 1 || result.source !== "dataforseo_serp" || result.region !== "all" || !Array.isArray(result.regions) || result.regions.length !== 4)
          throw new Error("四国排名汇总响应不完整");
        if (!controller.signal.aborted) setState({ site, data: result, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setState({ site, data: null, error: error instanceof Error ? error.message : "排名汇总读取失败" });
      }
    })();
    window.addEventListener("seo-rankings-updated", refresh);
    return () => { controller.abort(); window.removeEventListener("seo-rankings-updated", refresh); };
  }, [site, revision, refresh]);
  const current = state?.site === site ? state : null;
  return { data: current?.data ?? null, loading: !current, error: current?.error ?? null, refresh };
}
