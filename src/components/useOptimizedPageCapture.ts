"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OptimizedPageMonitorResponse } from "@/lib/optimized-page-monitor";
import { dashboardStore } from "@/lib/dashboard-client";

export type OptimizedKeywordPage = OptimizedPageMonitorResponse["pages"][number];
const endpoint = "/api/rankings/monitor";

export function useOptimizedPageCapture() {
  const [data, setData] = useState<OptimizedPageMonitorResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const actionLock = useRef(false), pollLock = useRef(false);
  const [busyAction, setBusyAction] = useState<"start" | "retry" | null>(null);
  const read = useCallback(async (notify = false) => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "优化页面读取失败");
    setData(result as OptimizedPageMonitorResponse);
    if (notify) { dashboardStore.clear(); window.dispatchEvent(new Event("seo-rankings-updated")); }
  }, []);
  const refresh = useCallback(async () => {
    try { await read(); setError(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "优化页面读取失败"); }
  }, [read]);
  useEffect(() => {
    void refresh();
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", refreshVisible);
    const timer = window.setInterval(refreshVisible, 60_000);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [refresh]);
  const activeRunId = data?.activeRunId;
  useEffect(() => {
    if (!activeRunId) return;
    const collect = async () => {
      if (pollLock.current || actionLock.current) return;
      pollLock.current = true;
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "poll", runId: activeRunId }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "结果读取失败");
        await read(true); setError(null);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "结果读取失败"); }
      finally { pollLock.current = false; }
    };
    const timer = window.setInterval(() => void collect(), 30_000);
    return () => window.clearInterval(timer);
  }, [activeRunId, read]);
  async function act(page: OptimizedKeywordPage, action: "start" | "retry") {
    if (!data || actionLock.current || action === "retry" && !page.run) return;
    actionLock.current = true; setBusy(page.id); setBusyAction(action); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "retry" ? { action: "retry", runId: page.run!.id }
          : { action: "start", pageId: page.id, expectedHash: page.hash, day: data.day }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "抓取结果暂时无法确认");
      await read(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "抓取结果暂时无法确认");
      // A lost HTTP response must still reveal the committed daily claim.
      try { await read(); } catch { /* Preserve the submission error. */ }
    } finally { actionLock.current = false; setBusy(null); setBusyAction(null); }
  }
  return { data, busy, busyAction, error, refresh, start: (page: OptimizedKeywordPage) => act(page, "start"), retry: (page: OptimizedKeywordPage) => act(page, "retry") };
}
