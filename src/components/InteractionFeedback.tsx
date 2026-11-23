"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, X } from "lucide-react";
import { interactionFeedback } from "@/lib/interaction-feedback";
import styles from "./InteractionFeedback.module.css";

export function InteractionFeedback() {
  const { activities, notice } = useSyncExternalStore(interactionFeedback.subscribe, interactionFeedback.snapshot, interactionFeedback.serverSnapshot);
  const current = activities.find(activity => activity.kind === "action")
    ?? activities.find(activity => activity.kind === "navigation") ?? activities[0];
  const [slowId, setSlowId] = useState<number | null>(null);
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setSlowId(current.id), Math.max(0, 8000 - (Date.now() - current.startedAt)));
    return () => clearTimeout(timer);
  }, [current]);
  useEffect(() => {
    if (!notice || notice.tone !== "success") return;
    const timer = setTimeout(() => interactionFeedback.dismiss(notice.id), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  return <>
    {current ? <div className={styles.progress} role="progressbar" aria-label={current.label}><span /></div> : null}
    <div className={styles.region} aria-label="操作反馈">
      {notice ? <div className={styles.notice} data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
        {notice.tone === "success" ? <CheckCircle2 size={17} aria-hidden="true" /> : <CircleAlert size={17} aria-hidden="true" />}
        <span>{notice.message}</span><button type="button" aria-label="关闭操作提示" onClick={() => interactionFeedback.dismiss(notice.id)}><X size={15} aria-hidden="true" /></button>
      </div> : null}
      {current ? <div className={styles.pending} role="status" aria-label={current.label} aria-live="polite">
        <LoaderCircle size={16} className="feedback-spinner" aria-hidden="true" /><span>{current.label}{slowId === current.id ? <small>耗时较长，仍在等待响应。</small> : null}</span>
      </div> : null}
    </div>
  </>;
}
