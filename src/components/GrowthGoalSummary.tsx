"use client";
import { useCallback, useEffect, useState } from "react";
import type { GrowthReportSnapshot, GrowthStrategy } from "@/lib/growth-strategy";
import type { GrowthTarget } from "@/lib/growth-types";
import styles from "./GrowthGoalSummary.module.css";
import { FeedbackButton } from "./FeedbackButton";
import { GrowthProgressViews } from "./GrowthProgressViews";
import { growthObservationComparisonText } from "@/lib/growth-observation-display";

export function GrowthReportSummary({ snapshot }: { snapshot: GrowthReportSnapshot }) {
  const g = snapshot.goals;
  return <section className={styles.panel} aria-label="季度目标与方向复盘">
    <header><h3>2026 收官季</h3><span>截至 {g.deadline} · 距截止 {g.daysRemaining} 天</span></header>
    <div className={styles.metrics}>
      <div><span>四站完整周自然会话 / 3000</span><strong>{g.weeklySessions === null ? "数据待齐" : g.weeklySessions.toLocaleString()}</strong><small>{g.trafficComplete ? `还差 ${g.trafficGap} 次` : g.knownSessions === null ? "尚无核实的同窗口来源" : `同窗口已核实部分 ${g.knownSessions.toLocaleString()} 次`}</small></div>
      <div><span>季度前 100 覆盖 / 60%</span><strong>{g.baselineCount === null ? "基线待核定" : `${((g.coverage ?? 0) * 100).toFixed(1)}%`}</strong><small>{g.baselineCount === null ? "不使用词库总数代替冻结目标" : `${g.rankedCount} / ${g.baselineCount} 目标，还差 ${g.coverageGap} 词`}</small></div>
      <div><span>已有排名中前 50 / 80%</span><strong>{g.quality === null ? "待有效排名" : `${(g.quality * 100).toFixed(1)}%`}</strong><small>{g.quality === null ? "暂无可计算的本轮实测" : `${g.top50Count} / ${g.rankedCount} 词，还差 ${g.qualityGap} 词`}</small></div>
    </div>
    <GrowthProgressViews cohorts={g.cohorts} />
    <p className={styles.note}>{g.evaluationMode === "final" ? "季末固定流量窗口" : "流量窗口"} {g.trafficPeriod?.start ?? snapshot.period.start} — {g.trafficPeriod?.end ?? snapshot.period.end}（洛杉矶）。{g.latestRankAt ? `最新有效排名采样 ${g.latestRankAt}。` : "尚无本轮有效排名采样。"}{g.rankingComplete ? "" : "排名尚未完成全量可比核验，暂不判定达标。"}</p>
    {g.evaluationMode === "final" ? <p className={styles.note}>季末验收：{g.finalAcceptance.status === "achieved" ? "已达标" : g.finalAcceptance.status === "not_achieved" ? "未达标" : "截止前证据待补"}。{g.finalAcceptance.reason}最近滚动周 {g.rolling.period.start} — {g.rolling.period.end} 会话 {g.rolling.weeklySessions === null ? "数据未齐" : g.rolling.weeklySessions.toLocaleString()}，另作日常观察。</p> : null}
    {!g.trafficComplete ? <details><summary>查看四站来源</summary><ul>{g.traffic.map(row => <li key={row.site}>{row.site}：{row.complete && row.sessions !== null ? `${row.sessions.toLocaleString()} 次` : row.reason}（{row.timezone}）</li>)}</ul></details> : null}
    {snapshot.directions.length ? <div className={styles.directions}><h4>方向上涨与下跌原因</h4>{snapshot.directions.slice(0, 3).map(direction => <article key={direction.id}>
      <h4>{direction.title}</h4><p>{direction.recommendation} · {direction.decision}</p>
      {direction.drivers.map((driver, index) => <p key={driver.url + index}><a href={driver.url} target="_blank" rel="noreferrer">{driver.title}</a> · {driver.country}/{driver.language} · {driver.source} {driver.metric}：{driver.previous} → {driver.current}（{driver.current - driver.previous > 0 ? "+" : ""}{driver.current - driver.previous}）<br />{driver.explanation} {driver.limitation}<br />下一步：{driver.nextAction}</p>)}
      <p className={styles.note}>原任务：{direction.taskIds.length ? direction.taskIds.map(id => <a key={id} href={`/work/${encodeURIComponent(id)}`}>{id} </a>) : "先完成研究/观察，不自动扩大制作范围"}</p>
    </article>)}</div> : <p className={styles.note}>本窗口尚无足够的可比方向归因证据；先核验页面、市场、来源和实际改动，再决定投入。</p>}
    {snapshot.observations.length ? <details><summary>原任务 7 / 14 / 28 天效果复查（{snapshot.observations.length}）</summary><ul>{snapshot.observations.map(row => <li key={row.id}><a href={row.pageUrl} target="_blank" rel="noreferrer">{row.taskId}</a> · {row.checkpoint}天 · 收录{row.coverage?.indexing === "verified" ? "已核验" : "待补"} / 排名{row.coverage?.ranking === "verified" ? "已核验" : "待补"} / 流量{row.coverage?.traffic === "verified" ? "已核验" : "待补"} · {growthObservationComparisonText(row.comparison, row.checkpoint)} {row.conclusion}；{row.nextAction}</li>)}</ul></details> : null}
  </section>;
}

type StrategyView = { state: GrowthStrategy; snapshot: GrowthReportSnapshot; sourceVersion: string; formalTargets: GrowthTarget[]; dueObservations: { taskId: string; checkpoint: number; dueDay: string }[] };
/** Uses authenticated strategy records; rendering this component never approves a direction or freezes the cohort. */
export function GrowthGoalSummary() {
  const [view, setView] = useState<StrategyView | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { const response = await fetch("/api/seo/growth/strategy", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "目标读取失败"); setView(data); setError(""); } catch (error) { setError(error instanceof Error ? error.message : "目标读取失败"); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reveal = () => {
      let id: string; try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (!id.startsWith("growth-direction-")) return;
      const target = document.getElementById(id), disclosure = target?.closest("details");
      if (disclosure) disclosure.open = true;
      target?.scrollIntoView({ block: "start" });
    };
    reveal(); window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [view]);
  const mutate = async (command: Record<string, unknown>) => {
    if (!view || busy) return; setBusy(true);
    try { const response = await fetch("/api/seo/growth/strategy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...command, requestId: `human-${crypto.randomUUID()}`, expectedVersion: view.state.version }) }); const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "保存失败"); await load(); }
    catch (error) { setError(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); }
  };
  if (!view) return <section className={styles.panel}><h3>2026 收官季</h3><p role={error ? "alert" : "status"}>{error || "正在读取真实目标和完整周来源…"}</p></section>;
  const formalTargets = view.formalTargets.filter(row => ["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(row.site));
  const recentDirections = [...view.state.directions].sort((a, b) => Number(Boolean(a.decision)) - Number(Boolean(b.decision)) || b.updatedAt.localeCompare(a.updatedAt));
  const canFreeze = formalTargets.length > 0 && formalTargets.every(row => row.topicId && row.country && row.language && row.languageStatus === "match");
  return <div><GrowthReportSummary snapshot={view.snapshot} />
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <section className={styles.panel}><details><summary>季度目标清单与人工方向决定</summary>
      <p>冻结目标 {view.state.baseline?.targets.length ?? "尚未核定"}；新批次 {view.state.batches.length}；到期效果复查 {view.dueObservations.length}。新增批次不会改变季度原始分母。</p>
      {!view.state.baseline ? <details><summary>审阅正式目标（{formalTargets.length}）</summary><div className={styles.scroll}><table><thead><tr><th>话题</th><th>目标关键词</th><th>站点 / 国家 / 语言</th><th>页面</th></tr></thead><tbody>{formalTargets.map(row => <tr key={row.id}><td>{row.topicName ?? "未归类"}</td><td>{row.keyword}</td><td>{row.site} · {row.country ?? "未知"} / {row.language ?? "未知"}</td><td>{row.pageState === "published" ? "已建页面" : row.pageState === "planned" ? "规划中" : "未关联"}</td></tr>)}</tbody></table></div><p>{canFreeze ? "核对后可冻结本季完整目标清单。" : "话题或国家语言仍有缺口，暂不能冻结；未建页和页面待核目标仍保留在分母。"}</p><FeedbackButton pending={busy} pendingLabel="正在保存…" disabled={!canFreeze} onClick={() => void mutate({ action: "freeze_baseline", targetIds: formalTargets.map(row => row.id), sourceVersion: view.sourceVersion, reason: "用户在总览审阅完整正式目标清单后冻结2026收官季基线" })}>确认并冻结完整季度清单</FeedbackButton></details> : null}
      {view.state.directions.length ? recentDirections.map(direction => <article className={styles.decision} id={`growth-direction-${direction.id}`} key={direction.id}><h4>{direction.title} · 方案 v{direction.revision}</h4><p>{direction.hypothesis}</p><p>需求：{direction.rationale}<br />竞争缺口：{direction.competitiveGap}<br />本站优势：{direction.ownAdvantage}<br />反证/限制：{direction.counterEvidence}<br />方案与投入：{direction.proposedAction} · {direction.investment}</p><p>实验：{direction.experiment.primaryMetric}；成功条件：{direction.experiment.successCondition}；业务护栏：{direction.experiment.businessGuardrail}</p><p>范围：{direction.scope.map(scope => `${scope.site}/${scope.topicId}/${scope.country}/${scope.language} ${scope.kinds.join("、")} 最多${scope.maxTasks}项，有效至${scope.validUntil}`).join("；")}</p><p>原始证据：{direction.evidence.map(item => `${item.source} ${item.reference}（${item.observedAt}）${item.supports}`).join("；")}</p><p>当前决定：{direction.decision?.decision ?? "待审核"}</p><div className={styles.actions}>{([ ["approve", "批准当前范围"], ["hold", "继续观察"], ["reject", "不采纳"] ] as const).map(([decision, label]) => <FeedbackButton key={decision} pending={busy} pendingLabel="正在保存…" disabled={Boolean(direction.decision)} onClick={() => void mutate({ action: "decide_direction", directionId: direction.id, revision: direction.revision, decision, reason: `用户在平台审阅方案v${direction.revision}后选择：${label}` })}>{label}</FeedbackButton>)}</div></article>) : <p>AI 尚未提交新的完整方向机会卡。</p>}
    </details></section>
  </div>;
}
