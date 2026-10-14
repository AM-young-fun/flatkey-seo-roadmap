"use client";
import { useEffect, useState } from "react";
import type { SearchRegionCode } from "@/lib/seo";

export const SITES = [ { domain: "flatkey.ai", name: "Flatkey" }, { domain: "rackrate.org", name: "RackRate" }, { domain: "modelfit.cc", name: "ModelFit" } ];
export function useSeoSelection() {
  const [region, setRegion] = useState<SearchRegionCode>("US");
  useEffect(() => {
    const saved = localStorage.getItem("seo-selection");
    try {
      const value = saved ? JSON.parse(saved) : null;
      if (["US", "JP", "ES", "BR"].includes(value?.region)) setRegion(value.region);
    } catch { /* Ignore obsolete preferences. */ }
  }, []);
  function remember(next: { site?: string; source?: string; region?: SearchRegionCode }) {
    localStorage.setItem("seo-selection", JSON.stringify({ region, ...next }));
    if (next.region) setRegion(next.region);
  }
  return { site: "all", source: "combined", region, setRegion: (region: SearchRegionCode) => remember({ region }) };
}
export type SeoSelection = ReturnType<typeof useSeoSelection>;
