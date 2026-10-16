"use client";
import { useCallback, useEffect, useState } from "react";
import type { SearchRegionCode } from "@/lib/seo";
import type { SerpResultsResponse } from "@/lib/serp-results";

export function useSerpResults(site: string, region: SearchRegionCode) {
  const key = `${site}:${region}`;
  const [state, setState] = useState<{ key: string; data: SerpResultsResponse | null; error: string | null } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/serp-monitor/results?${new URLSearchParams({ site, region })}`, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { window.location.assign("/login"); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "实测排名读取失败");
        if (result.schemaVersion !== 1 || result.source !== "dataforseo_serp") throw new Error("实测排名响应不完整");
        if (!controller.signal.aborted) setState({ key, data: result, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, data: null, error: error instanceof Error ? error.message : "实测排名读取失败" });
      }
    })();
    window.addEventListener("seo-rankings-updated", refresh);
    return () => { controller.abort(); window.removeEventListener("seo-rankings-updated", refresh); };
  }, [key, site, region, revision, refresh]);
  const current = state?.key === key ? state : null;
  return { data: current?.data ?? null, loading: !current, error: current?.error ?? null, refresh };
}
