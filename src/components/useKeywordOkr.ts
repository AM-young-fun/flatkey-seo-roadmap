"use client";

import { useCallback, useEffect, useState } from "react";
import type { KeywordOkrResponse } from "@/lib/keyword-okr";
import type { KeywordPageTasksResponse } from "@/lib/keyword-page-task-read";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";

export function useKeywordOkr(options?: { allSiteTasks?: boolean; pool?: "FORMAL" | "RESEARCH" }) {
  const allSiteTasks = options?.allSiteTasks === true;
  const url = `/api/keywords/okr?site=flatkey.ai${options?.pool ? `&pool=${options.pool}` : ""}`;
  const [state, setState] = useState<{ url: string; data: KeywordOkrResponse } | null>(() => {
    const data = clientReadCache.peek<KeywordOkrResponse>(url);
    return data ? { url, data } : null;
  });
  const [pageTasks, setPageTasks] = useState<KeywordPageTasksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const [result, taskResult] = await Promise.all([
          clientReadCache.read<KeywordOkrResponse>(url, revision > 0),
          allSiteTasks ? clientReadCache.read<KeywordPageTasksResponse>("/api/keywords/page-tasks", revision > 0) : Promise.resolve(null),
        ]);
        if (typeof result.initialized !== "boolean" || !Array.isArray(result.keywords) || !Array.isArray(result.tasks)) {
          throw new Error("目标库响应不完整，请重新加载");
        }
        if (taskResult && (taskResult.kind !== "keyword-page-tasks" || !Array.isArray(taskResult.tasks) || !Array.isArray(taskResult.sites))) throw new Error("页面任务响应不完整，请重新加载");
        if (!controller.signal.aborted) {
          setState({ url, data: result });
          setPageTasks(taskResult as KeywordPageTasksResponse | null);
          setError(null);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          if (failure instanceof ClientReadError && failure.status === 401) { clientReadCache.clear(); window.location.assign("/login"); return; }
          setState(null);
          setPageTasks(null);
          setError(failure instanceof Error ? failure.message : "无法读取正式目标库");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    window.addEventListener("seo-rankings-updated", refresh);
    return () => { controller.abort(); window.removeEventListener("seo-rankings-updated", refresh); };
  }, [revision, allSiteTasks, url, refresh]);

  const data = state?.url === url ? state.data : clientReadCache.peek<KeywordOkrResponse>(url);
  return { data, pageTasks, error, loading: !data && loading, refresh };
}
