"use client";
import { useEffect, useState } from "react";
import type { SearchRegionCode } from "@/lib/seo";

export const SITES = [ { domain: "flatkey.ai", name: "Flatkey" }, { domain: "rackrate.org", name: "RackRate" }, { domain: "modelfit.cc", name: "ModelFit" } ];
export function useSeoSelection() {
  const [site, setSite] = useState("flatkey.ai");
  const [source, setSource] = useState("ahrefs");
  const [region, setRegion] = useState<SearchRegionCode>("US");
  useEffect(() => {
    const saved = localStorage.getItem("seo-selection");
    try {
      const value = saved ? JSON.parse(saved) : null;
      if (SITES.some((s) => s.domain === value?.site)) setSite(value.site);
      if (["ahrefs", "gsc"].includes(value?.source)) setSource(value.source);
      if (["US", "JP", "ES", "BR"].includes(value?.region)) setRegion(value.region);
    } catch { /* Ignore obsolete preferences. */ }
  }, []);
  function remember(next: { site?: string; source?: string; region?: SearchRegionCode }) {
    localStorage.setItem("seo-selection", JSON.stringify({ site, source, region, ...next }));
    if (next.site) setSite(next.site);
    if (next.source) setSource(next.source);
    if (next.region) setRegion(next.region);
  }
  return { site, source, region, setSite: (site: string) => remember({ site }), setSource: (source: string) => remember({ source }), setRegion: (region: SearchRegionCode) => remember({ region }) };
}
export type SeoSelection = ReturnType<typeof useSeoSelection>;
