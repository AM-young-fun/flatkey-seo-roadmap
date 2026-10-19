"use client";
import { useEffect, useRef, useState } from "react";
import { collectionIsActive, type SerpCollectionProgress } from "@/lib/serp-collection-progress";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";

export function CollectionProgress({site = "all"}: {site?: string}) {
  const [progress,setProgress] = useState<SerpCollectionProgress | null>(null);
  const [failed,setFailed] = useState(false);
  const previousStatus = useRef<string | null>(null);
  useEffect(() => {
    let disposed = false, busy = false, timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      if (disposed || busy) return;
      if (document.hidden) { timer = setTimeout(read,30_000); return; }
      busy = true;
      let pollAfter = 5 * 60_000;
      try {
        const data = await clientReadCache.read<{progress:SerpCollectionProgress | null}>(`/api/serp-monitor?progress=1&site=${encodeURIComponent(site)}`,false,20_000);
        if (!disposed) {
          const status = data.progress?.status ?? null;
          if (status && collectionIsActive(status)) pollAfter = 30_000;
          if (previousStatus.current && collectionIsActive(previousStatus.current) && status && !collectionIsActive(status)) window.dispatchEvent(new Event("seo-rankings-updated"));
          previousStatus.current = status; setProgress(data.progress); setFailed(false);
        }
      } catch (error) {
        if (error instanceof ClientReadError && error.status === 401) { window.location.assign("/login"); return; }
        if (!disposed) setFailed(true);
        pollAfter = 30_000;
      } finally { busy = false; if (!disposed) timer = setTimeout(read,pollAfter); }
    };
    void read();
    return () => { disposed = true; clearTimeout(timer); };
  },[site]);
  if (!progress) return failed ? <p className="chartNote">本轮采集进度暂时无法读取。</p> : null;
  const active = collectionIsActive(progress.status), complete = progress.status === "COMPLETED";
  return <div className="collectionProgress" role="status" aria-label="本轮排名采集进度">
    <div className="collectionProgressHeading"><strong>Flatkey · {progress.periodLabel} · {active ? "采集中" : complete ? "已完成" : "采集需处理"}</strong><span>{progress.completedQueries.toLocaleString()} / {progress.totalQueries.toLocaleString()} 次查询已完成</span></div>
    <div className="collectionProgressTrack" role="progressbar" aria-label="四国查询完成进度" aria-valuemin={0} aria-valuemax={progress.totalQueries} aria-valuenow={progress.completedQueries}><i style={{width:`${progress.totalQueries ? progress.completedQueries/progress.totalQueries*100 : 0}%`}} /></div>
    <p>四国均完成 {progress.completedKeywords.toLocaleString()} / {progress.totalKeywords.toLocaleString()} 词{active ? ` · 待提交 ${progress.plannedQueries.toLocaleString()} · 等待返回 ${progress.waitingQueries.toLocaleString()}${progress.processingQueries ? ` · 正在整理 ${progress.processingQueries}` : ""}` : ""}{progress.failedQueries ? ` · 异常 ${progress.failedQueries}` : ""}{failed ? " · 进度更新暂时中断" : ""}</p>
  </div>;
}
