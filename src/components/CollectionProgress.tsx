"use client";
import { useEffect, useRef, useState } from "react";
import { Activity, CheckCircle2, ChevronUp, X } from "lucide-react";
import { collectionIsActive, type SerpCollectionProgress } from "@/lib/serp-collection-progress";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";

export function CollectionProgress({site = "all"}: {site?: string}) {
  const [progress,setProgress] = useState<SerpCollectionProgress | null>(null);
  const [failed,setFailed] = useState(false), [open,setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
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
  if (!progress) return null;
  const active = collectionIsActive(progress.status), complete = progress.status === "COMPLETED";
  const percent = progress.totalQueries ? Math.min(100, progress.completedQueries / progress.totalQueries * 100) : 0;
  const label = active ? "排名采集中" : complete ? "排名已更新" : "采集需处理";
  return <div ref={container} className="collectionFloat">
    {open ? <section className="collectionFloatDetails" id="collection-progress-details" aria-label="排名采集详情">
      <div className="collectionFloatTitle"><strong>{progress.periodLabel}</strong><button type="button" aria-label="收起采集详情" onClick={() => setOpen(false)}><X size={15} /></button></div>
      <dl><div><dt>四国查询</dt><dd>{progress.completedQueries.toLocaleString()} / {progress.totalQueries.toLocaleString()}</dd></div>
        <div><dt>四国均已完成</dt><dd>{progress.completedKeywords.toLocaleString()} / {progress.totalKeywords.toLocaleString()} 词</dd></div>
        {active ? <><div><dt>等待返回</dt><dd>{progress.waitingQueries.toLocaleString()}</dd></div>{progress.plannedQueries ? <div><dt>待提交</dt><dd>{progress.plannedQueries.toLocaleString()}</dd></div> : null}{progress.processingQueries ? <div><dt>正在整理</dt><dd>{progress.processingQueries.toLocaleString()}</dd></div> : null}</> : null}
        {progress.failedQueries ? <div><dt>异常查询</dt><dd>{progress.failedQueries.toLocaleString()}</dd></div> : null}</dl>
      <div className="collectionProgressTrack" role="progressbar" aria-label="四国查询完成进度" aria-valuemin={0} aria-valuemax={progress.totalQueries} aria-valuenow={progress.completedQueries}><i style={{width:`${percent}%`}} /></div>
      {failed ? <p>进度暂未刷新</p> : null}
    </section> : null}
    <button type="button" className="collectionFloatButton" aria-expanded={open} aria-controls="collection-progress-details" onClick={() => setOpen(value => !value)}>
      {complete ? <CheckCircle2 size={16} /> : <Activity size={16} />}<span>{label}</span><strong>{Math.floor(percent)}%</strong><ChevronUp size={13} style={{transform:open ? "rotate(180deg)" : undefined}} />
    </button>
  </div>;
}
