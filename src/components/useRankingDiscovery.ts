"use client";
import { useCallback, useEffect, useState } from "react";
import type { SearchRegionCode } from "@/lib/seo";
import type { RankingDiscoveryResponse } from "@/lib/ranking-discovery-types";

export function useRankingDiscovery(site: string, region: SearchRegionCode) {
  const key = `${site}:${region}`;
  const [state, setState] = useState<{ key: string; data: RankingDiscoveryResponse | null; error: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      try {
        const response = await fetch(`/api/rankings/discovery?${new URLSearchParams({ site, region })}`, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { window.location.assign("/login"); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "排名发现读取失败");
        if (!controller.signal.aborted) setState({ key, data: result, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, data: null, error: error instanceof Error ? error.message : "排名发现读取失败" });
      }
    };
    void read();
    const onUpdated = () => refresh();
    window.addEventListener("seo-rankings-updated", onUpdated);
    return () => { controller.abort(); window.removeEventListener("seo-rankings-updated", onUpdated); };
  }, [key, site, region, version, refresh]);
  const current = state?.key === key ? state : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: !current, refresh };
}
