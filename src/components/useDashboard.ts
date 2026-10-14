"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardResponse } from "@/lib/types";

export function useDashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const requestController = new AbortController();
    controller.current = requestController;
    try {
      const response = await fetch("/api/dashboard", {
        cache: "no-store",
        signal: requestController.signal,
      });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) throw new Error("数据加载失败，请稍后重试");
      const payload = (await response.json()) as DashboardResponse;
      if (!requestController.signal.aborted) {
        setData((previous) =>
          JSON.stringify(previous) === JSON.stringify(payload)
            ? previous
            : payload,
        );
        setError(null);
      }
    } catch (error) {
      if (!requestController.signal.aborted)
        setError(error instanceof Error ? error.message : "加载失败");
    } finally {
      if (controller.current === requestController) {
        busy.current = false;
        controller.current = null;
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
    const update = () => {
      if (!document.hidden) void refresh();
    };
    const timer = window.setInterval(update, 15_000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      controller.current?.abort();
      controller.current = null;
      busy.current = false;
    };
  }, [refresh]);
  return { data, error, loading: !data && !error, refresh };
}
