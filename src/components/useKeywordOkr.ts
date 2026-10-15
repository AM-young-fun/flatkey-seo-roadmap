"use client";

import { useCallback, useEffect, useState } from "react";
import type { KeywordOkrResponse } from "@/lib/keyword-okr";

export function useKeywordOkr() {
  const [data, setData] = useState<KeywordOkrResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch("/api/keywords/okr?site=flatkey.ai", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!response.ok) throw new Error(result.message ?? "无法读取正式目标库");
        if (typeof result.initialized !== "boolean" || !Array.isArray(result.keywords) || !Array.isArray(result.tasks)) {
          throw new Error("目标库响应不完整，请重新加载");
        }
        if (!controller.signal.aborted) {
          setData(result as KeywordOkrResponse);
          setError(null);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setData(null);
          setError(failure instanceof Error ? failure.message : "无法读取正式目标库");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);

  return { data, error, loading, refresh };
}
