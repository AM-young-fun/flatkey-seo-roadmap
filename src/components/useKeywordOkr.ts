"use client";

import { useCallback, useEffect, useState } from "react";
import type { KeywordOkrResponse } from "@/lib/keyword-okr";
import type { KeywordPageTasksResponse } from "@/lib/keyword-page-task-read";

export function useKeywordOkr(options?: { allSiteTasks?: boolean }) {
  const allSiteTasks = options?.allSiteTasks === true;
  const [data, setData] = useState<KeywordOkrResponse | null>(null);
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
        const [response, taskResponse] = await Promise.all([
          fetch("/api/keywords/okr?site=flatkey.ai", { cache: "no-store", signal: controller.signal }),
          allSiteTasks ? fetch("/api/keywords/page-tasks", { cache: "no-store", signal: controller.signal }) : Promise.resolve(null),
        ]);
        const result = await response.json();
        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!response.ok) throw new Error(result.message ?? "无法读取正式目标库");
        if (typeof result.initialized !== "boolean" || !Array.isArray(result.keywords) || !Array.isArray(result.tasks)) {
          throw new Error("目标库响应不完整，请重新加载");
        }
        const taskResult = taskResponse ? await taskResponse.json() : null;
        if (taskResponse && (!taskResponse.ok || taskResult.kind !== "keyword-page-tasks" || !Array.isArray(taskResult.tasks) || !Array.isArray(taskResult.sites))) throw new Error(taskResult?.message ?? "页面任务响应不完整，请重新加载");
        if (!controller.signal.aborted) {
          setData(result as KeywordOkrResponse);
          setPageTasks(taskResult as KeywordPageTasksResponse | null);
          setError(null);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setData(null);
          setPageTasks(null);
          setError(failure instanceof Error ? failure.message : "无法读取正式目标库");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision, allSiteTasks]);

  return { data, pageTasks, error, loading, refresh };
}
