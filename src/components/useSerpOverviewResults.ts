"use client";
import { useDashboard } from "./useDashboard";

export function useSerpOverviewResults(site: string) {
  // Share the same in-flight inventory and rank read as the network graph.
  const { data, loading, error, refresh } = useDashboard(site, "dataforseo_serp");
  return { data: data?.serpOverview ?? null, loading, error, refresh };
}
