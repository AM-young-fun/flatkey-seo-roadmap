"use client";
import { useEffect, useRef, useState } from "react";
import { collectionIsActive, type SerpCollectionProgress } from "@/lib/serp-collection-progress";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";

export function CollectionProgress({site = "all",showRanked = false}: {site?: string;showRanked?:boolean}) {
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
  const rankedKeywords = progress.rankedKeywords ?? [];
  return <>
    {showRanked ? <section className="currentRankedKeywords" aria-label="本期有排名的关键词"><div className="currentRankedHeading"><h3>本期已取得前100排名 <strong>{(progress.rankedKeywordCount ?? 0).toLocaleString()}</strong> 词</h3><span>{progress.periodLabel} · 四国去重{progress.rankedKeywordCount > 10 ? " · 展示前10条" : ""}</span></div>
      {rankedKeywords.length ? <div className="currentRankedTable"><table><thead><tr><th>关键词</th><th>最佳排名</th><th>国家</th><th>排名页面</th></tr></thead><tbody>{rankedKeywords.map(row=><tr key={row.keyword}><td><a href={`/keywords?q=${encodeURIComponent(row.keyword)}`}>{row.keyword}</a></td><td><strong>#{row.rank}</strong></td><td>{REGIONS[row.region as SearchRegionCode]?.label ?? row.region}</td><td><a href={row.url} target="_blank" rel="noreferrer">{row.url.replace(/^https?:\/\//,"")}</a></td></tr>)}</tbody></table></div> : <p>{active ? "本期已返回的结果中暂未检出本站前100排名，其他查询仍在进行。" : "本期未检出本站前100排名。"}</p>}
    </section> : null}
    <div className="collectionProgress" role="status" aria-label="本轮排名采集进度">
    <div className="collectionProgressHeading"><strong>Flatkey · {progress.periodLabel} · {active ? "采集中" : complete ? "已完成" : "采集需处理"}</strong><span>{progress.completedQueries.toLocaleString()} / {progress.totalQueries.toLocaleString()} 次查询已完成</span></div>
    <div className="collectionProgressTrack" role="progressbar" aria-label="四国查询完成进度" aria-valuemin={0} aria-valuemax={progress.totalQueries} aria-valuenow={progress.completedQueries}><i style={{width:`${progress.totalQueries ? progress.completedQueries/progress.totalQueries*100 : 0}%`}} /></div>
    <p>已完成四国查询：{progress.completedKeywords.toLocaleString()} / {progress.totalKeywords.toLocaleString()} 词{active ? ` · 待提交 ${progress.plannedQueries.toLocaleString()} · 等待返回 ${progress.waitingQueries.toLocaleString()}${progress.processingQueries ? ` · 正在整理 ${progress.processingQueries}` : ""}` : ""}{progress.failedQueries ? ` · 异常 ${progress.failedQueries}` : ""}{failed ? " · 进度更新暂时中断" : ""}</p>
  </div></>;
}
