"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clientReadCache } from "@/lib/client-read-cache";
import { actionFailed, actionSucceeded, interactionFeedback } from "../lib/interaction-feedback";
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

export function useSeoRead<T>(url: string | null, { showFeedback = true, timeoutMs = 60_000 }: { showFeedback?: boolean; timeoutMs?: number } = {}) {
  const revision = useSyncExternalStore(clientReadCache.subscribe, clientReadCache.revision, () => 0);
  const [result, setResult] = useState<{ url: string; revision: number; attempt: number; data: T | null; error: string | null } | null>(null);
  const [refresh, setRefresh] = useState({ url, id: 0 });
  const [readState, setReadState] = useState<{ url: string; revision: number; pending: boolean } | null>(null);
  const consumedRefresh = useRef(0);
  const busy = useRef<string | null>(null);
  useEffect(() => {
    const force = refresh.url === url && refresh.id > consumedRefresh.current;
    consumedRefresh.current = refresh.id;
    if (!url) return;
    let active = true, pending = false;
    let finishRead: (() => void) | undefined;
    async function read(force = false) {
      if (!url || pending) return;
      pending = true;
      busy.current = url;
      const network = force || clientReadCache.peekFresh<T>(url) === null;
      if (network) setReadState({ url, revision, pending: true });
      const finish = network && showFeedback && !force ? interactionFeedback.begin("read", "正在加载页面数据…") : () => {};
      finishRead = finish;
      try {
        const data = await clientReadCache.read<T>(url, force, 60_000, timeoutMs);
        if (active && revision === clientReadCache.revision()) {
          setResult({ url, revision, attempt: refresh.id, data, error: null });
          if (force && showFeedback) actionSucceeded("数据已刷新。");
        }
      } catch (error) {
        if (active && revision === clientReadCache.revision()) {
          const message = error instanceof Error ? error.message : "数据读取失败";
          setResult({ url, revision, attempt: refresh.id, data: null, error: message });
          if (force && showFeedback) actionFailed(message);
        }
      } finally {
        finish(); if (finishRead === finish) finishRead = undefined; pending = false;
        if (active) { busy.current = null; setReadState({ url, revision, pending: false }); }
      }
    }
    void read(force);
    const readWhenVisible = () => { if (!document.hidden) void read(); };
    document.addEventListener("visibilitychange", readWhenVisible);
    return () => {
      active = false;
      finishRead?.();
      if (busy.current === url) busy.current = null;
      document.removeEventListener("visibilitychange", readWhenVisible);
    };
  }, [url, refresh, revision, showFeedback, timeoutMs]);
  const current = result?.url === url && result.revision === revision ? result : null;
  // Only this URL and this session's fresh cache can fill the first render.
  // Failed reads keep their error rather than falling back to a success.
  const cached = url && revision === clientReadCache.revision() ? clientReadCache.peekFresh<T>(url) : null;
  const data = current ? current.data : cached, error = current?.error ?? null;
  const retrying = Boolean(url && refresh.url === url && refresh.id > (current?.attempt ?? 0));
  const pending = Boolean(url && (readState?.url === url && readState.revision === revision && readState.pending
    || !data && !error || retrying));
  return { data, error, pending, retrying, loading: pending && !data, refreshing: pending && Boolean(data), retry: () => {
    if (!url || busy.current === url) return;
    busy.current = url;
    setRefresh(value => ({ url, id: value.id + 1 }));
  } };
}

export type SeoReadState<T> = ReturnType<typeof useSeoRead<T>>;

export function useOverviewRead<T>(url: string | null) {
  return useSeoRead<T>(url, { showFeedback: false, timeoutMs: 45_000 });
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
