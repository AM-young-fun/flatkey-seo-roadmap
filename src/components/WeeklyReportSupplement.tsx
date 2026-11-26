"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useBusyIndicator } from "./useBusyIndicator";
import { actionFailed, actionSucceeded } from "@/lib/interaction-feedback";
import type { WeeklySupplement, WeeklySupplementRead, WeeklySupplementSection } from "@/lib/seo-weekly-supplement";
import styles from "./SeoDigestReports.module.css";
import controls from "./SeoWorkWorkspace.module.css";

type Props = {
  reportId: string;
  initial?: WeeklySupplementRead;
  onReady?: (reportId: string) => void;
  section?: WeeklySupplementSection;
  originalText?: string;
  renderText?: (text: string) => ReactNode;
  fallback?: ReactNode;
};

export function WeeklyReportSupplement({ reportId, initial, onReady, section = "summary", originalText = "", renderText, fallback }: Props) {
  const attribution = section === "attribution";
  const title = attribution ? "流量上涨与下跌原因" : "本周总结";
  const fieldId = useId();
  const [saved, setSaved] = useState<WeeklySupplement | null>(initial?.supplement ?? null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editable, setEditable] = useState(initial?.editable ?? false);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  useBusyIndicator(saving, `正在保存${title}…`);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!initial || editing) return;
    setSaved(previous => !previous || initial.supplement.revision > previous.revision ? initial.supplement : previous);
    setEditable(initial.editable);
  }, [initial, editing]);
  useEffect(() => {
    if (initial && reload === 0) { onReady?.(reportId); return; }
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams({ reportId, ...(attribution ? { section } : {}) });
        const response = await fetch("/api/seo/weekly-supplement?" + query, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? `${title}读取失败`);
        if (controller.signal.aborted) return;
        setSaved(data.supplement); setText(data.supplement.revision ? data.supplement.text : originalText);
        setEditable(data.editable); setError(""); setConflict(false);
        onReady?.(reportId);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : `${title}读取失败`); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [reportId, reload, onReady, initial, attribution, section, title, originalText]);
  const currentText = saved?.revision ? saved.text : originalText;
  const changed = editing && saved !== null && currentText !== text;
  async function save() {
    if (!saved || !editable || !changed || conflict || inFlight.current || loading) return;
    inFlight.current = true;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/seo/weekly-supplement", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, expectedRevision: saved.revision, text, ...(attribution ? { section } : {}) }) });
      const data = await response.json();
      if (!response.ok) { setConflict(response.status === 409); throw new Error(data.message ?? "保存失败，请重试"); }
      if (data.supplement?.id !== saved.id || data.supplement?.revision !== saved.revision + 1 || data.supplement.text !== text) throw new Error("保存回执不完整，请重新读取核对。");
      setSaved(data.supplement); setConflict(false); setEditing(false);
      actionSucceeded(`${title}已保存。`);
    } catch (error) { const message = error instanceof Error ? error.message : "保存失败，请重试"; setError(message); actionFailed(message); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <section className={styles.section} aria-label={title}>
    <div className={styles.supplementHeading}>
      {attribution ? <h4>{title}</h4> : <h3>{title}</h3>}
      {saved && editable && !editing ? <button type="button" className={controls.secondary} aria-label={`编辑${title}`}
        disabled={loading} onClick={() => { setText(currentText); setEditing(true); }}>编辑</button> : null}
    </div>
    {editing ? <>
      <label className={styles.supplementLabel} htmlFor={fieldId}>{title}</label>
      <textarea id={fieldId} className={styles.supplementInput} value={text} onChange={event => setText(event.target.value)}
        maxLength={10000} autoFocus disabled={!editable || saving || loading} />
    </> : !saved?.revision && fallback ? fallback
      : currentText ? renderText?.(currentText) ?? <p className={styles.supplementText}>{currentText}</p>
        : attribution || !loading ? <p className={styles.note}>{attribution ? "本周暂无可核验的流量涨跌原因。" : "尚未填写本周总结。"}</p> : null}
    {editing || error || loading ? <div className={styles.supplementActions}>
      {editing ? <>
        <button className={controls.primary} type="button" aria-busy={saving || undefined} disabled={!editable || !changed || saving || loading || conflict}
          onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button>
        <button className={controls.secondary} type="button" disabled={saving || loading} onClick={() => { setEditing(false); }}>取消</button>
      </> : null}
      <span className={styles.note} role="status">{loading ? "正在读取…" : saving ? "正在保存…" : changed ? "有未保存的内容" : saved?.updatedAt ? "已保存" : ""}</span>
      {error ? <span role="alert">{error}</span> : null}
      {error ? <button type="button" className={controls.secondary} disabled={saving || loading} onClick={() => {
        if (!changed || window.confirm("重新读取会替换当前未保存内容，继续吗？")) { setLoading(true); setReload(value => value + 1); }
      }}>重新读取</button> : null}
    </div> : null}
  </section>;
}
