"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clientReadCache } from "@/lib/client-read-cache";
import type { DateRange } from "@/lib/seo-date-range";
import type { SeoCountry } from "@/lib/seo";

export type AnalyticsSource = {
  status: "ready" | "partial" | "missing" | "error";
  sessionsStatus?: "ready" | "partial" | "missing";
  registrationsStatus?: "ready" | "partial" | "missing";
  through: string | null;
  observedAt: string | null;
  reason: string | null;
};

export type SessionDay = { date: string; sessions: number | null; registrations: number | null };

export type PagePerformance = {
  url: string;
  sourceUrls?: string[];
  ga4: { sessions: number | null; registrations: number | null; days: number } | null;
  gsc: { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null; days: number } | null;
};

export type SeoAnalytics = DateRange & {
  scope: "session-organic-search";
  registrationMetric?: "sign_up_success" | "sign_up_or_legacy_distinct_users";
  ga4: AnalyticsSource;
  gsc: AnalyticsSource;
  daily: SessionDay[];
  pages: PagePerformance[];
};

export function useSeoRead<T>(url: string | null) {
  const revision = useSyncExternalStore(clientReadCache.subscribe, clientReadCache.revision, () => 0);
  const [result, setResult] = useState<{ url: string; revision: number; data: T | null; error: string | null } | null>(null);
  const [refresh, setRefresh] = useState({ url, id: 0 });
  const consumedRefresh = useRef(0);
  useEffect(() => {
    const force = refresh.url === url && refresh.id > consumedRefresh.current;
    consumedRefresh.current = refresh.id;
    if (!url) return;
    let active = true, pending = false;
    async function read(force = false) {
      if (!url || pending) return;
      pending = true;
      try {
        const data = await clientReadCache.read<T>(url, force, 60_000);
        if (active && revision === clientReadCache.revision()) setResult({ url, revision, data, error: null });
      } catch (error) {
        if (active && revision === clientReadCache.revision()) setResult({ url, revision, data: null, error: error instanceof Error ? error.message : "数据读取失败" });
      } finally { pending = false; }
    }
    void read(force);
    const readWhenVisible = () => { if (!document.hidden) void read(); };
    document.addEventListener("visibilitychange", readWhenVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", readWhenVisible);
    };
  }, [url, refresh, revision]);
  const current = result?.url === url && result.revision === revision ? result : null;
  // Only this URL and this session's fresh cache can fill the first render.
  // Failed reads keep their error rather than falling back to a success.
  const cached = url && revision === clientReadCache.revision() ? clientReadCache.peekFresh<T>(url) : null;
  return { data: current ? current.data : cached, error: current?.error ?? null, retry: () => setRefresh(value => ({ url, id: value.id + 1 })) };
}

export function analyticsUrl(range: DateRange, urls: string[] = [], country: SeoCountry = "all", site?: string): string {
  const query = new URLSearchParams(range);
  if (country !== "all") query.set("country", country);
  if (site) query.set("site", site);
  urls.forEach(url => query.append("url", url));
  return `/api/seo/analytics?${query}`;
}

export const numberText = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("zh-CN");
export const shanghaiStamp = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
