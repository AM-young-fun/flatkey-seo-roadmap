"use client";

import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { FeedbackButton } from "./FeedbackButton";
import type { DailySendStatus } from "@/lib/services/seo-daily-manual-send";
import styles from "./SeoWorkWorkspace.module.css";
import reportStyles from "./SeoDigestReports.module.css";

const endpoint = "/api/seo/digest/daily-send";

export function DailyReportSendButton({ reportId, reportHash }: { reportId: string; reportHash: string }) {
  const [status, setStatus] = useState<DailySendStatus>();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const phase = status?.state;

  useEffect(() => {
    if (phase !== undefined && phase !== "pending") return;
    const controller = new AbortController();
    const query = new URLSearchParams({ reportId, reportHash });
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const response = await fetch(endpoint + "?" + query, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const result = await response.json() as DailySendStatus;
        if (controller.signal.aborted) return;
        setStatus(result);
        if (result.state === "pending") timer = setTimeout(read, 4000);
      } catch {
        if (controller.signal.aborted) return;
        if (phase === "pending") timer = setTimeout(read, 8000);
        else setStatus({ state: "unavailable", message: "暂时无法读取发送状态，请刷新页面" });
      }
    };
    if (phase === "pending") timer = setTimeout(read, 1500);
    else void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [phase, reportId, reportHash]);

  async function send() {
    setSending(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, reportHash }) });
      const result = await response.json();
      if (response.ok) setStatus(result as DailySendStatus);
      else {
        setError(result.message ?? "发送请求未完成");
        setStatus(undefined);
      }
    } catch {
      setStatus({ state: "pending", message: "正在核对发送请求" });
    } finally {
      setSending(false);
    }
  }

  const busy = sending || phase === "pending";
  return <div className={reportStyles.sendAction}>
    <FeedbackButton type="button" className={styles.secondary} disabled={phase !== "ready"} pending={busy}
      pendingLabel="正在发送…" onClick={send}>
      <Send size={14} aria-hidden="true" />{phase === "sent" ? "已发送到钉钉群" : "发送到钉钉群"}
    </FeedbackButton>
    {error || status?.message && phase !== "pending" ? <small role={error ? "alert" : "status"}>{error || status?.message}</small> : null}
  </div>;
}
