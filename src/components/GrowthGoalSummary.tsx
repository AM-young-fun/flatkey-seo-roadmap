"use client";
import { useCallback, useEffect, useState } from "react";
import type { GrowthReportSnapshot, GrowthStrategy } from "@/lib/growth-strategy";
import styles from "./GrowthGoalSummary.module.css";
import { FeedbackButton } from "./FeedbackButton";
import { SeoAnchor } from "@/components/SeoAnchor";
import { growthContributionMetricNames } from "@/lib/growth-topic-contributions";


export function GrowthReportDirections({ directions, title }: { directions: GrowthReportSnapshot["directions"]; title?: string }) {
  if (!directions.length) return <p className={styles.note}>本窗口尚无足够的可比方向归因证据；先核验页面、市场、来源和实际改动，再决定投入。</p>;
  return <div className={styles.directions}>{title ? <h4>{title}</h4> : null}{directions.slice(0, 3).map(direction => <article key={direction.id}>
      <h5>{direction.title}</h5>
      {!direction.drivers.length ? <p className={styles.note}>{direction.recommendation} · {direction.decision}</p> : <ul className={styles.driverList}>
        {direction.drivers.map((driver, index) => {
          const delta = driver.current - driver.previous;
          const natural = driver.explanation.startsWith("自然变化");
          return <li key={driver.url + index}>
            <div><SeoAnchor href={driver.url} target="_blank" rel="noreferrer">{driver.title}</SeoAnchor><small>{driver.country === "ALL" ? "全部市场" : driver.country} · {driver.language} · {growthContributionMetricNames[driver.metric]}</small></div>
            <strong data-change={delta > 0 ? "up" : delta < 0 ? "down" : undefined}>{driver.previous.toLocaleString()} → {driver.current.toLocaleString()}（{delta > 0 ? "+" : ""}{delta.toLocaleString()}）</strong>
            <p>{natural ? "自然变化" : driver.explanation}{!natural && driver.nextAction ? ` · ${driver.nextAction}` : ""}</p>
          </li>;
        })}
      </ul>}
      {direction.taskIds.length ? <div className={styles.taskLinks}>{direction.taskIds.map((id, index) => <SeoAnchor key={id} href={`/work/${encodeURIComponent(id)}`}>{direction.taskIds.length === 1 ? "查看关联任务" : `关联任务 ${index + 1}`}</SeoAnchor>)}</div> : null}
    </article>)}</div>;
}

type DirectionView = { state: Pick<GrowthStrategy, "version" | "directions"> };

export function GrowthDirectionReview() {
  const [view, setView] = useState<DirectionView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [directionId, setDirectionId] = useState("");
  const [admissionMessage, setAdmissionMessage] = useState("");
  const load = useCallback(async () => {
    setReading(true);
    try {
      const response = await fetch("/api/seo/growth/strategy?view=quarter-review", { cache: "no-store", signal: AbortSignal.timeout(60_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "方向记录读取失败");
      setView(data);
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "方向记录读取失败");
    } finally {
      setReading(false);
    }
  }, []);
  useEffect(() => {
    const readHash = () => {
      const prefix = "#growth-direction-";
      const hash = window.location.hash;
      let id = "";
      try {
        if (hash.startsWith(prefix)) id = decodeURIComponent(hash.slice(prefix.length));
      } catch {
        // Ignore malformed links.
      }
      setDirectionId(id);
      setAdmissionMessage("");
      if (id) void load();
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [load]);
  const direction = view?.state.directions.find(item => item.id === directionId);
  useEffect(() => {
    if (direction) document.getElementById(`growth-direction-${direction.id}`)?.scrollIntoView({ block: "start" });
  }, [direction]);
  const mutate = async (command: Record<string, unknown>) => {
    if (!view || busy) return;
    setBusy(true);
    setAdmissionMessage("");
    const confirmsKeyword = command.confirmOriginalKeyword === true;
    const endpoint = confirmsKeyword ? "/api/seo/growth/hotspots/admit" : "/api/seo/growth/strategy";
    const body = confirmsKeyword || command.action === "retry_weekly_growth"
      ? command
      : { ...command, requestId: `human-${crypto.randomUUID()}`, expectedVersion: view.state.version };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "保存失败");
      if (confirmsKeyword) {
        const result = data.items?.[0];
        setAdmissionMessage(result?.status === "scheduled" || result?.status === "reused" ? "已读回原词正式归属和原计划。"
          : result?.reason ?? "原词和计划需要重新核验。");
      }
      if (data.weeklyGrowthAdmission) {
        const admission = data.weeklyGrowthAdmission;
        setAdmissionMessage(admission.status === "registered" ? "已读回原计划上的上涨加推任务。"
          : admission.reason ?? admission.results?.map((item: { taskId: string; reason?: string }) => item.reason ? `${item.taskId} · ${item.reason}` : "").filter(Boolean).join("。") ?? "原排期仍待核对。");
      }
      await load();
      dispatchEvent(new Event("seo-growth-updated"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      if (confirmsKeyword) setAdmissionMessage(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };

  if (!directionId) return null;
  return <section className={styles.panel} aria-label="方向记录">
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {error && !view ? <FeedbackButton pending={reading} pendingLabel="正在加载方向记录…" onClick={() => void load()}>
      重新加载方向记录
    </FeedbackButton> : null}
    {!error && !view ? <p role="status">正在加载方向记录…</p> : null}
    {view && !reading && !direction && !error ? <p>未找到对应方向记录。</p> : null}
    {admissionMessage ? <p role="status">{admissionMessage}</p> : null}
    {direction ? <article className={styles.decision} id={`growth-direction-${direction.id}`} key={direction.id}>
      <h4>{direction.title} · 方案 v{direction.revision}</h4>
      <p>{direction.hypothesis}</p>
      <p>需求：{direction.rationale}<br />
        竞争缺口：{direction.competitiveGap}<br />
        本站优势：{direction.ownAdvantage}<br />
        反证/限制：{direction.counterEvidence}<br />
        方案与投入：{direction.proposedAction} · {direction.investment}</p>
      <p>实验：{direction.experiment.primaryMetric}；成功条件：{direction.experiment.successCondition}；业务护栏：{direction.experiment.businessGuardrail}</p>
      <p>范围：{direction.scope.map(scope => `${scope.site}/${scope.topicId}/${scope.country}/${scope.language} ${scope.kinds.join("、")} 最多${scope.maxTasks}项，有效至${scope.validUntil}`).join("；")}</p>
      <p>原始证据：{direction.evidence.map(item => `${item.source} ${item.reference}（${item.observedAt}）${item.supports}`).join("；")}</p>
      <p>当前决定：{direction.decision?.decision ?? "待审核"}</p>
      {direction.weeklyGrowth ? <p>周报上涨加推 · {direction.weeklyGrowth.reportId}</p> : null}
      <div className={styles.actions}>
        {([["approve", "批准当前范围"], ["hold", "继续观察"], ["reject", "不采纳"]] as const).map(([decision, label]) => (
          <FeedbackButton key={decision} pending={busy} pendingLabel="正在保存…" disabled={Boolean(direction.decision)} onClick={() => void mutate({
            action: "decide_direction", directionId: direction.id, revision: direction.revision, decision,
            reason: `用户在平台审阅方案v${direction.revision}后选择：${label}`,
          })}>{label}</FeedbackButton>
        ))}
        {!direction.weeklyGrowth && direction.decision?.decision === "approve" && direction.taskIds.length === 1 && direction.taskIds[0].startsWith("seo-hotspot:") && Date.parse(direction.expiresAt) > Date.now() ? (
          <FeedbackButton pending={busy} pendingLabel="正在保存并读回…" onClick={() => void mutate({
            directionId: direction.id, revision: direction.revision, taskIds: direction.taskIds, confirmOriginalKeyword: true,
          })}>确认该篇原词并追加原计划</FeedbackButton>
        ) : null}
        {direction.weeklyGrowth && direction.decision?.decision === "approve" ? (
          <FeedbackButton pending={busy} pendingLabel="正在核对…" onClick={() => void mutate({
            action: "retry_weekly_growth", directionId: direction.id, revision: direction.revision,
          })}>核对加推排期</FeedbackButton>
        ) : null}
      </div>
    </article> : null}
  </section>;
}
