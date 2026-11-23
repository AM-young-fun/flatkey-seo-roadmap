"use client";

import { useEffect, useId, useState } from "react";
import type { WeeklySupplement } from "@/lib/seo-weekly-supplement";
import styles from "./SeoDigestReports.module.css";
import controls from "./SeoWorkWorkspace.module.css";

export function WeeklyReportSupplement({ reportId }: { reportId: string }) {
  const fieldId = useId();
  const [saved, setSaved] = useState<WeeklySupplement | null>(null);
  const [text, setText] = useState("");
  const [editable, setEditable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/seo/weekly-supplement?" + new URLSearchParams({ reportId }), { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "补充说明读取失败");
        if (controller.signal.aborted) return;
        setSaved(data.supplement); setText(data.supplement.text); setEditable(data.editable); setError(""); setConflict(false);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "补充说明读取失败"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [reportId, reload]);
  async function save() {
    if (!saved || saving || loading) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/seo/weekly-supplement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId, expectedRevision: saved.revision, text }) });
      const data = await response.json();
      if (!response.ok) { setConflict(response.status === 409); throw new Error(data.message ?? "保存失败，请重试"); }
      setSaved(data.supplement); setConflict(false);
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  const changed = saved !== null && saved.text !== text;
  return <section className={styles.section} aria-labelledby={fieldId + "-heading"}>
    <h3 id={fieldId + "-heading"}>补充说明</h3>
    <label className={styles.supplementLabel} htmlFor={fieldId}>填写本周补充内容</label>
    <textarea id={fieldId} className={styles.supplementInput} value={text} onChange={event => setText(event.target.value)} maxLength={10000}
      placeholder="输入你想补充的内容…" disabled={!saved || !editable || saving || loading} />
    <div className={styles.supplementActions}>
      <button className={controls.primary} type="button" disabled={!editable || !changed || saving || loading || conflict} onClick={() => void save()}>{saving ? "保存中…" : "保存补充"}</button>
      <span className={styles.note} role="status">{loading ? "正在读取…" : changed ? "有未保存的内容" : saved?.updatedAt ? "已保存" : ""}</span>
      {error ? <span role="alert">{error}</span> : null}
      {error ? <button type="button" className={controls.secondary} disabled={saving || loading} onClick={() => {
        if (!changed || window.confirm("重新读取会替换当前未保存内容，继续吗？")) { setLoading(true); setReload(value => value + 1); }
      }}>重新读取</button> : null}
    </div>
  </section>;
}
