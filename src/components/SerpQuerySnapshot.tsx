"use client";
import { useState } from "react";
import { clientReadCache } from "@/lib/client-read-cache";
import type { loadSerpQueryEvidence } from "@/lib/services/serp-query-evidence";
type Evidence = Awaited<ReturnType<typeof loadSerpQueryEvidence>>;
/** Loaded only when a user opens one keyword/country's saved receipt. */
export function SerpQuerySnapshot({ keyword, region }: { keyword: string; region: string }) {
  const [evidence, setEvidence] = useState<Evidence | undefined>(), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const read = async () => {
    if (busy || evidence !== undefined) return;
    setBusy(true); setFailed(false);
    try { const data = await clientReadCache.read<{evidence: Evidence}>(`/api/serp-monitor?${new URLSearchParams({queryEvidence: keyword, region})}`); setEvidence(data.evidence); }
    catch { setFailed(true); } finally { setBusy(false); }
  };
  return <details className="historicalEvidence" onToggle={event => { if (event.currentTarget.open) void read(); }}><summary>采集快照</summary>
    {busy ? <p>读取保存的结果…</p> : failed ? <p>快照暂时无法读取，请稍后重新展开。</p> : evidence?.snapshot ? <>
      <p>{evidence.region} · {evidence.request.languageCode} · {evidence.request.device} · 自然结果排名（不含广告与AI摘要）</p>
      <table className="dailyEvidenceTable"><thead><tr><th style={{width: 90, whiteSpace: "nowrap"}}>自然名次</th><th>页面</th></tr></thead><tbody>{evidence.snapshot.organicResults.slice(0, 10).map((item,index) => <tr key={index}><td>#{item.rankGroup}</td><td>{item.url ? <a href={item.url} title={item.url} target="_blank" rel="noreferrer">{item.title ?? item.url}</a> : item.title}</td></tr>)}</tbody></table>
      <p className="chartNote">保存于本期采集，不会随现在重新搜索而改变。</p>{evidence.snapshot.checkUrl ? <a href={evidence.snapshot.checkUrl} target="_blank" rel="noreferrer">供应商查询链接 ↗</a> : null}
    </> : evidence !== undefined ? <p>该词本期尚无保存的采集快照。</p> : null}
  </details>;
}
