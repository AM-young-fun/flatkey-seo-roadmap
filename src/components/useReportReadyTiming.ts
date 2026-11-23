"use client";
import { useEffect, useRef } from "react";

// Local opt-in diagnostics only. Nothing is sent to an analytics service.
export function useReportReadyTiming(ready: boolean, key: string) {
  const mountedAt = useRef<number | null>(null), logged = useRef<string | null>(null);
  if (mountedAt.current === null) mountedAt.current = performance.now();
  useEffect(() => {
    if (!ready || logged.current === key || new URLSearchParams(location.search).get("performance") !== "1") return;
    let second: number;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        logged.current = key;
        const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        const initialDocument = navigation?.name === location.href;
        console.info("[SEO report ready] " + JSON.stringify({
          documentMs: initialDocument ? Math.round(performance.now()) : null,
          componentMs: Math.round(performance.now() - mountedAt.current!),
          basis: "report DOM committed and two animation frames elapsed",
        }));
      });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [ready, key]);
}
