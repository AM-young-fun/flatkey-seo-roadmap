"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { GrowthReportSnapshot, GrowthStrategy, GrowthBaselineIdentityReview } from "@/lib/growth-strategy";
import { GROWTH_COUNTRIES, GROWTH_COUNTRY_LABELS, GROWTH_MARKET_LANGUAGES, type GrowthCountry } from "@/lib/seo-growth-markets";
import type { GrowthTarget } from "@/lib/growth-types";
import styles from "./GrowthGoalSummary.module.css";
import { FeedbackButton } from "./FeedbackButton";
import { GrowthProgressViews } from "./GrowthProgressViews";
import { SeoAnchor } from "@/components/SeoAnchor";
import { PreFreezeIdentityReview } from "./PreFreezeIdentityReview";
import { QuarterMembershipReview } from "./QuarterMembershipReview";
import { growthContributionMetricNames } from "@/lib/growth-topic-contributions";
import { reportDay } from "@/lib/seo-report-time.cjs";


export function GrowthReportSummary({ snapshot, current = false, showDirections = !current, children }: { snapshot: GrowthReportSnapshot; current?: boolean; showDirections?: boolean; children?: ReactNode }) {
  const g = snapshot.goals;
  const observationDates = [g.weeklySessions !== null && g.trafficScope ? `流量截至 ${g.trafficPeriod.end}` : null,
    g.latestRankAt ? `排名截至 ${reportDay(new Date(g.latestRankAt))}` : null].filter(Boolean);
  const currentLabel = observationDates.length ? `当前季度 · ${observationDates.join(" · ")}（洛杉矶）` : "当前季度 · 来源待齐";
  return <section className={`${styles.panel} ${styles.reportPanel}`} aria-label={current ? "当前季度进度" : showDirections ? "季度目标与方向复盘" : "季度目标"}>
    <header><h3>2026 收官季</h3><span>{current ? currentLabel : `截至 ${g.deadline} · 距截止 ${g.daysRemaining} 天`}</span></header>
    <div className={styles.metrics}>
      <div><span>{g.trafficWindowKind === "rolling7day-v1" ? "Flatkey 最新完整滚动7日自然会话" : g.trafficScope?.label ?? "四站完整周自然会话（历史口径）"} / 3000</span><strong>{g.weeklySessions === null ? "数据待齐" : g.weeklySessions.toLocaleString()}</strong><small>{g.trafficComplete ? `还差 ${g.trafficGap} 次` : g.knownSessions === null ? "尚无核实的同窗口来源" : `同窗口已核实部分 ${g.knownSessions.toLocaleString()} 次`}</small></div>
      <div><span>季度前 100 覆盖 / 60%</span><strong>{g.baselineCount === null ? "基线待核定" : g.coverage === null ? "排名待齐" : `${(g.coverage * 100).toFixed(1)}%`}</strong><small>{g.baselineCount === null ? "不使用词库总数代替冻结目标" : g.rankedCount === null ? `冻结目标 ${g.baselineCount} 词` : `${g.rankedCount} / ${g.baselineCount} 目标，还差 ${g.coverageGap} 词`}</small></div>
      <div><span>已有排名中前 50 / 80%</span><strong>{g.quality === null ? "待有效排名" : `${(g.quality * 100).toFixed(1)}%`}</strong><small>{g.quality === null ? "暂无可计算的本轮实测" : `${g.top50Count} / ${g.rankedCount} 词，还差 ${g.qualityGap} 词`}</small></div>
    </div>
    <GrowthProgressViews cohorts={g.cohorts} />
    {g.evaluationMode === "final" ? <p className={styles.note}>季末验收：{g.finalAcceptance.status === "achieved" ? "已达标" : g.finalAcceptance.status === "not_achieved" ? "未达标" : "截止前证据待补"}。{g.finalAcceptance.reason}最近滚动周 {g.rolling.period.start} — {g.rolling.period.end} 会话 {g.rolling.weeklySessions === null ? "数据未齐" : g.rolling.weeklySessions.toLocaleString()}，另作日常观察。</p> : null}
    {!g.trafficComplete ? <details><summary>{g.trafficScope ? "查看 Flatkey 来源" : "查看四站来源（历史口径）"}</summary><ul>{g.traffic.map(row => <li key={row.site}>{row.site}：{row.complete && row.sessions !== null ? `${row.sessions.toLocaleString()} 次` : row.reason}（{row.timezone}）</li>)}</ul></details> : null}
    {showDirections ? <GrowthReportDirections directions={snapshot.directions} /> : null}
    {children}
  </section>;
}

export function GrowthReportDirections({ directions, title = "流量归因与方向决定" }: { directions: GrowthReportSnapshot["directions"]; title?: string }) {
  if (!directions.length) return <p className={styles.note}>本窗口尚无足够的可比方向归因证据；先核验页面、市场、来源和实际改动，再决定投入。</p>;
  return <div className={styles.directions}><h4>{title}</h4>{directions.slice(0, 3).map(direction => <article key={direction.id}>
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

type StrategyView = { state: GrowthStrategy; snapshot: GrowthReportSnapshot; sourceVersion: string; formalTargets: GrowthTarget[]; identityReview?: GrowthBaselineIdentityReview[]; dueObservations: { taskId: string; checkpoint: number; dueDay: string }[]; historicalDueObservations?: { publicationId: string; pageUrl: string; checkpoint: number; dueDay: string | null; writeMode: string }[] };
/** Uses authenticated strategy records; rendering this component never approves a direction or freezes the cohort. */
export function GrowthQuarterReview() {
  const [view, setView] = useState<StrategyView | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [identityChoices, setIdentityChoices] = useState<Record<string, GrowthCountry | "">>({});
  const load = useCallback(async () => { setReading(true); try { const response = await fetch("/api/seo/growth/strategy", { cache: "no-store", signal: AbortSignal.timeout(60_000) }); const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "目标读取失败"); setView(data); setError(""); } catch (error) { setError(error instanceof Error ? error.message : "目标读取失败"); } finally { setReading(false); } }, []);
  useEffect(() => {
    const openFromHash = () => { if (window.location.hash.startsWith("#growth-direction-")) void load(); };
    openFromHash(); window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [load]);
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
    try { const response = await fetch("/api/seo/growth/strategy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...command, requestId: `human-${crypto.randomUUID()}`, expectedVersion: view.state.version }) }); const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "保存失败"); await load(); dispatchEvent(new Event("seo-growth-updated")); }
    catch (error) { setError(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); }
  };
  if (!view) return <section className={styles.panel}>
    <FeedbackButton pending={reading} pendingLabel="正在加载审核数据…" onClick={() => void load()}>查看季度审核与方向决定</FeedbackButton>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
  const quarterIds = view.state.baseline ? new Set(view.state.baseline.targets.map(row => row.id)) : null;
  const formalTargets = view.formalTargets.filter(row => ["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(row.site) && (!quarterIds || quarterIds.has(row.id)));
  const recentDirections = [...view.state.directions].sort((a, b) => Number(Boolean(a.decision)) - Number(Boolean(b.decision)) || b.updatedAt.localeCompare(a.updatedAt));
  const quarter = view.state.quarterPlanning;
  const selected = quarter ? formalTargets.filter(row => quarter.plan.targetIds.includes(row.id)) : [];
  const canFreeze = Boolean(quarter?.plan.version === "quarter-planning-v2" && quarter.plan.sourceVersion === view.sourceVersion && selected.length === 1600 && selected.every(row => row.topicId && row.country && row.language && row.languageStatus === "match"));
  const pendingIdentities = (view.identityReview ?? []).filter(row => !row.confirmed);
  const selectedMappings = pendingIdentities.flatMap(row => { const country = identityChoices[row.targetId]; return row.canSupplement && country && GROWTH_MARKET_LANGUAGES[country] === row.wordLanguage ? [{ targetId: row.targetId, country, language: GROWTH_MARKET_LANGUAGES[country] }] : []; });
  return <div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <section className={styles.panel}><details><summary>季度1600关键词与方向决定</summary>
      {!view.state.baseline ? <><QuarterMembershipReview onChanged={load} /><PreFreezeIdentityReview onChanged={load} /></> : null}
      <p>冻结目标 {view.state.baseline?.targets.length ?? "尚未核定"}；新批次 {view.state.batches.length}；原任务待补效果 {view.dueObservations.length}；历史来源待核 {view.historicalDueObservations?.length ?? 0}。新增批次不会改变季度原始分母。</p>
      {!view.state.baseline ? <details><summary>审阅候选底账（{formalTargets.length}，不是季度规划完成量）</summary><div className={styles.scroll}><table><thead><tr><th>话题</th><th>目标关键词</th><th>站点 / 国家 / 语言</th><th>页面</th></tr></thead><tbody>{formalTargets.map(row => <tr key={row.id}><td>{row.topicName ?? "未归类"}</td><td>{row.keyword}</td><td>{row.site} · {row.country ?? "未知"} / {row.language ?? "未知"}</td><td>{row.pageState === "published" ? "已建页面" : row.pageState === "planned" ? "规划中" : "未关联"}</td></tr>)}</tbody></table></div><p>候选底账仅说明现有来源。完整季度方案须明确主攻话题、本地研究预算、实际投入和缺口；待核身份仍留N、不计R。</p>{!quarter ? <p>尚未保存完整季度方案，不能直接把候选底账冻结为季度目标。</p> : null}</details> : null}
      {quarter ? <article className={styles.decision}><h4>{quarter.plan.title} · 季度方案 v{quarter.revision}</h4><p>执行测算窗口：{quarter.plan.executionStart} — {quarter.plan.executionEnd}；冻结候选 {quarter.plan.targetIds.length} 项。原任务保留 {quarter.plan.reservedOriginalTaskIds.length} 项，未来可用工作包 {quarter.plan.deliveryBudget.total}。</p><p>本地关键词研究名额（不是已验证新词或付费授权）：美国英语 {quarter.plan.researchBudget.counts.US} / 日本日语 {quarter.plan.researchBudget.counts.JP} / 巴西葡语 {quarter.plan.researchBudget.counts.BR} / 海外简中 {quarter.plan.researchBudget.counts.SG} / 其他 {quarter.plan.researchBudget.counts.other}。</p><p>未来常规投入：{Object.entries(quarter.plan.deliveryBudget.counts).map(([key, value]) => `${({ gpu: "GPU租赁", api: "API调用", other: "其他", primary: "历史主攻", foundation: "历史基础", experiment: "历史试验" } as Record<string, string>)[key] ?? key} ${value}`).join(" / ")}。</p>{quarter.plan.workstreams.map(stream => <div key={stream.id}><strong>{stream.title} · {stream.bucket}</strong><p>{stream.rationale}</p><p>验证：{stream.verification}</p></div>)}<ul>{quarter.plan.limitations.map(line => <li key={line}>{line}</li>)}</ul><details><summary>查看与哈希绑定的完整方案、原话题／任务及来源</summary><p>完整成员在上方候选表逐项展示；下面包含原目标ID、全部话题／任务引用、原任务预留、预算、源版本、审核包路径和字节哈希。批准仅针对该确切方案，不授权新付费或自动发送。</p><pre className={styles.json}>{JSON.stringify(quarter.plan, null, 2)}</pre></details><p>方案哈希：{quarter.hash}；当前状态：{quarter.approval ? "已由用户批准该确切方案" : "待审核"}。</p><FeedbackButton disabled={!canFreeze || Boolean(quarter.approval)} pending={busy} pendingLabel="正在保存…" onClick={() => void mutate({ action: "approve_quarter_plan", hash: quarter.hash, sourceVersion: view.sourceVersion, reason: "用户完整审阅该季度方案的方向、比例、工作包及限制后批准；保留原成员N，付费及发布仍守原审核" })}>{view.state.baseline ? "批准此版投入方案，保留原季度N" : "批准完整季度方案并锁定成员N"}</FeedbackButton></article> : null}
      {view.state.baseline && pendingIdentities.length ? <details><summary>补充原目标身份（待核 {pendingIdentities.length}）</summary><p>只补原目标的国家与匹配语种，不增减 N、不修改原词。中性词继续待核；诊断查询国家和页面语言不能作为原词语种批准。</p><div className={styles.scroll}><table><thead><tr><th>原目标</th><th>已有词语种证据</th><th>明确核定市场</th></tr></thead><tbody>{pendingIdentities.map(row => <tr key={row.targetId}><td>{row.keyword}<small>{row.site}</small></td><td>{row.wordLanguage ?? "语种待核"}</td><td>{row.canSupplement ? <select aria-label={`核定${row.keyword}的市场`} value={identityChoices[row.targetId] ?? ""} onChange={event => setIdentityChoices(choices => ({ ...choices, [row.targetId]: event.target.value as GrowthCountry | "" }))}><option value="">保持待核</option>{GROWTH_COUNTRIES.filter(country => GROWTH_MARKET_LANGUAGES[country] === row.wordLanguage && (!row.country || country === row.country)).map(country => <option key={country} value={country}>{GROWTH_COUNTRY_LABELS[country]} / {GROWTH_MARKET_LANGUAGES[country]}</option>)}</select> : "保留原身份，先补原词语种证据"}</td></tr>)}</tbody></table></div><FeedbackButton disabled={!selectedMappings.length} pending={busy} pendingLabel="正在保存…" onClick={() => void mutate({ action: "resolve_baseline_identities", sourceVersion: view.sourceVersion, mappings: selectedMappings, reason: "用户逐项审阅原稳定目标及明确词语种后核定所选市场；N与原成员保持不变" })}>确认所选 {selectedMappings.length} 项身份补充</FeedbackButton></details> : null}
      {view.historicalDueObservations?.length ? <details><summary>历史页面到期效果核查（{view.historicalDueObservations.length}）</summary><p>历史发布保留原记录；没有可写原任务时只记原每日回执，不新造任务或冒称排名已核验。</p><ul>{view.historicalDueObservations.map(row => <li key={`${row.publicationId}:${row.checkpoint}`}><SeoAnchor href={row.pageUrl} target="_blank" rel="noreferrer">{row.pageUrl}</SeoAnchor> · {row.checkpoint}日 · {row.dueDay ?? "来源日期待核"} · {row.writeMode === "original_daily_run_only" ? "原每日回执补证" : "原关联任务与每日回执补证"}</li>)}</ul></details> : null}
      {view.state.directions.length ? recentDirections.map(direction => <article className={styles.decision} id={`growth-direction-${direction.id}`} key={direction.id}><h4>{direction.title} · 方案 v{direction.revision}</h4><p>{direction.hypothesis}</p><p>需求：{direction.rationale}<br />竞争缺口：{direction.competitiveGap}<br />本站优势：{direction.ownAdvantage}<br />反证/限制：{direction.counterEvidence}<br />方案与投入：{direction.proposedAction} · {direction.investment}</p><p>实验：{direction.experiment.primaryMetric}；成功条件：{direction.experiment.successCondition}；业务护栏：{direction.experiment.businessGuardrail}</p><p>范围：{direction.scope.map(scope => `${scope.site}/${scope.topicId}/${scope.country}/${scope.language} ${scope.kinds.join("、")} 最多${scope.maxTasks}项，有效至${scope.validUntil}`).join("；")}</p><p>原始证据：{direction.evidence.map(item => `${item.source} ${item.reference}（${item.observedAt}）${item.supports}`).join("；")}</p><p>当前决定：{direction.decision?.decision ?? "待审核"}</p><div className={styles.actions}>{([ ["approve", "批准当前范围"], ["hold", "继续观察"], ["reject", "不采纳"] ] as const).map(([decision, label]) => <FeedbackButton key={decision} pending={busy} pendingLabel="正在保存…" disabled={Boolean(direction.decision)} onClick={() => void mutate({ action: "decide_direction", directionId: direction.id, revision: direction.revision, decision, reason: `用户在平台审阅方案v${direction.revision}后选择：${label}` })}>{label}</FeedbackButton>)}</div></article>) : <p>AI 尚未提交新的完整方向机会卡。</p>}
    </details></section>
  </div>;
}
