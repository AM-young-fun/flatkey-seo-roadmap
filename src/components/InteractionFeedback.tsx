"use client";

import { useEffect, useSyncExternalStore } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { interactionFeedback } from "@/lib/interaction-feedback";
import styles from "./InteractionFeedback.module.css";
import { PageLoading } from "./PageLoading";

export function InteractionFeedback() {
  const { activities, notice } = useSyncExternalStore(interactionFeedback.subscribe, interactionFeedback.snapshot, interactionFeedback.serverSnapshot);
  const current = activities.find(activity => activity.kind === "navigation")
    ?? activities.find(activity => activity.kind === "read");
  useEffect(() => {
    if (!notice || notice.tone !== "success") return;
    const timer = setTimeout(() => interactionFeedback.dismiss(notice.id), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  return <>
    {current ? <PageLoading label={current.label} shared /> : null}
    <div className={styles.region} aria-label="操作反馈">
      {notice ? <div className={styles.notice} data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
        {notice.tone === "success" ? <CheckCircle2 size={17} aria-hidden="true" /> : <CircleAlert size={17} aria-hidden="true" />}
        <span>{notice.message}</span><button type="button" aria-label="关闭操作提示" onClick={() => interactionFeedback.dismiss(notice.id)}><X size={15} aria-hidden="true" /></button>
      </div> : null}
    </div>
  </>;
}
