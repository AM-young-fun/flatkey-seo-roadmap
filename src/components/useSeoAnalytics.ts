"use client";

import { useEffect, useState } from "react";
import { clientReadCache } from "@/lib/client-read-cache";
import type { DateRange } from "@/lib/seo-date-range";
import type { SeoCountry } from "@/lib/seo";

export type AnalyticsSource = {
  status: "ready" | "partial" | "missing" | "error";
  through: string | null;
  observedAt: string | null;
  reason: string | null;
};

export type SessionDay = { date: string; sessions: number | null; registrations: number | null };

export type PagePerformance = {
  url: string;
  ga4: { sessions: number | null; registrations: number | null; days: number } | null;
  gsc: { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null; days: number } | null;
};

export type SeoAnalytics = DateRange & {
  scope: "session-organic-search";
  ga4: AnalyticsSource;
  gsc: AnalyticsSource;
  daily: SessionDay[];
  pages: PagePerformance[];
};

export function useSeoRead<T>(url: string | null) {
  const [result, setResult] = useState<{ url: string; data: T | null; error: string | null } | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!url) return;
    let active = true, pending = false;
    async function read() {
      if (!url || pending) return;
      pending = true;
      try {
        const data = await clientReadCache.read<T>(url, refresh > 0, 60_000);
        if (active) setResult({ url, data, error: null });
      } catch (error) {
        if (active) setResult({ url, data: null, error: error instanceof Error ? error.message : "数据读取失败" });
      } finally { pending = false; }
    }
    void read();
    const readWhenVisible = () => { if (!document.hidden) void read(); };
    document.addEventListener("visibilitychange", readWhenVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", readWhenVisible);
    };
  }, [url, refresh]);
  const current = result?.url === url ? result : null;
  return { data: current?.data ?? null, error: current?.error ?? null, retry: () => setRefresh(value => value + 1) };
}

export function analyticsUrl(range: DateRange, urls: string[] = [], country: SeoCountry = "all"): string {
  const query = new URLSearchParams(range);
  if (country !== "all") query.set("country", country);
  urls.forEach(url => query.append("url", url));
  return `/api/seo/analytics?${query}`;
}

export const numberText = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("zh-CN");
export const shanghaiStamp = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
