"use client";

import { useEffect, useRef, useState } from "react";
import type { DateRange } from "@/lib/seo-date-range";
type Version = {
  id: string; periodStart: string; periodEnd: string; createdAt: string;
  payload?: { summary: string; comparisonRange?: DateRange | null };
};

export function ReportVersions({ range, comparison }: { range: DateRange; comparison: DateRange | null }) {
  const [versions, setVersions] = useState<Version[]>([]), [selected, setSelected] = useState<Version | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  async function history() {
    const response = await fetch("/api/reports/versions");
    const data = await response.json();
    if (!response.ok) throw Error(data.message);
    setVersions(data);
  }
  useEffect(() => { history().catch(error => setError(error.message)); }, []);
  async function save(snapshotRange = range, snapshotComparison = comparison) {
    setBusy(true); setError("");
    const key = JSON.stringify({ range: snapshotRange, comparison: snapshotComparison });
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try {
      const response = await fetch("/api/reports/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...snapshotRange, comparison: snapshotComparison, id: request.current.id }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.message);
      setSelected(data);
      await history();
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }
  async function open(id: string) {
    setError("");
    try {
      const response = await fetch("/api/reports/versions?id=" + encodeURIComponent(id));
      const data = await response.json();
      if (!response.ok || !data) throw Error(data?.message ?? "记录不存在");
      setSelected(data);
    } catch (error) { setError(error instanceof Error ? error.message : "读取失败"); }
  }
  function download() {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `flatkey-report-${selected.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="dailyPanel">
    <div className="seoIntro"><div><h2>区间报告归档</h2><p>保存日数据、页面组和对比区间证据，后续补采保留原版本。</p></div>
      <button className="ui-button-primary" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存当前区间快照"}</button></div>
    {error ? <p role="alert">{error}</p> : null}
    {selected ? <div className="seoNotice">
      <strong>{selected.periodStart.slice(0, 10)} — {selected.periodEnd.slice(0, 10)}</strong><p>{selected.payload?.summary}</p>
      {selected.payload?.comparisonRange ? <p>对比区间：{selected.payload.comparisonRange.start} — {selected.payload.comparisonRange.end}</p> : null}
      <span>生成时间 {new Date(selected.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} 北京时间</span>
      <button className="ui-button" onClick={download}>下载已保存版本</button>
      <button className="ui-button" disabled={busy} onClick={() => {
        request.current = null;
        void save({ start: selected.periodStart.slice(0, 10), end: selected.periodEnd.slice(0, 10) }, selected.payload?.comparisonRange ?? null);
      }}>另存修订版</button>
    </div> : null}
    <ul>{versions.map(version => <li key={version.id}><button className="ui-button" onClick={() => open(version.id)}>{version.periodStart.slice(0, 10)} — {version.periodEnd.slice(0, 10)} · {new Date(version.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</button></li>)}</ul>
  </section>;
}
