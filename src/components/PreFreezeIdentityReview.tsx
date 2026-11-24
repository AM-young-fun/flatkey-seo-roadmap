"use client";
import { useEffect, useRef, useState } from "react";
import type { PreFreezeReview } from "@/lib/pre-freeze-market-identities";
import type { QuarterPlanningInput } from "@/lib/growth-quarter-planning";
import { identityApi, identityJson, verifyIdentityOperation, rebindInitialQuarterPlan, identityDraftReadback, type IdentityApply, type IdentityPreview, type IdentityReceipt } from "@/lib/pre-freeze-identities-client";
import { FeedbackButton } from "./FeedbackButton";
import styles from "./GrowthGoalSummary.module.css";

const pendingKey = "seo-prefreeze-identities:2026-close";
const clearSession = (key: string) => { try { sessionStorage.removeItem(key); } catch { /* Keeping the original ID permits safe readback after reload. */ } };
type Package = { review: PreFreezeReview; quarterPlan?: QuarterPlanningInput };
type Pending = { command: IdentityApply; original: IdentityPreview; package: Package };
export function PreFreezeIdentityReview({ onChanged }: { onChanged: () => Promise<void> }) {
  const [bundle, setBundle] = useState<Package | null>(null), [preview, setPreview] = useState<IdentityPreview | null>(null);
  const [pending, setPending] = useState<Pending | null>(null), [receipt, setReceipt] = useState<IdentityReceipt | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [verified, setVerified] = useState(false);
  const [planPreview, setPlanPreview] = useState<{ plan: QuarterPlanningInput; version: number } | null>(null);
  const [planSaved, setPlanSaved] = useState(false), locked = useRef(false), requestId = useRef("");
  const [planSubmitted, setPlanSubmitted] = useState(false);
  const [historicalTimeAcknowledged, setHistoricalTimeAcknowledged] = useState(false);
  const planRequest = useRef<{ action: "save_quarter_plan"; requestId: string; expectedVersion: number; plan: QuarterPlanningInput; rejectedStatus?: number } | null>(null);
  useEffect(() => { try { const raw = sessionStorage.getItem(pendingKey); if (raw) { const value = JSON.parse(raw) as Pending;
    if (value.command?.action === "apply_identities" && value.original && value.package) { setPending(value); setBundle(value.package); setPreview(value.original); setHistoricalTimeAcknowledged(value.command.historicalTimeUnknownAcknowledged === true); requestId.current = value.command.requestId; setError("存在尚未核实的原请求，先核对回执；不会重新提交"); }
  } } catch { setError("浏览器原请求记录读取未完成，提交前需确认存储可用"); } }, []);
  useEffect(() => { try { const raw = sessionStorage.getItem(pendingKey + ":plan"); if (raw) { const value = JSON.parse(raw);
    if (value.action === "save_quarter_plan" && value.plan && typeof value.requestId === "string") { planRequest.current = value; setPlanPreview({ plan: value.plan, version: value.expectedVersion }); setPlanSubmitted(true); setError("存在待核对的原季度保存请求；只读取当前稿，不重复提交"); }
  } } catch { setError("原季度保存请求读取未完成，未重新提交"); } }, []);
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return; locked.current = true; setBusy(true); setError("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "尚未完成，请核对原请求"); }
    finally { locked.current = false; setBusy(false); }
  };
  const loadFile = async (file?: File) => {
    if (!file || pending || planSubmitted) return;
    await run(async () => {
      if (file.size > 1_900_000) throw Error("审核包须小于1.9MB；每批最多200项，完整1600原ID名单保持相同");
      const raw = JSON.parse(await file.text()), value = raw.review ? raw as Package : { review: raw };
      if (value.review?.version !== "pre-freeze-identities-v1" || !Array.isArray(value.review.assignments) || !Array.isArray(value.review.selection?.members)
        || !value.review.assignments.length || value.review.assignments.some((row: PreFreezeReview["assignments"][number]) => !row || [row.keyword, row.keywordId, row.siteDomain, row.topicId, row.country, row.language].some(field => typeof field !== "string")
          || !row.demand || !row.wordLanguage || [row.demand.metric, row.demand.reference, row.demand.quote, row.demand.sha256, row.wordLanguage.reference, row.wordLanguage.observedAt, row.wordLanguage.quote, row.wordLanguage.reason, row.wordLanguage.sha256].some(field => typeof field !== "string")
          || row.demand.observedAt !== null && typeof row.demand.observedAt !== "string"
          || row.demand.observedAt === null && (!row.demand.historicalTimeUnknown || row.demand.historicalTimeUnknown.acknowledgement !== "historical-time-unknown" || typeof row.demand.historicalTimeUnknown.reason !== "string")
          || typeof row.demand.value !== "number" || !Array.isArray(row.wordLanguage.spans) || row.wordLanguage.spans.some(part => !part || typeof part.text !== "string"))) throw Error("不是完整季度身份审核包");
      setBundle(value); setPreview(null); setReceipt(null); setVerified(false); setPlanPreview(null); setPlanSaved(false); setHistoricalTimeAcknowledged(false); requestId.current = "human-identities:" + crypto.randomUUID();
    });
  };
  const readPreview = () => run(async () => {
    if (!bundle || pending) return;
    setPreview(await identityJson(identityApi, { action: "preview_identities", requestId: requestId.current, review: bundle.review })); setHistoricalTimeAcknowledged(false);
  });
  const apply = (reconcile = false) => run(async () => {
    if (!bundle || !preview || pending && !reconcile || !reconcile && bundle.review.assignments.some(row => row.demand.observedAt === null) && !historicalTimeAcknowledged) return;
    const operation = pending ?? { package: bundle, original: preview, command: { action: "apply_identities" as const, requestId: requestId.current, expectedStateHash: preview.stateHash, review: bundle.review,
      ...(bundle.review.assignments.some(row => row.demand.observedAt === null) ? { historicalTimeUnknownAcknowledged: true as const } : {}) } };
    // Persist the exact request before its only submit, including refresh recovery.
    sessionStorage.setItem(pendingKey, JSON.stringify(operation)); setPending(operation);
    const outcome = await verifyIdentityOperation(operation.command, operation.original, !reconcile, identityJson);
    if (outcome.receipt) setReceipt(outcome.receipt);
    if (outcome.status === "verified") { clearSession(pendingKey); setPending(null); setVerified(true); setPreview(outcome.actual); await onChanged(); }
    else if (outcome.status === "rejected") { clearSession(pendingKey); setPending(null); setPreview(null); setError(outcome.error); }
    else { setError(outcome.error); }
  });
  const preparePlan = () => run(async () => {
    if (!bundle || !verified || pending || planSubmitted) return;
    const current = await identityJson("/api/seo/growth/strategy");
    if (current.state.baseline) throw Error("季度已冻结，不改旧N或旧方案，请沿原身份补充流程");
    const original = bundle.quarterPlan ?? current.state.quarterPlanning?.plan;
    if (!original) throw Error("审核包还需包含完整quarterPlan，或先保存完整季度草稿；身份清单不是方向/投入方案");
    setPlanPreview({ plan: rebindInitialQuarterPlan(original, bundle.review, current.formalTargets, current.sourceVersion), version: current.state.version });
  });
  const savePlan = () => run(async () => {
    if (!planPreview || !verified || pending || planSaved || planSubmitted) return;
    const command = { action: "save_quarter_plan" as const, requestId: "human-initial-plan:" + crypto.randomUUID(), expectedVersion: planPreview.version, plan: planPreview.plan };
    sessionStorage.setItem(pendingKey + ":plan", JSON.stringify(command)); planRequest.current = command; setPlanSubmitted(true);
    let rejectedStatus: number | undefined;
    try { await identityJson("/api/seo/growth/strategy", command); } catch (error) {
      rejectedStatus = (error as { status?: number }).status;
      if ([400, 401, 403, 409, 422].includes(rejectedStatus ?? 0)) {
        planRequest.current = { ...command, rejectedStatus };
        sessionStorage.setItem(pendingKey + ":plan", JSON.stringify(planRequest.current));
      }
    }
    const actual = await identityJson("/api/seo/growth/strategy");
    const outcome = identityDraftReadback(actual, command.plan, rejectedStatus);
    if (outcome === "rejected") { clearSession(pendingKey + ":plan"); planRequest.current = null; setPlanSubmitted(false); setPlanPreview(null); throw Error("原季度保存已拒绝，当前稿未被改写；重新读取预览后再确认，未重提原请求"); }
    if (outcome !== "verified") throw Error("原保存结果未核实；已读当前季度记录，未重新提交、批准或冻结");
    clearSession(pendingKey + ":plan"); planRequest.current = null; setPlanSubmitted(false); setPlanSaved(true); await onChanged();
  });
  const readPlan = () => run(async () => {
    const command = planRequest.current; if (!command) return;
    const actual = await identityJson("/api/seo/growth/strategy");
    const outcome = identityDraftReadback(actual, command.plan, command.rejectedStatus);
    if (outcome === "rejected") { clearSession(pendingKey + ":plan"); planRequest.current = null; setPlanSubmitted(false); setPlanPreview(null); throw Error("原季度保存已拒绝，当前稿未被改写；重新读取预览后再确认，未重提原请求"); }
    if (outcome !== "verified") throw Error("原季度待审稿尚未核实或已被后续修改，未重新提交");
    clearSession(pendingKey + ":plan"); planRequest.current = null; setPlanSubmitted(false); setPlanSaved(true); await onChanged();
  });
  const unknownTimes = bundle?.review.assignments.filter(row => row.demand.observedAt === null) ?? [];
  const dayTimes = bundle?.review.assignments.filter(row => row.demand.timePrecision === "day") ?? [];
  return <details><summary>冻结前核定原词市场身份</summary>
    <p>只补缺失市场及独立人审语种证据；已有主国原样保留。纯型号、查询locale和种子词的量不能代替原词证据。每批最多200项，均绑定同一完整1600原ID名单；不会升池或把研究标为ready。</p>
    <label>确切名单与来源审核包 <input aria-label="季度身份审核包" type="file" accept="application/json,.json" disabled={busy || Boolean(pending) || planSubmitted} onChange={event => void loadFile(event.target.files?.[0])} /></label>
    {bundle ? <><p>本批 {bundle.review.assignments.length} 项；完整名单 {bundle.review.selection.members.length} 条站点原成员。</p>
      {dayTimes.length ? <p>本批 {dayTimes.length} 项来源只有真实日期，按日精度及原值保留；未补00:00或时区，不计入历史时间未知例外。</p> : null}
      {unknownTimes.length ? <aside><p>本批 {unknownTimes.length} 项历史指标采集时间未知。来源日期保持未知，本次人审日期不是指标采集时间，不视为本轮新采。</p>
        <p>绑定季度原清单SHA：{bundle.review.selection.sourceHash}</p>
        <ul>{unknownTimes.map(row => <li key={`${row.siteDomain}:${row.keywordId}`}>{row.keyword} · {row.country}/{row.language} · {row.demand.reference}<br />来源SHA：{row.demand.sha256}<br />例外说明：{row.demand.historicalTimeUnknown?.reason}</li>)}</ul>
        <label><input type="checkbox" aria-label="确认本批历史指标时间未知例外" checked={historicalTimeAcknowledged} disabled={!preview || busy || Boolean(pending) || verified} onChange={event => setHistoricalTimeAcknowledged(event.target.checked)} />我已核对本批逐词来源及清单SHA，明确接受上述历史指标时间未知例外；不将其当作新采数据。</label></aside> : null}
      <div className={styles.scroll}><table><thead><tr><th>原词/原话题</th><th>原/拟核市场语种</th><th>本地同词需求</th><th>原词语种证明</th><th>预览结果</th></tr></thead><tbody>{bundle.review.assignments.map(row => <tr key={`${row.siteDomain}:${row.keywordId}`}><td>{row.keyword}<small>{row.siteDomain} · {row.keywordId} · {row.topicId}</small></td><td>{preview ? <>原：{preview.results.find(result => result.siteDomain === row.siteDomain && result.keywordId === row.keywordId)?.previousCountry ?? "未登记"} / {preview.results.find(result => result.siteDomain === row.siteDomain && result.keywordId === row.keywordId)?.previousLanguage ?? "未登记"}<br /></> : null}拟：{row.country} / {row.language}</td><td>{row.demand.metric} {row.demand.value}<details><summary>查看需求原文及SHA</summary><p>{row.demand.reference} · {row.demand.observedAt ?? "历史指标采集时间未知"}</p>{row.demand.timePrecision === "day" ? <small>日精度；原值 {row.demand.observedAtOriginal}；未提供钟点及偏移</small> : null}<pre>{row.demand.quote}</pre><small>{row.demand.sha256}</small></details></td><td>{row.wordLanguage.spans.map(span => span.text).join(" / ")}<details><summary>查看语种原文及SHA</summary><p>{row.wordLanguage.reference} · {row.wordLanguage.observedAt}</p><pre>{row.wordLanguage.quote}</pre><p>{row.wordLanguage.reason}</p><small>{row.wordLanguage.sha256}</small></details></td><td>{preview?.results.find(result => result.siteDomain === row.siteDomain && result.keywordId === row.keywordId)?.market === "reuse" ? "市场复用" : preview ? "仅补缺失市场" : "先读取真实预览"}{preview ? <small>{preview.results.find(result => result.siteDomain === row.siteDomain && result.keywordId === row.keywordId)?.languageReview === "reuse" ? "语种审核复用" : "补缺语种审核"}</small> : null}</td></tr>)}</tbody></table></div>
      <div className={styles.actions}><FeedbackButton pending={busy} disabled={Boolean(pending)} onClick={() => void readPreview()}>读取缺失项预览</FeedbackButton><FeedbackButton pending={busy} disabled={!preview || Boolean(pending) || verified || unknownTimes.length > 0 && !historicalTimeAcknowledged} onClick={() => void apply()}>确认本批缺失身份</FeedbackButton>{pending ? <FeedbackButton pending={busy} onClick={() => void apply(true)}>核对原请求回执</FeedbackButton> : null}</div>
    </> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {verified && receipt ? <p role="status">本批身份与人审来源完整读回一致；新增源 {receipt.createdSourceRows} 条。原主父、成员、正式池、任务与旧历史保持原样。</p> : null}
    {verified ? <><p>身份补齐改变当前targetId和源版本。下一步只按同一1600原ID清单重读待审方案，不自动批准或冻结。</p><FeedbackButton pending={busy} disabled={Boolean(pending) || planSaved || planSubmitted} onClick={() => void preparePlan()}>重读同一原词清单的季度待审方案</FeedbackButton></> : null}
    {planPreview ? <details open><summary>本次待保存的完整方案</summary><pre className={styles.json}>{JSON.stringify(planPreview.plan, null, 2)}</pre><FeedbackButton pending={busy} disabled={planSaved || Boolean(pending) || planSubmitted} onClick={() => void savePlan()}>保存此版待审季度方案</FeedbackButton>{planSubmitted && !planSaved ? <FeedbackButton pending={busy} onClick={() => void readPlan()}>核对原季度待审稿</FeedbackButton> : null}</details> : null}
    {planSaved ? <p role="status">待审方案已按同一1600原词重新保存并读回；尚未批准或冻结。</p> : null}
  </details>;
}
